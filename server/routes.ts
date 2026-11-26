import type { Express } from "express";
import path from "path";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { enhanceTopic, generatePodcastTitle, generatePodcastDescription, generateCourseSyllabus } from "./openai";
import { generatePodcastLegacy as generatePodcast } from "./podcast/simpleGenerator";
import { generateOrGetCoverArt, generatePlaylistCoverArt } from "./services/CoverArtCache";
import { ObjectStorageService } from "./objectStorage";
import { z } from "zod";
import { voiceIdSchema, voiceQualitySchema, VOICE_QUALITY_TIERS, voices, MUSIC_STYLE_IDS, type TimeFrame, type MusicStyleId, type SyllabusEpisode, type PodcastEngagement, type EnrichedPodcast } from "@shared/schema";
import { enhanceTopicWithContext, searchUpcomingEvents, type TrendingCategory } from "./perplexity";
import { getTrendingTopicsCached } from "./services/TrendingCache";
import { enhanceTopicWithContextCached } from "./services/ContextCache";
import { enhanceTopicCached } from "./services/EnhancementCache";
import { checkAndDeductCreditsAtomic, refundCredits, getUserCredits, InsufficientCreditsError, getVoicePricing } from "./creditManager";
import { db } from "./db";
import { users, generatedPodcasts, DEFAULT_TIER_RESTRICTIONS } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import multer from "multer";
import { PDFParse } from "pdf-parse";
import * as mammoth from "mammoth";
import { storeDocument, getDocument, deleteDocument } from "./documentCache";
import { extractArticle } from "./utils/articleExtractor";
import { voiceCatalogRouter } from "./routes/voiceCatalog";
import { adminRouter } from "./routes/admin";
import { trialRouter } from "./routes/trial";
import { setupAuth, isAuthenticated, requireIdentity } from "./auth";
import { enforceTierRestrictions } from "./middleware/tierRestrictions";
import { authLimiter, generationLimiter, uploadLimiter } from "./middleware/security";
import { ApiError, ApiErrors, handleApiError, asyncHandler } from "./utils/apiError";
import { logger, createLogger } from "./utils/logger";
import { paginationSchema, trendingCategorySchema, publicPodcastsQuerySchema } from "./utils/querySchemas";
import { withTransaction, withAtomicOperation } from "./db/transactions";
import Stripe from "stripe";
import { getXTrendingTopics, isGrokAvailable } from "./grok";
import { isQuotaError, isProviderInCooldown, setProviderCooldown } from "./services/providerQuotaGuard";
import { fetchGoogleNewsFallback } from "./services/GoogleNewsFallback";
import { 
  storeContent, 
  getContent, 
  deleteContent,
  extractYouTubeTranscript, 
  extractPodcastTranscript, 
  analyzeContentWithGrok,
  getContentStats,
  ingestContent,
  summarizeContent,
  getServiceStatus,
  type ContentSourceType,
  type UnifiedIngestionResult
} from "./services/ContentIngestion";
import { 
  orchestrateResearch,
  detectUrlsInTopic,
  getCleanTopic,
  type ResearchContext
} from "./services/ResearchOrchestrator";
import { startScheduler, runCatchUpJobs, startResumableGenScheduler } from "./scheduler";
import { googleIndexingService } from "./services/GoogleIndexingService";
import { ContentModerationService } from "./services/ContentModerationService";
import { routeLLMRequest } from "./llmRouter";
import { generateDeepDivePodcast, isNotebookLMEnabled } from "./services/NotebookLMPodcast";

// All podcast styles (available for all templates)
const ALL_PODCAST_STYLES = [
  "conversational", "narrative", "debate", "interview", "news",
  "executive-briefing", "tutor", "lecturer", "coach"
] as const;

// ============================================================
// VOICE-ASSISTANT SEARCH HELPERS
// Parse natural-language voice queries (e.g. "play the latest one",
// "yesterday's morning brief about climate") into recency hints + cleaned
// keywords, and score candidates against the parsed intent.
// ============================================================
const VOICE_STOPWORDS = new Set([
  "the", "a", "an", "to", "of", "in", "on", "for", "and", "or", "but", "with",
  "from", "about", "play", "queue", "listen", "open", "start", "load", "put",
  "that", "this", "those", "these", "one", "ones", "episode", "episodes",
  "podcast", "podcasts", "please", "next", "another", "some", "my", "any",
  "again", "thing", "stuff", "show", "shows",
  "something", "anything", "everything", "nothing",
  "vibe", "vibes", "mood", "tone", "feeling",
]);

const DAY_MS = 24 * 60 * 60 * 1000;

interface ParsedVoiceQuery {
  cleanedQuery: string;
  cleanedTokens: string[];
  sinceMs: number; // unix-ms; 0 = no recency filter
  untilMs: number; // unix-ms; 0 = no upper bound
  recencyLabel: string | null; // e.g. "today", "yesterday", "past_week"
  wantsLatest: boolean; // user said "latest"/"newest"/"most recent"/"last"
  moods: string[]; // canonical mood tokens user asked for
  speakerTokens: string[]; // raw tokens that look like speaker/host hints
  originalLower: string;
}

// Maps query phrases to canonical mood values stored in
// generated_podcasts.generation_params.podcastMood. Order matters — match the
// longer/multi-word phrases first so "really uplifting" doesn't capture
// "lifting".
const MOOD_PHRASE_MAP: Array<{ phrases: string[]; mood: string }> = [
  { phrases: ["uplifting", "upbeat", "feel good", "feel-good", "happy", "positive", "cheerful", "optimistic"], mood: "uplifting" },
  { phrases: ["serious", "sober", "no nonsense", "no-nonsense", "professional", "formal"], mood: "serious" },
  { phrases: ["funny", "humorous", "comedic", "comedy", "lighthearted", "light-hearted", "light hearted"], mood: "humorous" },
  { phrases: ["mysterious", "mystery", "suspenseful", "spooky", "intriguing"], mood: "mysterious" },
  { phrases: ["balanced", "calm", "relaxing", "chill", "mellow", "easy listening", "easy-listening", "neutral"], mood: "balanced" },
  { phrases: ["energetic", "high energy", "high-energy", "exciting", "intense", "pumped"], mood: "energetic" },
];

function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function parseVoiceSearchQuery(raw: string): ParsedVoiceQuery {
  const original = (raw || "").trim();
  const lower = original.toLowerCase();

  let sinceMs = 0;
  let untilMs = 0;
  let recencyLabel: string | null = null;
  let wantsLatest = false;
  let working = ` ${lower} `;

  const stripPhrases = (phrases: string[]) => {
    for (const p of phrases) {
      const re = new RegExp(`\\s${p.replace(/\s+/g, "\\s+")}\\s`, "g");
      working = working.replace(re, " ");
    }
  };

  // "latest"-style hints — sort by recency, no time floor.
  const latestPhrases = [
    "the latest one", "latest one", "the latest", "latest",
    "the newest one", "newest one", "the newest", "newest",
    "the most recent one", "most recent one", "the most recent", "most recent",
    "the last one", "last one", "the very last",
    "the recent one", "recent one",
  ];
  for (const p of latestPhrases) {
    if (working.includes(` ${p} `)) {
      wantsLatest = true;
      recencyLabel = recencyLabel || "latest";
    }
  }
  if (wantsLatest) stripPhrases(latestPhrases);

  // Specific time windows. Order matters — check most-specific first.
  // For closed windows (e.g. "yesterday") `until` bounds the upper edge so a
  // recency boost on today's episodes can't out-rank an actual yesterday match.
  const todayStart = startOfTodayMs();
  const recencyRules: Array<{
    phrases: string[];
    since: number;
    until?: number;
    label: string;
  }> = [
    {
      phrases: [
        "in the last hour", "past hour", "last hour", "the last hour",
        "this hour",
      ],
      since: Date.now() - 60 * 60 * 1000,
      label: "past_hour",
    },
    {
      phrases: [
        "this morning", "from this morning",
        "today", "from today", "today's", "todays",
      ],
      since: todayStart,
      label: "today",
    },
    {
      phrases: [
        "yesterday", "from yesterday", "yesterday's", "yesterdays",
      ],
      since: todayStart - DAY_MS,
      until: todayStart, // exclude today
      label: "yesterday",
    },
    {
      phrases: [
        "in the last few days", "past few days", "last few days",
        "the last few days",
      ],
      since: todayStart - 3 * DAY_MS,
      label: "past_few_days",
    },
    {
      phrases: [
        "this week", "from this week", "in the past week", "past week",
        "the last week", "from last week",
      ],
      since: todayStart - 7 * DAY_MS,
      label: "past_week",
    },
    {
      phrases: [
        "last week",
      ],
      since: todayStart - 14 * DAY_MS,
      until: todayStart - 7 * DAY_MS, // last calendar week, not the trailing 7d
      label: "last_week",
    },
    {
      phrases: [
        "this month", "from this month", "in the past month", "past month",
        "the last month",
      ],
      since: todayStart - 30 * DAY_MS,
      label: "past_month",
    },
    {
      phrases: [
        "last month",
      ],
      since: todayStart - 60 * DAY_MS,
      until: todayStart - 30 * DAY_MS, // last calendar month-ish
      label: "last_month",
    },
    {
      phrases: [
        "this year", "from this year", "in the past year", "past year",
      ],
      since: todayStart - 365 * DAY_MS,
      label: "past_year",
    },
  ];

  for (const rule of recencyRules) {
    const matched = rule.phrases.some((p) => working.includes(` ${p} `));
    if (matched) {
      // Prefer the tightest (most-recent) window if multiple match. Treat
      // closed windows (with an `until`) as more specific than open ones, so
      // "yesterday" wins over an open "today" boundary if both happen to match.
      const isCloser = rule.since > sinceMs;
      const isMoreSpecific = !!rule.until && !untilMs;
      if (sinceMs === 0 || isCloser || isMoreSpecific) {
        sinceMs = rule.since;
        untilMs = rule.until ?? 0;
        recencyLabel = rule.label;
      }
      stripPhrases(rule.phrases);
    }
  }

  // Mood detection — strip recognized mood phrases from the working string
  // before tokenizing so they don't double-count as keyword tokens.
  const moodsFound = new Set<string>();
  for (const { phrases, mood } of MOOD_PHRASE_MAP) {
    let hit = false;
    for (const p of phrases) {
      if (working.includes(` ${p} `)) {
        hit = true;
        break;
      }
    }
    if (hit) {
      moodsFound.add(mood);
      stripPhrases(phrases);
    }
  }

  // Speaker hint detection — capture the noun after "with"/"hosted by"/
  // "featuring" before stripping fillers. We grab up to two tokens so
  // "the one with Dr. Smith" yields ["dr", "smith"].
  const speakerTokens: string[] = [];
  const speakerRegex = /\s(?:with|hosted by|featuring|by)\s+([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*)?)/g;
  let smatch: RegExpExecArray | null;
  while ((smatch = speakerRegex.exec(working)) !== null) {
    const phrase = smatch[1].trim();
    for (const t of phrase.split(/\s+/)) {
      const cleaned = t.replace(/[^a-z'-]/g, "");
      if (cleaned.length >= 2 && !VOICE_STOPWORDS.has(cleaned)) {
        speakerTokens.push(cleaned);
      }
    }
  }

  // Filler phrases — strip after recency/mood/speaker parse so we don't
  // confuse them.
  stripPhrases([
    "play me", "play the", "play that", "play it", "play",
    "queue up", "queue me", "queue the", "queue",
    "listen to", "open up", "open",
    "the one", "that one", "an episode", "the episode", "an podcast",
    "you know", "kind of", "sort of",
    "hosted by", "featuring",
  ]);

  // Speaker tokens are handled by the voice-id filter and the speaker-corpus
  // scorer — don't ALSO require them in the title/topic/description ilike, or
  // a query like "play the one with Drake" wrongly excludes Drake-voiced
  // episodes whose titles never spell out "Drake".
  const speakerSet = new Set(speakerTokens);
  const tokens = working
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9'-]+/g, ""))
    .filter((t) => t.length > 1 && !VOICE_STOPWORDS.has(t) && !speakerSet.has(t));

  return {
    cleanedQuery: tokens.join(" "),
    cleanedTokens: tokens,
    sinceMs,
    untilMs,
    recencyLabel,
    wantsLatest,
    moods: Array.from(moodsFound),
    speakerTokens,
    originalLower: lower,
  };
}

function fieldContains(field: string | null | undefined, needle: string): boolean {
  if (!field) return false;
  return field.toLowerCase().includes(needle);
}

// Narrow shape of the bits of `generation_params` the voice-search code reads.
// generation_params is a flexible jsonb column, so we declare only the fields
// we touch and keep them all optional.
export interface VoiceSearchGenerationParams {
  podcastMood?: string | null;
  selectedVoiceIds?: string[];
  assignedVoices?: string[];
  hostVoices?: string[];
  selectedVoicePool?: string[];
}

// Coerces the unknown jsonb `generation_params` payload into the narrow,
// optional shape the voice-search code consumes — without any `as any` casts.
export function normalizeVoiceSearchParams(
  raw: unknown
): VoiceSearchGenerationParams {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const stringArray = (key: string): string[] | undefined => {
    const v = r[key];
    if (!Array.isArray(v)) return undefined;
    return v.filter((x): x is string => typeof x === "string");
  };
  const mood = typeof r.podcastMood === "string" ? r.podcastMood : null;
  return {
    podcastMood: mood,
    selectedVoiceIds: stringArray("selectedVoiceIds"),
    assignedVoices: stringArray("assignedVoices"),
    hostVoices: stringArray("hostVoices"),
    selectedVoicePool: stringArray("selectedVoicePool"),
  };
}

export interface VoiceSearchCandidate {
  id: string;
  title: string | null;
  topic: string;
  description: string | null;
  timestamp: Date | string;
  // jsonb column — typed as `unknown` by Drizzle; normalized via
  // `normalizeVoiceSearchParams` before use.
  generationParams?: unknown;
}

export function scorePodcastForVoice(
  podcast: VoiceSearchCandidate,
  parsed: ParsedVoiceQuery,
  speakerCorpusByPodcast?: Map<string, Set<string>>
): number {
  let score = 0;

  const title = (podcast.title || "").toLowerCase();
  const topic = (podcast.topic || "").toLowerCase();
  const description = (podcast.description || "").toLowerCase();

  // Whole-phrase bonus on title/topic for tight matches.
  const cleaned = parsed.cleanedQuery.trim();
  if (cleaned.length >= 3) {
    if (title.includes(cleaned)) score += 25;
    else if (topic.includes(cleaned)) score += 18;
    else if (description.includes(cleaned)) score += 8;
  }

  // Per-token contributions, weighted by where the token appears.
  for (const t of parsed.cleanedTokens) {
    if (fieldContains(title, t)) score += 6;
    else if (fieldContains(topic, t)) score += 4;
    else if (fieldContains(description, t)) score += 2;
  }

  // Mood match against generationParams.podcastMood.
  if (parsed.moods.length > 0) {
    const params = normalizeVoiceSearchParams(podcast.generationParams);
    const podcastMood = (params.podcastMood || "").toLowerCase();
    if (podcastMood && parsed.moods.includes(podcastMood)) {
      score += 12;
    } else if (parsed.moods.length > 0) {
      // Mismatch is a soft penalty — don't disqualify entirely in case the
      // user's mood word also appears in the title/topic.
      score -= 4;
    }
  }

  // Speaker match: voice alias names, display names, or googleVoiceName tokens
  // associated with this podcast (collected once per request).
  if (parsed.speakerTokens.length > 0 && speakerCorpusByPodcast) {
    const corpus = speakerCorpusByPodcast.get(podcast.id);
    if (corpus && corpus.size > 0) {
      let speakerHits = 0;
      for (const tok of parsed.speakerTokens) {
        if (corpus.has(tok)) speakerHits++;
      }
      if (speakerHits > 0) {
        score += 10 + 5 * speakerHits;
      }
    }
    // Speaker tokens that also match title/topic still got their normal token
    // points above, so a speaker-named-in-title episode wins gracefully.
  }

  // Recency boost — newer is slightly preferred among equal-content matches.
  // Saturates at 14 days so older episodes aren't unduly penalized.
  const ts = new Date(podcast.timestamp).getTime();
  const ageDays = Math.max(0, (Date.now() - ts) / DAY_MS);
  const recencyBoost = Math.max(0, 7 - Math.min(ageDays, 14) * 0.5);
  score += recencyBoost;

  // If the user explicitly asked for "the latest", lean hard on recency.
  if (parsed.wantsLatest) {
    score += Math.max(0, 20 - Math.min(ageDays, 30));
  }

  // Inside the recency window — small confidence bump (the SQL filter already
  // restricted the candidate set, but this helps tie-breaking).
  if (parsed.sinceMs > 0 && ts >= parsed.sinceMs) {
    score += 4;
  }
  // Outside an explicit upper bound — heavy penalty so e.g. "yesterday's
  // episode" can't be displaced by today's recency boost.
  if (parsed.untilMs > 0 && ts >= parsed.untilMs) {
    score -= 30;
  }

  return score;
}

const recommendationsCache = new Map<string, { data: any[]; timestamp: number }>();
const RECOMMENDATIONS_CACHE_TTL = 10 * 60 * 1000;
const RECOMMENDATIONS_CACHE_MAX = 200;

// ============================================================
// IN-PROGRESS GENERATION LOCK
// Prevents duplicate concurrent generation for the same clientJobId.
// The DB idempotency check (further below) only catches ALREADY-COMPLETED
// podcasts. For long generations (5-10 min) a connection drop triggers a
// client retry BEFORE the first generation has saved — causing two full
// generations to run in parallel. This map closes that race window.
// ============================================================
const inProgressGenerations = new Map<string, Promise<any>>();

const VALID_TEMPLATE_CATEGORIES = ['custom', 'news', 'sports', 'teachme', 'stories', 'medical', 'events', 'documents', 'deepdive'] as const;

function getCachedRecommendations(podcastId: string): any[] | null {
  const cached = recommendationsCache.get(podcastId);
  if (cached && Date.now() - cached.timestamp < RECOMMENDATIONS_CACHE_TTL) {
    return cached.data;
  }
  if (cached) {
    recommendationsCache.delete(podcastId);
  }
  return null;
}

function setCachedRecommendations(podcastId: string, recommendations: any[]): void {
  if (recommendationsCache.size >= RECOMMENDATIONS_CACHE_MAX) {
    const oldest = recommendationsCache.keys().next().value;
    if (oldest) recommendationsCache.delete(oldest);
  }
  recommendationsCache.set(podcastId, { data: recommendations, timestamp: Date.now() });
}

const generatePodcastRequestSchema = z.object({
  topic: z.string().min(1, "Topic is required"),
  durationMinutes: z.number().min(2, "Duration must be at least 2 minutes").max(20, "Duration cannot exceed 20 minutes"),
  languageComplexity: z.number().min(1, "Language complexity must be at least 1").max(10, "Language complexity cannot exceed 10"),
  numPeople: z.number().min(1, "Number of people must be at least 1").max(5, "Number of people cannot exceed 5"),
  podcastStyle: z.enum(ALL_PODCAST_STYLES).optional(),
  timeFrame: z.enum(["past24h", "pastWeek", "pastMonth", "pastYear", "allTime", "next24h", "nextWeek", "nextMonth", "nextYear"]).optional().default("pastMonth") as any as z.ZodType<TimeFrame>,
  coHostPersonality: z.enum(["casual", "academic", "executive", "storyteller", "investigative"]).optional().default("casual"),
  podcastMood: z.enum(["uplifting", "serious", "humorous", "mysterious", "balanced", "energetic"]).optional().default("balanced"),
  language: z.string().default("en"),
  selectedVoicePool: z.array(voiceIdSchema).optional(),
  assignedVoices: z.array(voiceIdSchema).optional(),
  selectedVoiceIds: z.array(z.string()).optional(),
  selectedAccents: z.record(z.string().nullable()).optional(),
  documentId: z.string().optional(),
  contentId: z.string().optional(),
  templateCategory: z.string().default("custom"),
  eventFormat: z.enum(["recap", "preview", "guide"]).optional(),
  
  // Template-specific fields (all optional)
  // Documents
  summaryType: z.enum(["executive", "detailed", "educational", "conversational"]).optional(),
  summaryDepth: z.number().min(1).max(5).optional(),
  documentUrl: z.string().optional(),
  
  // Sports
  format: z.enum(["recap", "analysis", "preview"]).optional(),
  sportType: z.string().optional(),
  team: z.string().optional(),
  league: z.string().optional(),
  
  // Teach Me - Course settings for multi-episode courses
  courseSettings: z.object({
    deliveryMode: z.enum(["single", "binge", "daily"]),
    episodeCount: z.number().min(2).max(30),
    episodeDuration: z.number().min(5).max(30),
  }).optional(),
  refinedContext: z.string().optional(),
  
  // Events
  eventName: z.string().optional(),
  eventType: z.string().optional(),
  eventDate: z.string().optional(),
  venue: z.string().optional(),
  
  // Stories (Audiobook)
  storyGenre: z.string().optional(),
  characters: z.string().optional(),
  
  // Medical
  condition: z.string().optional(),
  detailLevel: z.number().min(1).max(5).optional(),
  focusArea: z.enum(["overview", "symptoms", "treatment", "prevention"]).optional(),
  audienceType: z.enum(["patients", "students", "professionals"]).optional(),
  disclaimer: z.boolean().optional(),
  disclaimerAccepted: z.boolean().optional(),
  
  // Lyria 3 background music
  musicStyle: z.enum(MUSIC_STYLE_IDS).optional(),
  
  // Idempotency key — client-generated brew job ID to prevent duplicate creation on retries
  clientJobId: z.string().optional(),
});

const enhanceTopicRequestSchema = z.object({
  topic: z.string().min(1, "Topic is required"),
  podcastStyle: z.enum(ALL_PODCAST_STYLES).default("conversational"),
  languageComplexity: z.number().min(1).max(10),
  numPeople: z.number().min(1).max(5).default(2),
  timeFrame: z.enum(["past24h", "pastWeek", "pastMonth", "pastYear", "allTime", "next24h", "nextWeek", "nextMonth", "nextYear"]).default("pastMonth") as any as z.ZodType<TimeFrame>,
  coHostPersonality: z.enum(["casual", "academic", "executive", "storyteller", "investigative"]).default("casual"),
  templateCategory: z.string().default("custom"),
  eventFormat: z.enum(["recap", "preview", "guide"]).optional(),
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Setup Passport authentication (Google OAuth and Email/Password)
  await setupAuth(app);
  
  // Auth status endpoint - compatible with existing frontend
  // Returns {authenticated, user} for both authenticated and unauthenticated users
  app.get('/api/auth/status', async (req: any, res) => {
    try {
      // Check if user is authenticated via Passport (Google OAuth or email/password)
      if (!req.isAuthenticated() || !req.user) {
        return res.json({
          authenticated: false,
          user: null
        });
      }
      
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      // Trigger catch-up jobs in background (handles missed auto-generations for sleeping apps)
      // This is fire-and-forget - don't await to avoid slowing auth response
      // Note: Credits are deducted by the scheduler's runAutoGeneration before calling this context
      runCatchUpJobs(userId, {
        generatePodcast: async (params) => {
          const userVoices = params.selectedVoiceIds && params.selectedVoiceIds.length > 0
            ? await db.select().from(voices).where(inArray(voices.id, params.selectedVoiceIds))
            : [];
          
          // Run podcast generation, title generation, and cover art in parallel
          const [podcastResult, title, coverImageUrl] = await Promise.all([
            generatePodcast(
              params.topic,
              params.durationMinutes,
              params.languageComplexity,
              params.numPeople,
              params.podcastStyle as any,
              undefined, // timeFrame
              params.coHostPersonality as any,
              params.podcastMood as any,
              params.language,
              userVoices as any,
              params.templateCategory,
              undefined, // templateSpecificParams
              'premium',
              params.selectedVoiceIds,
              false, // locationEnabled
              undefined, // locationCity
              false, // skipPerplexityResearch
              undefined, // selectedAccents
              params.musicStyle as import('./podcast/simpleGenerator').PodcastSettings['musicStyle'] // forward user-selected music style
            ),
            generatePodcastTitle(params.topic, params.templateCategory),
            generateOrGetCoverArt(params.topic, params.templateCategory)
          ]);
          
          const { audioUrl, duration, citations } = podcastResult;
          
          const podcast = await storage.createGeneratedPodcast({
            topic: params.topic,
            title,
            audioUrl,
            coverImageUrl,
            duration,
            userId: params.userId,
            isPublic: params.isPublic,
            templateCategory: params.templateCategory,
            voiceQuality: 'premium',
            creditsCost: params.creditCost,
            citations: citations || [],
            generationParams: params
          });
          
          // Notify Google Indexing API for public podcasts (async, non-blocking)
          if (params.isPublic && podcast.id) {
            googleIndexingService.notifyUrlUpdated(podcast.id).catch(() => {});
          }
          
          return podcast;
        }
      }).catch(err => console.error('[Auth] Catch-up jobs failed:', err));
      
      if (!user) {
        return res.json({
          authenticated: false,
          user: null
        });
      }
      
      // Always use DEFAULT_TIER_RESTRICTIONS to ensure all users get updated voice tier access
      const userPlan = (user.subscriptionPlan || 'free') as keyof typeof DEFAULT_TIER_RESTRICTIONS;
      const tierRestrictions = DEFAULT_TIER_RESTRICTIONS[userPlan] || DEFAULT_TIER_RESTRICTIONS.free;
      
      return res.json({
        authenticated: true,
        user: {
          id: user.id,
          email: user.email,
          credits: user.credits,
          plan: user.subscriptionPlan,
          onboardingCompleted: user.onboardingCompleted,
          tierRestrictions: tierRestrictions,
          firstName: user.firstName,
          lastName: user.lastName,
          profileImageUrl: user.profileImageUrl,
        }
      });
    } catch (error) {
      console.error("Error fetching auth status:", error);
      return res.json({
        authenticated: false,
        user: null
      });
    }
  });

  // Auth user endpoint - returns user object directly (null if not authenticated)
  app.get('/api/auth/user', async (req: any, res) => {
    try {
      // Check if user is authenticated via Passport (Google OAuth or email/password)
      if (!req.isAuthenticated() || !req.user) {
        return res.json(null);
      }
      
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.json(null);
      }
      
      // Always use DEFAULT_TIER_RESTRICTIONS to ensure all users get updated voice tier access
      const userPlan = (user.subscriptionPlan || 'free') as keyof typeof DEFAULT_TIER_RESTRICTIONS;
      const tierRestrictions = DEFAULT_TIER_RESTRICTIONS[userPlan] || DEFAULT_TIER_RESTRICTIONS.free;
      
      return res.json({
        id: user.id,
        email: user.email,
        credits: user.credits,
        subscriptionPlan: user.subscriptionPlan,
        onboardingCompleted: user.onboardingCompleted,
        tierRestrictions: tierRestrictions,
        firstName: user.firstName,
        lastName: user.lastName,
        profileImageUrl: user.profileImageUrl,
      });
    } catch (error) {
      console.error("Error fetching user:", error);
      return res.json(null);
    }
  });
  
  // Admin Routes (Database Seeding)
  app.use("/api/admin", adminRouter);
  
  // Generation Metrics - Telemetry endpoints
  app.get("/api/metrics/generation/recent", isAuthenticated, asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const metrics = await storage.getRecentGenerationMetrics(limit);
    res.json(metrics);
  }));

  app.get("/api/metrics/generation/summary", isAuthenticated, asyncHandler(async (req, res) => {
    const summary = await storage.getGenerationStatsSummary();
    res.json(summary);
  }));
  
  // Voice Catalog Routes (Phase 1.2)
  app.use("/api/voices", voiceCatalogRouter);
  
  // Trial Routes (Guest podcast creation without auth)
  app.use("/api/trial", trialRouter);

  app.get("/public-objects/:filePath(*)", async (req, res) => {
    const filePath = req.params.filePath;
    const objectStorageService = new ObjectStorageService();
    try {
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
        return res.status(404).json({ error: "File not found" });
      }
      // Use long cache TTL for audio/image files (1 year), shorter for other files
      const isMedia = /\.(mp3|wav|ogg|m4a|webp|png|jpg|jpeg|gif)$/i.test(filePath);
      const cacheTtlSec = isMedia ? 31536000 : 3600; // 1 year for media, 1 hour for others
      objectStorageService.downloadObject(file, res, cacheTtlSec);
    } catch (error) {
      console.error("Error searching for public object:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // SEO: Serve OG images explicitly for social media crawlers
  // Checks both production (dist/public) and development (client/public) paths
  const ogImagePaths = [
    path.resolve(import.meta.dirname, "public", "og-image.png"),
    path.resolve(import.meta.dirname, "..", "client", "public", "og-image.png"),
  ];
  const twitterImagePaths = [
    path.resolve(import.meta.dirname, "public", "twitter-image.png"),
    path.resolve(import.meta.dirname, "..", "client", "public", "twitter-image.png"),
  ];
  
  const fs = await import("fs");
  const findImage = (paths: string[]) => paths.find(p => fs.existsSync(p)) || paths[paths.length - 1];

  app.get("/og-image.png", (_req, res) => {
    res.set({
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400",
      "Access-Control-Allow-Origin": "*",
    });
    res.sendFile(findImage(ogImagePaths));
  });
  
  app.get("/twitter-image.png", (_req, res) => {
    res.set({
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400",
      "Access-Control-Allow-Origin": "*",
    });
    res.sendFile(findImage(twitterImagePaths));
  });

  // SEO: Sitemap.xml endpoint for search engines
  app.get("/sitemap.xml", async (req, res) => {
    try {
      const baseUrl = "https://podbrew.pro";
      const today = new Date().toISOString().split('T')[0];
      
      // Get all public podcasts for dynamic URLs
      const publicPodcasts = await storage.getPublicPodcasts();
      
      let podcastUrls = '';
      publicPodcasts.forEach(podcast => {
        const podcastDate = podcast.timestamp ? new Date(podcast.timestamp).toISOString().split('T')[0] : today;
        podcastUrls += `
  <url>
    <loc>${baseUrl}/podcast/${podcast.id}</loc>
    <lastmod>${podcastDate}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`;
      });
      
      const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${baseUrl}/create</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>${baseUrl}/voices</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${baseUrl}/listen</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${baseUrl}/library</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>${baseUrl}/pricing</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${baseUrl}/settings</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>${podcastUrls}
</urlset>`;
      
      res.header('Content-Type', 'application/xml');
      res.send(sitemap);
    } catch (error) {
      console.error("Error generating sitemap:", error);
      res.status(500).send("Error generating sitemap");
    }
  });

  // Trending Topics API (with 6-hour cache - 95% API savings)
  app.get("/api/trending-topics", asyncHandler(async (req, res) => {
    const schema = z.object({
      category: z.string().optional().default('all'),
      location: z.string().optional()
    });
    const { category, location } = schema.parse(req.query);
    
    try {
      const { topics, lastUpdated, error: cacheError } = await getTrendingTopicsCached(category as TrendingCategory, location);
      // Map 'summary' to 'description' for frontend compatibility
      const formattedTopics = topics.map(topic => ({
        title: topic.title,
        description: topic.summary,
        category: topic.category,
        relevanceScore: topic.relevanceScore,
        publishedAt: topic.publishedAt,
      }));
      // Surface cache-layer errors (e.g. provider quota exhausted) even when
      // we successfully serve stale cached topics, so the UI can indicate
      // "data may be stale" or render the error card if topics is empty.
      return res.json({ topics: formattedTopics, lastUpdated, ...(cacheError ? { error: cacheError } : {}) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('Failed to fetch trending topics, returning empty array', {
        category, location, error: message,
      });
      // Surface the error so the UI can render a clear "provider unavailable"
      // state with a Retry button instead of a generic empty state.
      return res.json({
        topics: [],
        lastUpdated: new Date().toISOString(),
        error: message || 'Failed to fetch trending topics',
      });
    }
  }));

  // X (Twitter) Trending Topics API - uses xAI Grok's unique X access
  app.get("/api/trending-topics/x", asyncHandler(async (req, res) => {
    const categorySchema = z.object({
      category: z.string().optional(),
      count: z.coerce.number().min(1).max(20).default(10)
    });
    const { category, count } = categorySchema.parse(req.query);
    
    // Check if Grok/xAI is available
    if (!isGrokAvailable()) {
      return res.json({ 
        topics: [], 
        lastUpdated: new Date().toISOString(),
        available: false,
        error: 'X trending topics require xAI API key configuration'
      });
    }
    
    const categoryFilter = category && category !== 'all' ? category : undefined;
    const fallbackCategory = (categoryFilter ?? 'all') as TrendingCategory;

    // If xAI is in cool-down (quota exhausted), skip the call entirely and
    // serve Google News RSS so the X tab still has content.
    if (isProviderInCooldown('xai')) {
      console.log(`[Routes] ⏸ xAI in cool-down, serving Google News fallback for X tab`);
      const fallbackTopics = await fetchGoogleNewsFallback(fallbackCategory);
      return res.json({
        topics: fallbackTopics.slice(0, count).map(t => ({
          title: t.title,
          description: t.summary,
          category: t.category,
          publishedAt: t.publishedAt,
        })),
        lastUpdated: new Date().toISOString(),
        available: true,
        error: 'stale-fallback: xAI in cool-down, using Google News',
      });
    }

    try {
      const result = await getXTrendingTopics(categoryFilter, count);
      return res.json({ ...result, available: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('Failed to fetch X trending topics', { category, error: message });

      // Detect quota/rate-limit and activate cool-down + RSS fallback.
      if (isQuotaError(error)) {
        setProviderCooldown('xai', message.slice(0, 120));
        console.log(`[Routes] ⚡ xAI quota error, activating Google News fallback for X tab`);
        const fallbackTopics = await fetchGoogleNewsFallback(fallbackCategory);
        return res.json({
          topics: fallbackTopics.slice(0, count).map(t => ({
            title: t.title,
            description: t.summary,
            category: t.category,
            publishedAt: t.publishedAt,
          })),
          lastUpdated: new Date().toISOString(),
          available: true,
          error: 'stale-fallback: xAI quota exhausted, using Google News',
        });
      }

      // Non-quota error — return empty as before.
      return res.json({
        topics: [],
        lastUpdated: new Date().toISOString(),
        available: true,
        error: message || 'Failed to fetch X trends',
      });
    }
  }));

  // Check if X trending is available (requires xAI API key)
  app.get("/api/trending-topics/x/status", asyncHandler(async (req, res) => {
    return res.json({ available: isGrokAvailable() });
  }));

  // Local Event Discovery - uses Perplexity for UPCOMING events only
  app.get("/api/events/discover", asyncHandler(async (req, res) => {
    const schema = z.object({
      city: z.string().min(1, "City is required"),
      eventType: z.string().optional(),
      dateRange: z.enum(['today', 'this_week', 'this_month']).optional().default('this_week'),
      count: z.coerce.number().min(1).max(30).optional().default(15)
    });

    const { city, eventType, dateRange, count } = schema.parse(req.query);

    // Check if Perplexity API is available
    if (!process.env.PERPLEXITY_API_KEY) {
      return res.json({
        events: [],
        city,
        lastUpdated: new Date().toISOString(),
        available: false,
        disclaimer: "Local event discovery requires Perplexity API key configuration"
      });
    }

    try {
      // Use Perplexity to search for UPCOMING events only
      const result = await searchUpcomingEvents(city, eventType, dateRange, count);
      return res.json({ ...result, available: true });
    } catch (error) {
      logger.warn('Failed to fetch local events', {
        city,
        eventType,
        error: error instanceof Error ? error.message : String(error)
      });
      return res.json({
        events: [],
        city,
        lastUpdated: new Date().toISOString(),
        available: true,
        disclaimer: error instanceof Error ? error.message : 'Failed to fetch events'
      });
    }
  }));

  // Discover events using user's saved location
  app.get("/api/events/discover/me", isAuthenticated, asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    
    // Get user's location settings
    const [user] = await db
      .select({ locationEnabled: users.locationEnabled, locationCity: users.locationCity })
      .from(users)
      .where(eq(users.id, userId));

    if (!user?.locationEnabled || !user?.locationCity) {
      return res.status(400).json({
        error: "Location not configured",
        message: "Please enable location and set your city in Settings > Preferences to discover local events.",
        needsLocationSetup: true
      });
    }

    const schema = z.object({
      eventType: z.string().optional(),
      dateRange: z.enum(['today', 'this_week', 'this_month']).optional().default('this_week'),
      count: z.coerce.number().min(1).max(30).optional().default(15)
    });

    const { eventType, dateRange, count } = schema.parse(req.query);

    // Check if Perplexity API is available
    if (!process.env.PERPLEXITY_API_KEY) {
      return res.json({
        events: [],
        city: user.locationCity,
        lastUpdated: new Date().toISOString(),
        available: false,
        disclaimer: "Local event discovery requires Perplexity API key configuration"
      });
    }

    try {
      // Use Perplexity to search for UPCOMING events only
      const result = await searchUpcomingEvents(user.locationCity, eventType, dateRange, count);
      return res.json({ ...result, available: true });
    } catch (error) {
      logger.warn('Failed to fetch local events for user', {
        userId,
        city: user.locationCity,
        eventType,
        error: error instanceof Error ? error.message : String(error)
      });
      return res.json({
        events: [],
        city: user.locationCity,
        lastUpdated: new Date().toISOString(),
        available: true,
        disclaimer: error instanceof Error ? error.message : 'Failed to fetch events'
      });
    }
  }));

  // Check event discovery availability (now checks Perplexity)
  app.get("/api/events/discover/status", asyncHandler(async (req, res) => {
    return res.json({ available: !!process.env.PERPLEXITY_API_KEY });
  }));

  // TTS Quota Status API - Track daily Gemini TTS usage
  app.get("/api/tts/quota", asyncHandler(async (req, res) => {
    const { getQuotaStats } = await import("./geminiTTS");
    const stats = getQuotaStats();
    return res.json(stats);
  }));

  // LLM Cost Stats API - Track hybrid LLM usage and savings
  app.get("/api/llm/stats", asyncHandler(async (req, res) => {
    const { getLLMStats } = await import("./llmRouter");
    const stats = getLLMStats();
    return res.json(stats);
  }));

  // Enhanced Topic Enhancement with Context (with dynamic cache - 1h for news, 24h for others)
  app.post("/api/podcasts/enhance-topic-with-context", async (req, res) => {
    try {
      const schema = z.object({
        topic: z.string().min(1, "Topic is required"),
        templateCategory: z.string().default("custom"),
        timeFrame: z.string().optional(),
      });
      const { topic, templateCategory, timeFrame } = schema.parse(req.body);
      
      const enhancement = await enhanceTopicWithContextCached(topic, templateCategory, timeFrame);
      
      return res.json(enhancement);
    } catch (error: any) {
      console.error("Error enhancing topic with context:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      return res.status(502).json({ 
        enhancedTopic: req.body.topic || '',
        context: '',
        relatedAngles: [],
        isTimely: false,
        error: "Unable to enhance topic"
      });
    }
  });

  // Keep existing enhance-topic for backward compatibility (with dynamic cache - 1h news, 24h others)
  app.post("/api/podcasts/enhance-topic", async (req, res) => {
    try {
      const { topic, podcastStyle, languageComplexity, numPeople, timeFrame, coHostPersonality, templateCategory } = enhanceTopicRequestSchema.parse(req.body);
      
      const enhancedTopic = await enhanceTopicCached(topic, podcastStyle as string | undefined, languageComplexity as number | undefined, numPeople as number | undefined, timeFrame as string | undefined, coHostPersonality as string | undefined, templateCategory as string | undefined);
      
      return res.json({ enhancedTopic });
    } catch (error: any) {
      console.error("Error enhancing topic:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      return res.status(500).json({ error: "Failed to enhance topic" });
    }
  });

  // Morpheus Topic Refinement Wizard - generate a GPT-powered contextual greeting
  app.post("/api/morpheus/greet", async (req, res) => {
    try {
      const schema = z.object({
        topic: z.string().min(1),
        templateCategory: z.string(),
      });
      const { topic, templateCategory } = schema.parse(req.body);

      const podcastTypes: Record<string, string> = {
        custom: "custom podcast",
        news: "news briefing",
        documents: "document summary podcast",
        sports: "sports coverage podcast",
        teachme: "educational course podcast",
        events: "event coverage podcast",
        stories: "audiobook or story podcast",
        medical: "health information podcast",
      };
      const podcastType = podcastTypes[templateCategory] || "podcast";

      const openai = new (await import("openai")).default({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are Morpheus, a sharp podcast advisor for PodBrew. Generate an engaging opening message for a ${podcastType}.

Rules:
- Reference SPECIFIC details from the user's exact topic (names, technologies, events, concepts mentioned)
- Ask ONE pointed question that gets at the most important creative decision for this topic
- Never ask generic questions like "who is your audience?" — make it concrete and insightful
- Keep it to 2-3 sentences total
- Sound like a knowledgeable friend who immediately gets the subject matter

Return JSON only: { "greeting": "your opening message", "suggestions": ["short answer 1", "short answer 2", "short answer 3"] }
Suggestions: 3 short plausible direct answers (3-8 words each) the user could tap to answer your question quickly.`,
          },
          { role: "user", content: `Topic: "${topic}"` },
        ],
        response_format: { type: "json_object" },
        temperature: 0.8,
        max_tokens: 300,
      });

      const parsed = JSON.parse(completion.choices[0].message.content || "{}");
      return res.json({
        greeting: parsed.greeting || `You want to explore: "${topic}"\n\nWhat specific angle or perspective interests you most?`,
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      });
    } catch (error: any) {
      console.error("[Morpheus] Greet error:", error);
      return res.status(500).json({ error: "Failed to generate greeting" });
    }
  });

  // Morpheus Topic Refinement Wizard - conversational AI interview
  app.post("/api/morpheus/interview", async (req, res) => {
    try {
      const schema = z.object({
        topic: z.string().min(1),
        templateCategory: z.string(),
        messages: z.array(z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string(),
        })),
      });

      const { topic, templateCategory, messages } = schema.parse(req.body);

      const templateContexts: Record<string, string> = {
        custom: "Uncover the unique angle, target audience, and depth of coverage they want.",
        news: "Clarify geographic scope, industry focus, and depth of analysis vs opinion.",
        documents: "Understand the intended use case, key sections to prioritize, and technical depth.",
        sports: "Get clarity on team/player focus, stats vs storytelling, and historical context.",
        teachme: "Understand current knowledge level, specific sub-topics of interest, and practical vs theoretical learning goals.",
        events: "Clarify whether they're an attendee or organizer and what aspects matter most.",
        stories: "Understand genre preferences, narrative style, and content sensitivities.",
        medical: "Get context on the health topic, depth of information needed, and whether they want actionable guidance.",
      };
      const templateContext = templateContexts[templateCategory] || templateContexts.custom;
      const userMessageCount = messages.filter(m => m.role === "user").length;

      const systemPrompt = `You are Morpheus, a sharp podcast topic advisor for PodBrew.

Context goal: ${templateContext}
Original topic: "${topic}"

Ask ONE highly specific follow-up question that uncovers the most important creative decision still unexplored for THIS exact topic. Reference specific names, technologies, or concepts from their topic and prior answers — never ask generic questions. Keep it to 2 sentences max.

Return JSON only: {
  "response": "your follow-up question",
  "suggestions": ["short option 1", "short option 2", "short option 3"]
}
Suggestions: 3 short plausible direct answers (3-8 words each) that answer your question.`;

      const openaiMessages = [
        { role: "system" as const, content: systemPrompt },
        ...messages.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
      ];

      const openai = new (await import("openai")).default({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: openaiMessages,
        response_format: { type: "json_object" },
        temperature: 0.7,
        max_tokens: 500,
      });

      const parsed = JSON.parse(completion.choices[0].message.content || "{}");
      const response = parsed.response || "Could you tell me more about what you're looking for?";
      const suggestions: string[] = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];

      // Generate refined context after 2+ user messages
      let refinedContext = "";
      if (userMessageCount >= 2) {
        const contextCompletion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: "Synthesize the key requirements from this conversation into a focused, specific context paragraph (max 120 words) that will guide podcast content generation. Include: the specific angle or perspective requested, target audience insights, depth of coverage, format preferences, and any constraints mentioned. Be specific and actionable — avoid vague generalities.",
            },
            {
              role: "user",
              content: `Original topic: ${topic}\n\nConversation:\n${messages.map(m => `${m.role}: ${m.content}`).join("\n")}`,
            },
          ],
          temperature: 0.3,
          max_tokens: 200,
        });
        refinedContext = contextCompletion.choices[0].message.content || "";
      }

      return res.json({ response, suggestions, refinedContext });
    } catch (error: any) {
      console.error("[Morpheus] Interview error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      return res.status(500).json({ error: "Failed to process interview" });
    }
  });

  // Morpheus Voice Synthesis - Text-to-speech using Morpheus voice (sadachbia)
  app.post("/api/morpheus/speak", async (req, res) => {
    try {
      const schema = z.object({
        text: z.string().min(1).max(1000), // Limit text length for performance
      });

      const { text } = schema.parse(req.body);

      // Import TTS synthesis function (V2 uses natural language prompting instead of SSML)
      const { synthesizeSingleSpeakerV2 } = await import("./services/GeminiTTSv2");
      const { convertWavToMp3 } = await import("./audioUtils");

      // Morpheus uses the sadachbia voice
      const MORPHEUS_VOICE = "sadachbia";

      console.log(`[Morpheus Speak] Synthesizing ${text.length} chars with voice: ${MORPHEUS_VOICE}`);

      // Generate speech using Gemini TTS V2 (natural language prompting)
      const wavBuffer = await synthesizeSingleSpeakerV2(text, MORPHEUS_VOICE);
      
      // Convert to MP3 for smaller file size and better browser compatibility
      const mp3Buffer = await convertWavToMp3(wavBuffer);

      // Return audio as base64 for easy frontend consumption
      const base64Audio = mp3Buffer.toString("base64");

      return res.json({ 
        audio: base64Audio,
        mimeType: "audio/mp3",
      });
    } catch (error: any) {
      console.error("[Morpheus Speak] Error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      return res.status(500).json({ error: "Failed to synthesize speech" });
    }
  });

  // Document Upload and Text Extraction - increased limit for large documents
  const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit for large documents/books
  });
  
  // Large document upload for deep analysis (up to 100MB)
  const largeUpload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit for books/research papers
  });

  app.post("/api/documents/extract-text", uploadLimiter, upload.single('document'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const file = req.file;
      const fileType = file.mimetype;
      const fileName = file.originalname.toLowerCase();
      let extractedText = "";

      try {
        if (fileType === 'text/plain' || fileName.endsWith('.txt')) {
          extractedText = file.buffer.toString('utf-8');
        } else if (fileType === 'application/pdf' || fileName.endsWith('.pdf')) {
          const parser = new PDFParse({ data: file.buffer });
          const result = await parser.getText();
          extractedText = result.text;
          await parser.destroy();
        } else if (
          fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
          fileName.endsWith('.docx')
        ) {
          const result = await mammoth.extractRawText({ buffer: file.buffer });
          extractedText = result.value;
        } else {
          return res.status(400).json({ 
            error: 'Unsupported file type. Please upload a PDF, Word document (.docx), or text file (.txt)' 
          });
        }

        // Store document in cache and return metadata with snippet
        const cached = storeDocument(extractedText, file.originalname, file.size);
        
        // Create a snippet (first 200 words for preview)
        const words = extractedText.trim().split(/\s+/);
        const snippetWords = words.slice(0, 200);
        const snippet = snippetWords.join(' ') + (words.length > 200 ? '...' : '');

        return res.json({ 
          documentId: cached.documentId,
          fileName: cached.fileName,
          fileSize: cached.fileSize,
          wordCount: cached.wordCount,
          snippet
        });
      } catch (extractError) {
        console.error("Error extracting text from file:", extractError);
        return res.status(500).json({ error: "Failed to extract text from document" });
      }
    } catch (error: any) {
      console.error("Error processing document upload:", error);
      return res.status(500).json({ error: "Failed to process document" });
    }
  });

  // ============================================================
  // PHASE 1 & 2: Content Ingestion APIs (YouTube, Podcasts, Deep Analysis)
  // ============================================================

  // YouTube Video Transcript Extraction
  app.post("/api/content/youtube", asyncHandler(async (req, res) => {
    const schema = z.object({
      url: z.string().url("Please provide a valid YouTube URL")
    });
    
    const { url } = schema.parse(req.body);
    
    try {
      const result = await extractYouTubeTranscript(url);
      
      // Store the content for later use
      const stored = storeContent(
        'youtube',
        result.title,
        result.transcript,
        result.metadata,
        url
      );
      
      // Create preview snippet
      const words = result.transcript.trim().split(/\s+/);
      const snippet = words.slice(0, 200).join(' ') + (words.length > 200 ? '...' : '');
      
      return res.json({
        contentId: stored.id,
        title: result.title,
        wordCount: stored.wordCount,
        tokenEstimate: stored.tokenEstimate,
        snippet,
        metadata: result.metadata,
        grokAvailable: isGrokAvailable()
      });
    } catch (error) {
      console.error('[Content] YouTube extraction failed:', error);
      return res.status(400).json({ 
        error: error instanceof Error ? error.message : 'Failed to extract YouTube content'
      });
    }
  }));

  // Podcast Episode Extraction
  app.post("/api/content/podcast", asyncHandler(async (req, res) => {
    const schema = z.object({
      url: z.string().url("Please provide a valid podcast URL")
    });
    
    const { url } = schema.parse(req.body);
    
    try {
      const result = await extractPodcastTranscript(url);
      
      // Store the content for later use
      const stored = storeContent(
        'podcast',
        result.title,
        result.transcript,
        result.metadata,
        url
      );
      
      // Create preview snippet
      const words = result.transcript.trim().split(/\s+/);
      const snippet = words.slice(0, 200).join(' ') + (words.length > 200 ? '...' : '');
      
      return res.json({
        contentId: stored.id,
        title: result.title,
        wordCount: stored.wordCount,
        tokenEstimate: stored.tokenEstimate,
        snippet,
        metadata: result.metadata,
        grokAvailable: isGrokAvailable()
      });
    } catch (error) {
      console.error('[Content] Podcast extraction failed:', error);
      return res.status(400).json({ 
        error: error instanceof Error ? error.message : 'Failed to extract podcast content'
      });
    }
  }));

  // Website / Article Extraction
  app.post("/api/content/website", asyncHandler(async (req, res) => {
    const schema = z.object({
      url: z.string().url("Please provide a valid website URL"),
    });

    const { url } = schema.parse(req.body);

    // Validate scheme up-front; per-hop SSRF validation (DNS, port, private-IP)
    // happens in validateHop() below before each fetch.
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return res.status(400).json({ error: "Only http:// and https:// URLs are supported." });
      }
    } catch {
      return res.status(400).json({ error: "That doesn't look like a valid URL." });
    }

    const TIMEOUT_MS = 12_000;
    const MAX_BYTES = 3 * 1024 * 1024; // 3MB raw HTML cap
    const MAX_CHARS = 60_000; // Cap extracted text so prompts stay reasonable
    const MAX_REDIRECTS = 5;

    const net = await import("net");
    const isPrivateIp = (ip: string): boolean => {
      const family = net.isIP(ip);
      if (family === 0) return false; // not an IP literal
      const lower = ip.toLowerCase();
      if (family === 4) {
        return (
          /^127\./.test(ip) ||
          /^10\./.test(ip) ||
          /^192\.168\./.test(ip) ||
          /^169\.254\./.test(ip) ||
          /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
          ip === "0.0.0.0"
        );
      }
      // family === 6
      return (
        lower === "::" ||
        lower === "::1" ||
        lower.startsWith("fc") || // fc00::/7 ULA
        lower.startsWith("fd") ||
        lower.startsWith("fe80:") || // link-local
        lower.startsWith("::ffff:127.") ||
        lower.startsWith("::ffff:10.") ||
        lower.startsWith("::ffff:192.168.") ||
        lower.startsWith("::ffff:169.254.") ||
        lower.startsWith("::ffff:172.16.") ||
        lower.startsWith("::ffff:172.17.") ||
        lower.startsWith("::ffff:172.18.") ||
        lower.startsWith("::ffff:172.19.") ||
        lower.startsWith("::ffff:172.2") ||
        lower.startsWith("::ffff:172.30.") ||
        lower.startsWith("::ffff:172.31.")
      );
    };

    const dns = await import("dns/promises");
    const validateHop = async (target: URL): Promise<string | null> => {
      if (target.protocol !== "http:" && target.protocol !== "https:") {
        return "Only http:// and https:// URLs are supported.";
      }
      // Restrict to standard web ports.
      const port = target.port ? parseInt(target.port, 10) : (target.protocol === "https:" ? 443 : 80);
      if (port !== 80 && port !== 443) {
        return "That URL isn't reachable.";
      }
      const hopHost = target.hostname.toLowerCase();
      // Block obviously-local hostnames.
      if (
        hopHost === "localhost" ||
        hopHost.endsWith(".local") ||
        hopHost.endsWith(".internal")
      ) {
        return "That URL isn't reachable.";
      }
      // If the host is an IP literal, validate it directly.
      if (net.isIP(hopHost) && isPrivateIp(hopHost)) {
        return "That URL isn't reachable.";
      }
      // Otherwise resolve and re-check every address.
      try {
        const addrs = await dns.lookup(hopHost, { all: true });
        for (const a of addrs) {
          if (isPrivateIp(a.address)) return "That URL isn't reachable.";
        }
      } catch {
        return "Couldn't reach that URL.";
      }
      return null;
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let html = "";
    let finalUrl = url;
    let contentType = "";
    // Pose as a real desktop browser so publishers behind Cloudflare/etc.
    // don't auto-403 us. We try Chrome first, then fall back to Safari on
    // 401/403/429 since some sites blocklist specific UA strings.
    const browserHeaderSets: Record<string, string>[] = [
      {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Sec-Ch-Ua":
          '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"macOS"',
      },
      {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Upgrade-Insecure-Requests": "1",
      },
    ];

    const fetchWithHeaders = async (
      startUrl: string,
      headers: Record<string, string>,
    ): Promise<{ resp: Response | null; finalUrl: string; redirectCapped: boolean }> => {
      let currentUrl = startUrl;
      let resp: Response | null = null;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const validationError = await validateHop(new URL(currentUrl));
        if (validationError) {
          throw Object.assign(new Error(validationError), { __userMessage: validationError });
        }
        resp = await fetch(currentUrl, {
          signal: controller.signal,
          redirect: "manual",
          headers,
        });
        if (resp.status >= 300 && resp.status < 400) {
          const loc = resp.headers.get("location");
          if (!loc) break;
          currentUrl = new URL(loc, currentUrl).toString();
          if (hop === MAX_REDIRECTS) {
            return { resp, finalUrl: currentUrl, redirectCapped: true };
          }
          continue;
        }
        break;
      }
      return { resp, finalUrl: currentUrl, redirectCapped: false };
    };

    let resp: Response | null = null;
    try {
      let attempt: { resp: Response | null; finalUrl: string; redirectCapped: boolean } | null = null;
      for (const headers of browserHeaderSets) {
        attempt = await fetchWithHeaders(url, headers);
        if (attempt.redirectCapped) {
          return res.status(400).json({ error: "Too many redirects." });
        }
        const status = attempt.resp?.status ?? 0;
        // Retry once with the next UA set if the server looks like it's
        // blocking automated readers based on UA fingerprint.
        if (status === 401 || status === 403 || status === 429) continue;
        break;
      }
      resp = attempt?.resp ?? null;
      finalUrl = attempt?.finalUrl ?? url;
      if (!resp) {
        return res.status(400).json({ error: "Couldn't fetch that URL." });
      }
      if (!resp.ok) {
        const status = resp.status;
        if (status === 401 || status === 403 || status === 429) {
          return res.status(400).json({
            error:
              "That site is blocking automated readers. Try a different link, or paste the article text into the topic field.",
          });
        }
        return res.status(400).json({
          error: `That site returned an error (${status}). It may be paywalled or down.`,
        });
      }
      contentType = (resp.headers.get("content-type") || "").toLowerCase();
      if (!contentType.includes("text/html") && !contentType.includes("text/plain") && !contentType.includes("xml")) {
        return res.status(400).json({
          error: "That URL doesn't look like a readable webpage.",
        });
      }
      finalUrl = resp.url || url;

      // Read with a hard byte cap to avoid huge downloads.
      const reader = resp.body?.getReader();
      if (!reader) {
        const text = await resp.text();
        html = text.slice(0, MAX_BYTES);
      } else {
        const chunks: Uint8Array[] = [];
        let received = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            received += value.byteLength;
            if (received > MAX_BYTES) {
              chunks.push(value.subarray(0, value.byteLength - (received - MAX_BYTES)));
              try { await reader.cancel(); } catch {}
              break;
            }
            chunks.push(value);
          }
        }
        const buf = Buffer.concat(chunks.map(c => Buffer.from(c)));
        html = buf.toString("utf-8");
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        return res.status(408).json({ error: "That site took too long to respond." });
      }
      if (typeof err?.__userMessage === "string") {
        return res.status(400).json({ error: err.__userMessage });
      }
      console.error("[Content] Website fetch failed:", err);
      return res.status(400).json({ error: "Couldn't fetch that URL. Try another link." });
    } finally {
      clearTimeout(timer);
    }

    // Try Mozilla Readability + JSON-LD + Next/Nuxt data + regex fallback.
    // The extractor returns whichever strategy first produced a substantive
    // article; it also reports paywall/login wall hints so we can give a
    // friendlier error message when nothing readable could be extracted.
    const { article, paywallDetected, loginWallDetected } = extractArticle(html, finalUrl);

    if (!article) {
      if (paywallDetected) {
        return res.status(400).json({
          error:
            "That page is behind a paywall. Try the article's free version, or paste the text into the topic field.",
        });
      }
      if (loginWallDetected) {
        return res.status(400).json({
          error:
            "That page requires you to sign in to read it. Try a public link, or paste the text into the topic field.",
        });
      }
      return res.status(400).json({
        error:
          "That page didn't have enough readable text. It may rely on JavaScript that we can't run, or load its content from a feed we can't read.",
      });
    }

    let title = article.title?.trim();
    if (!title) {
      try { title = new URL(finalUrl).hostname.replace(/^www\./, ""); } catch { title = "Web page"; }
    }

    let text = article.text;
    if (text.length > MAX_CHARS) {
      text = text.slice(0, MAX_CHARS);
    }

    // Store and respond like the YouTube/podcast endpoints.
    const stored = storeContent(
      "url",
      title,
      text,
      {
        extractionMethod: article.strategy,
        ...(article.siteName ? { channel: article.siteName } : {}),
      },
      finalUrl,
    );

    const responseMetadata: Record<string, unknown> = {
      extractionStrategy: article.strategy,
    };
    if (article.byline) responseMetadata.byline = article.byline;
    if (article.siteName) responseMetadata.siteName = article.siteName;
    if (article.excerpt) responseMetadata.excerpt = article.excerpt;

    const words = text.split(/\s+/);
    const snippet = words.slice(0, 200).join(" ") + (words.length > 200 ? "..." : "");

    return res.json({
      contentId: stored.id,
      title,
      url: finalUrl,
      wordCount: stored.wordCount,
      tokenEstimate: stored.tokenEstimate,
      snippet,
      metadata: responseMetadata,
      grokAvailable: isGrokAvailable(),
    });
  }));

  // Deep Content Analysis with Grok (2M token context)
  app.post("/api/content/analyze", asyncHandler(async (req, res) => {
    const schema = z.object({
      contentId: z.string().min(1, "Content ID is required"),
      targetDurationMinutes: z.number().min(2).max(60).default(10),
      analysisType: z.enum(['summary', 'highlights', 'educational', 'discussion']).default('summary')
    });
    
    const { contentId, targetDurationMinutes, analysisType } = schema.parse(req.body);
    
    const content = getContent(contentId);
    if (!content) {
      return res.status(404).json({ error: 'Content not found or expired. Please import again.' });
    }
    
    if (!isGrokAvailable()) {
      return res.status(400).json({ 
        error: 'Deep analysis requires xAI API key. Using standard analysis instead.',
        grokAvailable: false
      });
    }
    
    try {
      const analysis = await analyzeContentWithGrok(
        content.text,
        targetDurationMinutes,
        analysisType
      );
      
      return res.json({
        contentId,
        title: content.title,
        analysis,
        targetDurationMinutes,
        analysisType
      });
    } catch (error) {
      console.error('[Content] Deep analysis failed:', error);
      return res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Deep analysis failed'
      });
    }
  }));

  // Content ingestion stats (for admin/debugging) - MUST be before :id route
  app.get("/api/content/stats", asyncHandler(async (req, res) => {
    return res.json(getContentStats());
  }));

  // Check if deep analysis is available - MUST be before :id route
  app.get("/api/content/capabilities", asyncHandler(async (req, res) => {
    return res.json({
      grokAvailable: isGrokAvailable(),
      maxTokens: isGrokAvailable() ? 2000000 : 128000,
      supportedSources: ['document', 'youtube', 'podcast', 'spotify'],
      analysisTypes: ['summary', 'highlights', 'educational', 'discussion'],
      services: getServiceStatus()
    });
  }));

  // Get service status for content ingestion capabilities - MUST be before :id route
  app.get("/api/content/services", asyncHandler(async (req, res) => {
    const services = getServiceStatus();
    
    return res.json({
      services,
      capabilities: {
        youtube: {
          transcriptExtraction: true,
          captionScraping: true,
          whisperFallback: services.whisper
        },
        spotify: {
          podcastIndexLookup: services.podcastIndex,
          creatorTranscripts: services.podcastIndex,
          whisperTranscription: services.whisper
        },
        podcast: {
          pageScraping: true,
          audioExtraction: true,
          whisperTranscription: services.whisper
        },
        enrichment: {
          perplexityResearch: services.perplexity,
          grokAnalysis: services.grok
        }
      },
      recommendations: !services.podcastIndex ? [
        'Add PODCASTINDEX_API_KEY and PODCASTINDEX_API_SECRET for enhanced Spotify podcast support (free API)'
      ] : []
    });
  }));

  // Get content by ID - MUST be AFTER static routes like /stats, /capabilities, and /services
  app.get("/api/content/:id", asyncHandler(async (req, res) => {
    const content = getContent(req.params.id);
    if (!content) {
      return res.status(404).json({ error: 'Content not found or expired' });
    }
    
    // Don't send full text to reduce bandwidth
    const words = content.text.trim().split(/\s+/);
    const snippet = words.slice(0, 500).join(' ') + (words.length > 500 ? '...' : '');
    
    return res.json({
      id: content.id,
      type: content.type,
      title: content.title,
      wordCount: content.wordCount,
      tokenEstimate: content.tokenEstimate,
      snippet,
      metadata: content.metadata,
      createdAt: content.createdAt
    });
  }));

  // ============================================================
  // UNIFIED CONTENT INGESTION & SUMMARIZATION API (Enhanced 4-Tier Pipeline)
  // Supports: YouTube, Spotify, Podcasts with full transcript extraction
  // ============================================================

  // Unified content ingestion endpoint - handles YouTube, Spotify, and Podcast URLs
  app.post("/api/content/ingest", asyncHandler(async (req, res) => {
    const schema = z.object({
      url: z.string().url("Please provide a valid URL"),
      options: z.object({
        enablePerplexityResearch: z.boolean().default(true),
        enableWhisperTranscription: z.boolean().default(true),
        maxWhisperDurationMinutes: z.number().min(1).max(120).default(60)
      }).optional()
    });

    const { url, options } = schema.parse(req.body);

    try {
      console.log(`[API] Unified content ingestion started for: ${url}`);
      
      const result = await ingestContent(url, options);

      // Store the content for later use in podcast generation
      const stored = storeContent(
        result.sourceType,
        result.title,
        result.transcript,
        {
          ...result.metadata,
          extractionMethod: result.extractionMethod,
          duration: result.duration ? `${Math.floor(result.duration / 60)}:${(result.duration % 60).toString().padStart(2, '0')}` : undefined
        },
        url
      );

      // Create preview snippet
      const words = result.transcript.trim().split(/\s+/);
      const snippet = words.slice(0, 300).join(' ') + (words.length > 300 ? '...' : '');

      return res.json({
        success: true,
        contentId: stored.id,
        sourceType: result.sourceType,
        title: result.title,
        wordCount: result.wordCount,
        tokenEstimate: stored.tokenEstimate,
        duration: result.duration,
        durationFormatted: result.duration ? `${Math.floor(result.duration / 60)}:${(result.duration % 60).toString().padStart(2, '0')}` : undefined,
        extractionMethod: result.extractionMethod,
        tiersUsed: result.tiersUsed,
        cached: result.cached,
        snippet,
        metadata: result.metadata,
        hasResearch: !!result.enrichment?.perplexityResearch,
        citationCount: result.enrichment?.citations?.length || 0,
        services: getServiceStatus()
      });
    } catch (error) {
      console.error('[API] Content ingestion failed:', error);
      return res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to ingest content',
        services: getServiceStatus()
      });
    }
  }));

  // Summarize ingested content to a target podcast duration
  app.post("/api/content/summarize", asyncHandler(async (req, res) => {
    const schema = z.object({
      contentId: z.string().min(1, "Content ID is required"),
      targetDurationMinutes: z.number().min(2).max(60).default(10),
      analysisType: z.enum(['summary', 'highlights', 'educational', 'discussion']).default('summary'),
      includeQuotes: z.boolean().default(true),
      includeTimeline: z.boolean().default(true)
    });

    const { contentId, targetDurationMinutes, analysisType, includeQuotes, includeTimeline } = schema.parse(req.body);

    const content = getContent(contentId);
    if (!content) {
      return res.status(404).json({ 
        success: false,
        error: 'Content not found or expired. Please import the content again.' 
      });
    }

    try {
      console.log(`[API] Summarizing content ${contentId} to ${targetDurationMinutes} minutes`);

      // Create a mock ingestion result from stored content
      const ingestionResult: UnifiedIngestionResult = {
        sourceType: content.type as any,
        title: content.title,
        transcript: content.text,
        wordCount: content.wordCount,
        duration: content.metadata.duration ? parseInt(content.metadata.duration.split(':')[0]) * 60 + parseInt(content.metadata.duration.split(':')[1] || '0') : undefined,
        extractionMethod: content.metadata.extractionMethod || 'unknown',
        tiersUsed: ['stored'],
        metadata: content.metadata as any,
        cached: true
      };

      const result = await summarizeContent(ingestionResult, targetDurationMinutes, {
        analysisType,
        includeQuotes,
        includeTimeline
      });

      return res.json({
        success: true,
        contentId,
        title: content.title,
        targetDurationMinutes,
        analysisType,
        summary: result.summary,
        keyPoints: result.keyPoints,
        themes: result.themes,
        quotes: result.quotes,
        originalWordCount: result.originalWordCount,
        condensedWordCount: result.condensedWordCount,
        compressionRatio: result.compressionRatio,
        citations: result.citations,
        estimatedReadingMinutes: Math.ceil(result.condensedWordCount / 35)
      });
    } catch (error) {
      console.error('[API] Content summarization failed:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Summarization failed'
      });
    }
  }));

  // ============================================================
  // RESUMABLE GENERATION ENDPOINTS - For long-form podcasts (15+ min)
  // These use checkpoint-based generation that survives server restarts
  // ============================================================
  const { createGenerationJob, getJobStatus, getCompletedJob, processJobBatch } = await import('./podcast/resumableGenerator');
  
  // Create a new resumable generation job
  app.post("/api/podcasts/generate-async", generationLimiter, enforceTierRestrictions, asyncHandler(async (req, res) => {
    const user = req.user as any;
    const userId = user?.id || null;
    
    const { 
      topic, durationMinutes, languageComplexity, numPeople, podcastStyle, 
      podcastMood, language, selectedVoiceIds, templateCategory
    } = req.body;
    
    // Content moderation check
    const moderationResult = ContentModerationService.moderateTopic(topic);
    if (!moderationResult.allowed) {
      throw ApiErrors.badRequest(moderationResult.reason || "This topic contains prohibited content. Please try a different subject.");
    }
    
    // Calculate credit cost
    const creditCost = durationMinutes * 0.1; // 0.1 credits per minute for premium
    
    // Skip credit deduction for unauthenticated users (free app mode)
    if (userId) {
      try {
        await checkAndDeductCreditsAtomic(userId, creditCost);
      } catch (err) {
        if (err instanceof InsufficientCreditsError) {
          return res.status(402).json({ error: 'Insufficient credits', required: creditCost });
        }
        throw err;
      }
    }
    
    // Get voices
    const userVoices = selectedVoiceIds && selectedVoiceIds.length > 0
      ? await db.select().from(voices).where(inArray(voices.id, selectedVoiceIds))
      : [];
    
    const hostVoice = userVoices[0]?.googleVoiceName || 'Kore';
    const coHostVoice = numPeople > 1 && userVoices[1] ? userVoices[1].googleVoiceName : undefined;
    const hostName = userVoices[0]?.aliasName || userVoices[0]?.displayName || 'Host';
    const coHostName = numPeople > 1 && userVoices[1] ? (userVoices[1].aliasName || userVoices[1].displayName || 'Co-Host') : undefined;
    
    // Create the job
    const jobId = await createGenerationJob({
      userId,
      topic,
      durationMinutes,
      hostVoice,
      hostName,
      coHostVoice,
      coHostName,
      style: podcastStyle,
      mood: podcastMood,
      languageComplexity,
      language,
      templateCategory,
      creditsCost: creditCost
    });
    
    // Start processing immediately (first batch)
    processJobBatch(jobId).catch(err => {
      console.error(`[API] Error starting job ${jobId}:`, err);
    });
    
    return res.json({ 
      success: true, 
      jobId,
      message: 'Generation started. Poll /api/podcasts/job/:id for status.'
    });
  }));
  
  // Get job status
  app.get("/api/podcasts/job/:id", asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    const status = await getJobStatus(id);
    if (!status) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    // If complete, get the final result
    if (status.status === 'complete') {
      const completed = await getCompletedJob(id);
      if (completed) {
        return res.json({
          ...status,
          audioUrl: completed.audioUrl,
          durationSeconds: completed.durationSeconds
        });
      }
    }
    
    return res.json(status);
  }));
  
  // Resume a stalled job (manual trigger)
  app.post("/api/podcasts/job/:id/resume", asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    const status = await getJobStatus(id);
    if (!status) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    if (status.status === 'complete' || status.status === 'failed') {
      return res.json({ message: `Job already ${status.status}` });
    }
    
    // Process one batch
    const done = await processJobBatch(id);
    
    return res.json({ 
      message: done ? 'Job completed' : 'Batch processed, more work pending',
      done
    });
  }));

  app.post("/api/podcasts/generate", generationLimiter, enforceTierRestrictions, asyncHandler(async (req, res) => {
    const parsedData = generatePodcastRequestSchema.parse(req.body);
    const { 
      topic, durationMinutes, languageComplexity, numPeople, podcastStyle, timeFrame, coHostPersonality, 
      podcastMood, language, selectedVoicePool, assignedVoices, selectedVoiceIds, selectedAccents, templateCategory: rawTemplateCategory, documentId, contentId,
      // Documents
      summaryType, summaryDepth, documentUrl,
      // Sports
      format, sportType, team, league,
      // Teach Me - Course settings
      courseSettings, refinedContext,
      // Events
      eventName, eventFormat, eventType, eventDate, venue,
      // Stories (Audiobook)
      storyGenre, characters,
      // Medical
      condition, detailLevel, focusArea, audienceType, disclaimer, disclaimerAccepted,
      // Music
      musicStyle,
      // Idempotency
      clientJobId
    } = parsedData;

    // Normalize templateCategory — unknown values fall back to 'custom' with a warning
    const validCategorySet = new Set<string>(VALID_TEMPLATE_CATEGORIES);
    let templateCategory: string = validCategorySet.has(rawTemplateCategory) ? rawTemplateCategory : 'custom';
    if (templateCategory !== rawTemplateCategory) {
      logger.warn('[Generation] Unknown templateCategory normalized to custom', {
        received: rawTemplateCategory,
        normalized: 'custom',
      });
    }

    // ============================================================
    // IDEMPOTENCY CHECK: Return existing podcast if clientJobId matches
    // Prevents duplicate creation when client retries a request that
    // already succeeded on the backend.
    // ============================================================
    if (clientJobId) {
      const [existingPodcast] = await db
        .select()
        .from(generatedPodcasts)
        .where(eq(generatedPodcasts.clientJobId, clientJobId))
        .limit(1);
      if (existingPodcast) {
        console.log(`[Idempotency] Returning existing podcast ${existingPodcast.id} for clientJobId=${clientJobId}`);
        return res.json(existingPodcast);
      }
    }

    // ============================================================
    // IN-PROGRESS LOCK: Deduplicate concurrent retries mid-generation
    // If the frontend retries while generation is still in-flight (e.g.
    // connection drop during a long podcast), the retry waits on the
    // existing promise instead of starting a second full generation.
    // ============================================================
    if (clientJobId && inProgressGenerations.has(clientJobId)) {
      console.log(`[Idempotency] clientJobId=${clientJobId} is already in-progress — waiting for first generation to complete`);
      // Set keep-alive headers so this waiting connection doesn't time out
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Content-Type', 'application/json');
      const waitInterval = setInterval(() => {
        if (!res.writableEnded) {
          try { res.write(' '); } catch { /* connection already closed */ }
        }
      }, 15000);
      try {
        const result = await inProgressGenerations.get(clientJobId)!;
        clearInterval(waitInterval);
        if (!res.writableEnded) {
          res.write(JSON.stringify(result));
          res.end();
        }
        return;
      } catch (waitErr: any) {
        clearInterval(waitInterval);
        if (!res.writableEnded) {
          // Propagate the original status code so 4xx (moderation, validation) is
          // correctly reflected rather than always returning 500
          const waitStatus = waitErr?.statusCode || waitErr?.status || 500;
          if (!res.headersSent) res.status(waitStatus);
          res.write(JSON.stringify({ error: 'Generation failed', message: waitErr?.message || 'Unknown error' }));
          res.end();
        }
        return;
      }
    }

    // Register a deferred promise for this generation so any concurrent retry
    // with the same clientJobId waits on it rather than starting a second generation.
    // Default to no-op so call sites can invoke unconditionally without TS narrowing
    // these to `never` due to closure-assignment in the Promise constructor below.
    let resolveInProgress: (podcast: any) => void = () => {};
    let rejectInProgress: (err: any) => void = () => {};
    if (clientJobId) {
      const capturedJobId = clientJobId;
      const deferred = new Promise<any>((resolve, reject) => {
        resolveInProgress = resolve;
        rejectInProgress = reject;
      });
      inProgressGenerations.set(capturedJobId, deferred);
      // Suppress unhandled-rejection when no concurrent retry is waiting on this promise.
      // Waiting retries catch rejections in their own try/catch; the primary request is
      // the resolver/rejecter and never awaits the deferred itself.
      deferred.catch(() => { /* intentional no-op */ });
      // Clean up the map entry immediately once the promise settles
      deferred.finally(() => {
        inProgressGenerations.delete(capturedJobId);
      });
    }

    // ============================================================
    // KEEP-ALIVE MECHANISM: Prevent reverse proxy 504 timeout
    // Sends periodic heartbeat pings to keep connection open
    // Replit/Cloudflare proxy typically times out at 5 minutes
    // Declared outside try/catch so stopKeepAlive is accessible in the catch block.
    // ============================================================
    const KEEPALIVE_INTERVAL_MS = 15000; // Send ping every 15 seconds (more frequent for long podcasts)
    let keepAliveInterval: NodeJS.Timeout | null = null;
    let pingCount = 0;
    
    // Set headers for long-running request with keep-alive streaming
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Type', 'application/json'); // Set content-type upfront for streaming

    const generationStartTime = Date.now();
    
    // Start keep-alive ping mechanism
    const startKeepAlive = () => {
      keepAliveInterval = setInterval(() => {
        pingCount++;
        if (!res.writableEnded) {
          // Write a space character to keep connection alive (invisible to JSON parser)
          // The final JSON response will be the complete response
          try {
            res.write(' ');
            console.log(`[KeepAlive] Ping ${pingCount} sent at ${((Date.now() - generationStartTime) / 1000).toFixed(1)}s`);
          } catch (e) {
            console.log(`[KeepAlive] Failed to send ping ${pingCount}: ${e}`);
          }
        }
      }, KEEPALIVE_INTERVAL_MS);
    };
    
    const stopKeepAlive = () => {
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
      }
    };
    
    // Clean up on connection close
    res.on('close', () => {
      stopKeepAlive();
      if (!res.writableEnded) {
        console.log(`[KeepAlive] Client disconnected after ${pingCount} pings`);
      }
    });
    
    startKeepAlive(); // Start keep-alive immediately
    console.log(`[Generation] Starting ${durationMinutes}-min podcast with ${numPeople} host(s) (keep-alive enabled)`);

    // ============================================================
    // OUTER GUARD: Ensures the in-progress promise is always settled.
    // Wraps everything from moderation to the success path.
    // The inner generation try/catch handles generation errors (does not rethrow).
    // This outer catch only fires for pre-generation errors (moderation, missing
    // documents, etc.) that propagate past the inner catch.
    // ============================================================
    try {

    // ============================================================
    // CONTENT MODERATION: Pre-flight check before expensive API calls
    // ============================================================
    const moderationResult = ContentModerationService.moderateTopic(topic);
    if (!moderationResult.allowed) {
      throw ApiErrors.badRequest(moderationResult.reason || "This topic contains prohibited content. Please try a different subject.");
    }

    const userId = (req as any).user?.id || null;

    // For document template, accept either documentId (upload) or contentId (YouTube/Podcast)
    let actualTopic = topic;
    let cachedDoc = null;
    if (templateCategory === 'documents') {
      // Topic-only fallback: if no document/content was attached, the user must
      // at least provide instructions of meaningful length. The downstream
      // generator handles the no-source path (treats `topic` as the brief).
      if (!documentId && !contentId) {
        if (!topic || topic.trim().length < 10) {
          throw ApiErrors.badRequest("Add a document, paste a link, or describe what you want the podcast to cover (at least a sentence).");
        }
      } else {
        if (documentId) {
          cachedDoc = getDocument(documentId);
          if (!cachedDoc) {
            // documentId may actually be a contentId (legacy client bug): fall back to content cache
            cachedDoc = getContent(documentId);
          }
        }
        if (!cachedDoc && contentId) {
          cachedDoc = getContent(contentId);
        }

        if (!cachedDoc) {
          throw ApiErrors.badRequest("Document not found or expired. Please upload again or reload the content.");
        }
      }
      
      // Moderate document content before any LLM calls (check first 5000 chars for efficiency)
      if (cachedDoc) {
      const docModerationResult = ContentModerationService.moderateTopic(cachedDoc.text.substring(0, 5000));
      if (!docModerationResult.allowed) {
        throw ApiErrors.badRequest(docModerationResult.reason || "The uploaded document contains prohibited content.");
      }

      const CONDENSE_WORD_THRESHOLD = 8000;
      // Hard cap: sending >25k chars to LLM causes 60-90s condensation → exceeds keep-alive window
      // ~25,000 chars ≈ 4,500 words, fast to process and captures the document's core content
      const MAX_CHARS_FOR_CONDENSATION = 25000;
      const MAX_CHARS_DIRECT = 40000;
      const docWordCount = cachedDoc.wordCount ?? cachedDoc.text.split(/\s+/).length;
      let documentText = cachedDoc.text;

      if (docWordCount > CONDENSE_WORD_THRESHOLD) {
        // Pre-truncate before sending to LLM — keeps condensation call under ~20 seconds
        const inputForCondensation = cachedDoc.text.length > MAX_CHARS_FOR_CONDENSATION
          ? cachedDoc.text.slice(0, MAX_CHARS_FOR_CONDENSATION)
          : cachedDoc.text;
        logger.info('Document exceeds word threshold — condensing with GPT-4o-mini', {
          documentId, contentId,
          originalWords: docWordCount,
          charsToCondense: inputForCondensation.length,
        });
        try {
          const { default: OpenAI } = await import('openai');
          const condenseClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
          const condenseResponse = await condenseClient.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: 'You are a precise document summariser. Your task is to produce a thorough, detail-preserving condensed version of the provided document. Retain all key facts, figures, names, dates, terminology, arguments, and structural flow. Target approximately 3,000 words. Do not add commentary or preamble — output only the condensed document text.'
              },
              {
                role: 'user',
                content: `Please condense the following document:\n\n${inputForCondensation}`
              }
            ],
            max_tokens: 4000,
            temperature: 0.3
          });
          const MAX_CONDENSED_WORDS = 4000;
          const condensed = condenseResponse.choices[0].message.content?.trim();
          if (condensed && condensed.length > 0) {
            const condensedWords = condensed.split(/\s+/);
            documentText = condensedWords.length > MAX_CONDENSED_WORDS
              ? condensedWords.slice(0, MAX_CONDENSED_WORDS).join(' ')
              : condensed;
            logger.info('Document condensed successfully', { originalWords: docWordCount, condensedLength: documentText.length });
          } else {
            logger.warn('Condensation returned empty content — truncating original document to safe length');
            documentText = cachedDoc.text.slice(0, MAX_CHARS_DIRECT);
          }
        } catch (condenseError: unknown) {
          const errMsg = condenseError instanceof Error ? condenseError.message : String(condenseError);
          logger.warn('Document condensation failed — truncating original document to safe length', { error: errMsg });
          documentText = cachedDoc.text.slice(0, MAX_CHARS_DIRECT);
        }
      } else if (documentText.length > MAX_CHARS_DIRECT) {
        // Small word-count docs can still have very long text (dense formatting) — cap them too
        documentText = cachedDoc.text.slice(0, MAX_CHARS_DIRECT);
      }

      const documentLabel = documentText !== cachedDoc.text ? 'Document summary' : 'Document content';
      actualTopic = `${topic}\n\n${documentLabel}:\n${documentText}`;
      logger.info('Using cached document for generation', { documentId, contentId, wordCount: docWordCount });
      } else {
        logger.info('Documents template: topic-only generation (no source attached)', { topicLength: topic.length });
      }
    }

    // Also check refinedContext if provided (from Morpheus wizard)
    if (refinedContext) {
      const contextModerationResult = ContentModerationService.moderateTopic(refinedContext);
      if (!contextModerationResult.allowed) {
        throw ApiErrors.badRequest(contextModerationResult.reason || "The refined context contains prohibited content.");
      }
    }

    // Calculate effective duration for pricing (binge courses multiply by episode count)
    const isBingeCourse = templateCategory === 'teachme' && courseSettings?.deliveryMode === 'binge';
    const effectiveDurationForPricing = isBingeCourse 
      ? courseSettings.episodeDuration * courseSettings.episodeCount 
      : durationMinutes;
    
    // Get pricing - ALWAYS recalculate for binge courses to use total duration
    // (middleware caches pricing for per-episode duration only)
    let pricingSummary: any;
    let selectedVoicesForPricing: any[] = [];
    
    if (selectedVoiceIds && selectedVoiceIds.length > 0) {
      selectedVoicesForPricing = await db
        .select()
        .from(voices)
        .where(inArray(voices.id, selectedVoiceIds));
    }
    
    if (isBingeCourse) {
      // Force recalculation for binge courses using total duration
      pricingSummary = getVoicePricing(selectedVoicesForPricing, effectiveDurationForPricing);
      // Overwrite middleware cache so all downstream code uses correct pricing
      (req as any).voicePricingSummary = pricingSummary;
      console.log(`[Binge Course] Pricing: ${courseSettings!.episodeCount} episodes × ${courseSettings!.episodeDuration}min = ${effectiveDurationForPricing}min total, ${pricingSummary.totalCredits} credits`);
    } else if ((req as any).voicePricingSummary) {
      // Use middleware-cached pricing for single episodes
      pricingSummary = (req as any).voicePricingSummary;
    } else {
      // Calculate pricing if middleware didn't provide it
      pricingSummary = getVoicePricing(selectedVoicesForPricing, durationMinutes);
    }
    
    const creditsCost = pricingSummary.totalCredits;

    // Skip credit deduction for unauthenticated users (free app mode)
    if (userId) {
      try {
        await checkAndDeductCreditsAtomic(userId, creditsCost);
      } catch (error) {
        if (error instanceof InsufficientCreditsError) {
          throw ApiErrors.insufficientCredits(creditsCost, (error as any).currentCredits);
        }
        throw error;
      }
    }

    const templateSpecificParams = {
      summaryType, summaryDepth, documentUrl,
      format, sportType, team, league,
      eventName, eventFormat, eventType, eventDate, venue,
      storyGenre, characters,
      condition, detailLevel, focusArea, audienceType, disclaimer, disclaimerAccepted
    };

    let savedPodcast;
    let researchFailed = false;
    
    try {
      logger.info('Starting podcast generation', { 
        userId, 
        templateCategory, 
        durationMinutes, 
        creditsCost 
      });

      // Fetch user's location settings for personalized content
      let locationEnabled = false;
      let locationCity: string | null = null;
      if (userId) {
        const userSettings = await db
          .select({ locationEnabled: users.locationEnabled, locationCity: users.locationCity })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        locationEnabled = userSettings[0]?.locationEnabled || false;
        locationCity = userSettings[0]?.locationCity || null;
      }
      
      if (locationEnabled && locationCity) {
        logger.info('Location-aware content enabled', { userId, city: locationCity });
      }

      // ============================================================
      // RESEARCH ORCHESTRATION: Deep research for all templates
      // Detects URLs, ingests content, runs Perplexity research
      // ============================================================
      let researchContext: ResearchContext | null = null;
      let researchCitations: string[] = [];
      
      // Skip research for document template (already has full content) and stories (creative, not research-based)
      const skipResearchTemplates = ['documents', 'stories'];
      const shouldResearch = !skipResearchTemplates.includes(templateCategory) && !documentId && !contentId;
      
      if (shouldResearch) {
        try {
          logger.info('Starting research orchestration', { templateCategory, topic: topic.substring(0, 50) });
          
          researchContext = await orchestrateResearch(actualTopic, templateCategory, {
            enablePerplexityResearch: true,
            enableContentIngestion: true,
            targetDurationMinutes: durationMinutes,
            locationCity,
            locationEnabled,
            timeFrame: timeFrame as string
          });
          
          // Collect all citations from research
          if (researchContext.perplexityResearch?.citations) {
            researchCitations.push(...researchContext.perplexityResearch.citations);
          }
          for (const content of researchContext.ingestedContent) {
            if (content.citations) {
              researchCitations.push(...content.citations);
            }
          }
          
          // Enhance actualTopic with compiled research context
          if (researchContext.compiledContext && researchContext.totalWordCount > 50) {
            actualTopic = `${actualTopic}\n\n=== COMPREHENSIVE RESEARCH CONTEXT ===\n${researchContext.compiledContext}`;
            logger.info('Topic enhanced with research', { 
              originalWordCount: topic.split(/\s+/).length,
              researchWordCount: researchContext.totalWordCount,
              sourcesIngested: researchContext.ingestedContent.length,
              citationCount: researchCitations.length
            });
          }
        } catch (researchError) {
          // Research failure should not block generation - log and continue
          researchFailed = true;
          logger.warn('Research orchestration failed, continuing with original topic', { 
            error: researchError instanceof Error ? researchError.message : String(researchError)
          });
        }
      }

      // Validate and resolve voice assignments
      // CRITICAL: This validation applies to ALL voice sources (selectedVoiceIds AND assignedVoices)
      // Pass FULL voice objects to generation so all properties (aliasName, googleVoiceName, etc.) are available
      let actualAssignedVoices: any[] | undefined = assignedVoices;
      let voiceRecordsForValidation: (typeof voices.$inferSelect)[] = [];
      
      if (selectedVoiceIds && selectedVoiceIds.length > 0) {
        // Fetch voice records from database
        const selectedVoiceRecords = await db
          .select()
          .from(voices)
          .where(inArray(voices.id, selectedVoiceIds));
        
        // Preserve the order of selectedVoiceIds
        const voiceMap = new Map(selectedVoiceRecords.map(v => [v.id, v]));
        const orderedVoices = selectedVoiceIds
          .map(id => voiceMap.get(id))
          .filter((v): v is typeof voices.$inferSelect => v !== undefined);
        
        voiceRecordsForValidation = orderedVoices;
        
        // CRITICAL FIX: Pass FULL voice objects (not just string names) so generation can access:
        // - googleVoiceName (actual Gemini voice ID like "Kore", "Charon")
        // - aliasName (personalized display name)
        // - All other voice properties
        actualAssignedVoices = orderedVoices;
        
        logger.info('Selected voices mapped for storage', {
          selectedVoiceIds,
          actualAssignedVoices: orderedVoices.map((v, i) => `${i}: ${v.aliasName} (${v.googleVoiceName})`)
        });
      } else if (assignedVoices && assignedVoices.length > 0) {
        // Validate assignedVoices (legacy/direct voice assignments)
        // Fetch voice records by googleVoiceName
        const assignedVoiceRecords = await db
          .select()
          .from(voices)
          .where(inArray(voices.googleVoiceName, assignedVoices as any[]));
        
        voiceRecordsForValidation = assignedVoiceRecords;
      }
      
      // All voices are premium tier - no validation needed
      // All 30 Gemini voices use Gemini 2.5 Flash TTS (premium quality)

      // ============================================================
      // BINGE COURSE MODE: Generate multiple episodes as a playlist
      // Only for teachme template with binge delivery mode
      // ============================================================
      if (isBingeCourse) {
        console.log(`[Binge Course] 🎓 Starting ${courseSettings!.episodeCount}-episode course generation`);
        
        // Generate course syllabus first
        const syllabus = await generateCourseSyllabus(topic, courseSettings!.episodeCount, refinedContext);
        console.log(`[Binge Course] Syllabus generated with ${syllabus.length} episodes`);
        
        // Create a playlist for the course
        const courseTitle = await generatePodcastTitle(topic, 'teachme');
        const courseCoverUrl = await generateOrGetCoverArt(topic, 'teachme');
        
        const coursePlaylist = await storage.createPlaylist({
          name: `📚 ${courseTitle}`,
          description: `A ${courseSettings!.episodeCount}-episode learning course: ${topic}`,
          userId,
          coverImageUrl: courseCoverUrl,
        });
        console.log(`[Binge Course] Created playlist: ${coursePlaylist.id}`);
        
        const generatedEpisodes: any[] = [];
        const episodeDuration = courseSettings!.episodeDuration;
        const perEpisodeCreditsCost = creditsCost / courseSettings!.episodeCount;
        
        // Hard cap: never generate more episodes than requested
        const maxEpisodes = Math.min(syllabus.length, courseSettings!.episodeCount);
        
        // Generate each episode sequentially (to avoid overwhelming TTS)
        for (let i = 0; i < maxEpisodes; i++) {
          const episode = syllabus[i];
          const episodeNumber = i + 1;
          const totalEpisodes = maxEpisodes;
          
          console.log(`[Binge Course] 🎙️ Generating episode ${episodeNumber}/${totalEpisodes}: "${episode.title}"`);
          
          // Build episode-specific topic with context
          const episodeTopic = `
Episode ${episodeNumber} of ${totalEpisodes}: ${episode.title}

FOCUS: ${episode.focusTopic}

KEY POINTS TO COVER:
${episode.keyPoints.map((p, idx) => `${idx + 1}. ${p}`).join('\n')}

CONTEXT: This is part of a ${totalEpisodes}-episode course on "${topic}".
${episodeNumber === 1 ? 'This is the FIRST episode - introduce the course and set the foundation.' : ''}
${episodeNumber === totalEpisodes ? 'This is the FINAL episode - summarize the course and provide next steps.' : ''}
${episodeNumber > 1 && episodeNumber < totalEpisodes ? `Build on previous episodes and prepare for episode ${episodeNumber + 1}.` : ''}
`;
          
          try {
            // Generate this episode
            const [episodePodcastResult, episodeCoverUrl] = await Promise.all([
              generatePodcast(
                episodeTopic, episodeDuration, languageComplexity, numPeople, podcastStyle, timeFrame as TimeFrame,
                coHostPersonality, podcastMood, language, actualAssignedVoices as any, 'teachme', templateSpecificParams, pricingSummary.tier, selectedVoiceIds,
                locationEnabled, locationCity, false, selectedAccents, musicStyle as MusicStyleId | undefined
              ),
              generateOrGetCoverArt(`${episode.title} - ${topic}`, 'teachme')
            ]);
            
            const episodeTitle = `Episode ${episodeNumber}/${totalEpisodes}: ${episode.title}`;
            
            // Get voice alias names for this episode
            let episodeVoiceAliasNames: string[] = [];
            if (selectedVoiceIds && selectedVoiceIds.length > 0) {
              const selectedVoiceRecords = await db
                .select()
                .from(voices)
                .where(inArray(voices.id, selectedVoiceIds));
              const voiceMap = new Map(selectedVoiceRecords.map(v => [v.id, v]));
              episodeVoiceAliasNames = selectedVoiceIds
                .map(id => voiceMap.get(id)?.aliasName)
                .filter((name): name is string => name !== undefined);
            }
            
            const episodeGenerationParams = {
              topic: episodeTopic,
              durationMinutes: episodeDuration,
              languageComplexity,
              numPeople,
              podcastStyle,
              timeFrame,
              coHostPersonality,
              podcastMood,
              language,
              assignedVoices: episodeVoiceAliasNames.length > 0 ? episodeVoiceAliasNames : actualAssignedVoices,
              voiceAliasNames: episodeVoiceAliasNames,
              selectedVoiceIds,
              templateCategory: 'teachme',
              courseInfo: {
                episodeNumber,
                totalEpisodes,
                playlistId: coursePlaylist.id,
                courseName: courseTitle
              }
            };
            
            // Save the episode
            const savedEpisode = await storage.createGeneratedPodcast({
              topic: episodeTopic,
              title: episodeTitle,
              audioUrl: episodePodcastResult.audioUrl,
              coverImageUrl: episodeCoverUrl,
              duration: episodePodcastResult.duration,
              userId,
              generationParams: episodeGenerationParams,
              templateCategory: 'teachme',
              citations: episodePodcastResult.citations || [],
              creditsCost: perEpisodeCreditsCost, // Credits divided across episodes
              isPublic: true,
            });
            
            // Add to playlist
            await storage.addToPlaylist(coursePlaylist.id, savedEpisode.id);
            
            generatedEpisodes.push(savedEpisode);
            console.log(`[Binge Course] ✅ Episode ${episodeNumber}/${totalEpisodes} complete: ${savedEpisode.duration}`);
            
          } catch (episodeError) {
            console.error(`[Binge Course] ❌ Failed to generate episode ${episodeNumber}:`, episodeError);
            // Continue with remaining episodes
          }
        }
        
        stopKeepAlive();
        console.log(`[KeepAlive] Binge course complete, sent ${pingCount} keep-alive pings`);
        console.log(`[Binge Course] ✅ Course complete: ${generatedEpisodes.length}/${syllabus.length} episodes generated`);
        
        // Return the playlist and all episodes
        const courseResult = {
          type: 'course',
          playlist: coursePlaylist,
          episodes: generatedEpisodes,
          episodeCount: generatedEpisodes.length,
          totalEpisodes: syllabus.length,
        };
        // Resolve the in-progress promise so any waiting retry requests receive the result
        resolveInProgress(courseResult);
        return res.json(courseResult);
      }

      // ============================================================
      // SINGLE EPISODE MODE (default)
      // ============================================================

      // OPTIMIZATION: Skip Perplexity research inside generatePodcast if content was already ingested
      // This prevents duplicate research calls, saving 15-30 seconds
      const skipPerplexityResearch = !!contentId;
      
      // OPTIMIZATION: Run title, cover art, and podcast generation in PARALLEL
      // This saves 10-20 seconds by not waiting for TTS to complete before generating title/cover art
      const storyGenre = templateCategory === 'stories' ? (templateSpecificParams as any)?.storyGenre : undefined;
      
      console.log(`[Generation] 🚀 Starting PARALLEL generation: podcast + title + description + cover art`);
      const parallelStartTime = Date.now();
      
      const [podcastResult, title, description, coverImageUrl] = await Promise.all([
        // Main podcast generation (TTS synthesis)
        generatePodcast(
          actualTopic, durationMinutes, languageComplexity, numPeople, podcastStyle, timeFrame as TimeFrame, 
          coHostPersonality, podcastMood, language, actualAssignedVoices as any, templateCategory, templateSpecificParams, pricingSummary.tier, selectedVoiceIds,
          locationEnabled, locationCity, skipPerplexityResearch, selectedAccents, musicStyle as MusicStyleId | undefined
        ),
        // Title generation (runs in parallel with podcast)
        generatePodcastTitle(topic, templateCategory),
        // Description generation (runs in parallel with podcast)
        generatePodcastDescription(topic, templateCategory),
        // Cover art generation (runs in parallel with podcast)
        generateOrGetCoverArt(topic, templateCategory, storyGenre)
      ]);
      
      const parallelTime = ((Date.now() - parallelStartTime) / 1000).toFixed(1);
      console.log(`[Generation] ✅ PARALLEL generation complete in ${parallelTime}s`);
      
      const { audioUrl, duration, citations } = podcastResult;

      // CRITICAL: Map selectedVoiceIds to alias names for user-facing records
      // The alias names (Marcus, Riley, etc.) must be used in all generation records
      let voiceAliasNames: string[] = [];
      if (selectedVoiceIds && selectedVoiceIds.length > 0) {
        const selectedVoiceRecords = await db
          .select()
          .from(voices)
          .where(inArray(voices.id, selectedVoiceIds));
        
        // Preserve order of selectedVoiceIds
        const voiceMap = new Map(selectedVoiceRecords.map(v => [v.id, v]));
        voiceAliasNames = selectedVoiceIds
          .map(id => voiceMap.get(id)?.aliasName)
          .filter((name): name is string => name !== undefined);
      }

      const generationParams = {
        topic,
        durationMinutes,
        languageComplexity,
        numPeople,
        podcastStyle,
        timeFrame,
        coHostPersonality,
        podcastMood,
        language,
        selectedVoicePool,
        // CRITICAL: Always use voice alias names (personalized names) in generation records
        assignedVoices: voiceAliasNames.length > 0 ? voiceAliasNames : actualAssignedVoices,
        voiceAliasNames, // Explicitly store alias names for clarity
        selectedVoiceIds,
        templateCategory,
        locationEnabled,
        locationCity,
        musicStyle,
        ...templateSpecificParams,
      };

      // All podcasts are public by default
      const isPublic = true;
      
      // Merge citations from both generatePodcast and research orchestration (deduplicated)
      const allCitations = Array.from(new Set([
        ...(citations || []),
        ...researchCitations
      ]));

      savedPodcast = await storage.createGeneratedPodcast({
        topic,
        title,
        description,
        audioUrl,
        coverImageUrl,
        duration,
        userId,
        generationParams,
        templateCategory,
        citations: allCitations,
        creditsCost,
        isPublic,
        clientJobId: clientJobId || null,
        researchFailed,
      });

      // Calculate and log generation time
      const generationTimeMs = Date.now() - generationStartTime;
      const generationTimeMinutes = (generationTimeMs / 1000 / 60).toFixed(2);
      const generationTimeSeconds = Math.round(generationTimeMs / 1000);
      
      // Estimate generation time using same logic as frontend (calibrated based on telemetry)
      const estimatedTimeSeconds = (() => {
        if (durationMinutes <= 2) return 180;
        if (durationMinutes <= 5) return 300;
        if (durationMinutes <= 10) return 420;
        if (durationMinutes <= 20) return 540;
        if (durationMinutes <= 30) return 660;
        return 780;
      })();
      
      // Record telemetry metric (dates as ISO strings for JSON serialization)
      await storage.recordGenerationMetric({
        userId,
        templateCategory,
        durationMinutes,
        requestedDurationMinutes: durationMinutes,
        estimatedTimeSeconds,
        actualTimeSeconds: generationTimeSeconds,
        startedAt: new Date(generationStartTime).toISOString(),
        completedAt: new Date().toISOString(),
        success: true,
      });
      
      console.log(`[Telemetry] Generation completed in ${generationTimeSeconds}s (estimated: ${estimatedTimeSeconds}s) for ${durationMinutes}min podcast`);
      console.log(`[Generation] ✅ Complete in ${generationTimeMinutes} min (${generationTimeSeconds}s) for ${durationMinutes}-min podcast`);
      console.log(`[Generation] Ratio: ${(generationTimeSeconds / 60 / durationMinutes).toFixed(2)}x realtime (${durationMinutes} min podcast in ${generationTimeMinutes} min)`);

      logger.info('Podcast generated successfully', { 
        podcastId: savedPodcast.id, 
        userId, 
        duration,
        generationTimeSeconds,
        generationTimeMinutes: parseFloat(generationTimeMinutes)
      });

      // Notify Google Indexing API for public podcasts (async, non-blocking)
      if (isPublic && savedPodcast.id) {
        googleIndexingService.notifyUrlUpdated(savedPodcast.id).catch(err => {
          logger.debug('Google Indexing notification failed (non-critical)', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }

      // Update NewsPreset with script summary to avoid repetitive content for daily news
      if (templateCategory === 'news') {
        try {
          const { newsPresets: newsPresetsTable } = await import('@shared/schema');
          const scriptSummary = actualTopic.substring(0, 800); // Store first 800 chars as summary
          await db
            .update(newsPresetsTable)
            .set({
              lastGeneratedScriptSummary: scriptSummary,
              lastGeneratedDate: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(newsPresetsTable.userId, userId));
          logger.info('NewsPreset updated with script summary for deduplication', { userId });
        } catch (updateError) {
          logger.warn('Failed to update NewsPreset with script summary', { 
            userId, 
            error: updateError instanceof Error ? updateError.message : String(updateError)
          });
          // Non-critical: don't fail generation if update fails
        }
      }

      // Delete cached document after successful generation
      if (documentId && cachedDoc) {
        deleteDocument(documentId);
      }
      if (contentId && cachedDoc) {
        deleteContent(contentId);
      }
    } catch (generationError) {
      stopKeepAlive(); // Stop keep-alive on error
      // Reject the in-progress promise so any waiting retry requests surface the error
      rejectInProgress(generationError instanceof Error ? generationError : new Error(String(generationError)));

      // Record failed generation telemetry
      const failureTimeSeconds = Math.round((Date.now() - generationStartTime) / 1000);
      const estimatedTimeSeconds = (() => {
        if (durationMinutes <= 2) return 180;
        if (durationMinutes <= 5) return 300;
        if (durationMinutes <= 10) return 420;
        if (durationMinutes <= 20) return 540;
        if (durationMinutes <= 30) return 660;
        return 780;
      })();
      
      await storage.recordGenerationMetric({
        userId,
        templateCategory,
        durationMinutes,
        requestedDurationMinutes: durationMinutes,
        estimatedTimeSeconds,
        actualTimeSeconds: failureTimeSeconds,
        startedAt: new Date(generationStartTime).toISOString(),
        completedAt: new Date().toISOString(),
        success: false,
        errorMessage: generationError instanceof Error ? generationError.message : String(generationError),
      });
      
      console.log(`[Telemetry] Generation FAILED after ${failureTimeSeconds}s for ${durationMinutes}min podcast`);
      
      logger.error('Podcast generation failed, refunding credits', { 
        userId, 
        creditsCost,
        error: generationError instanceof Error ? generationError.message : String(generationError)
      });
      
      if (userId) {
        await refundCredits(userId, creditsCost);
      }
      
      // Also delete cached document on failure
      if (documentId && cachedDoc) {
        deleteDocument(documentId);
      }
      if (contentId && cachedDoc) {
        deleteContent(contentId);
      }
      
      // Send error response directly using res.write() since headers are already set for keep-alive
      const errorMessage = generationError instanceof Error ? generationError.message : String(generationError);
      if (!res.headersSent) {
        res.status(500);
      }
      res.write(JSON.stringify({
        error: 'Generation failed',
        message: errorMessage || 'Podcast generation failed. Please try again.',
        details: 'An error occurred during podcast generation. Your credits have been refunded.'
      }));
      res.end();
      return;
    }

    stopKeepAlive(); // Stop keep-alive before sending response
    console.log(`[KeepAlive] Generation complete, sent ${pingCount} keep-alive pings`);
    // Resolve the in-progress promise so any waiting retry requests receive the result
    const podcastResponse = researchFailed ? { ...savedPodcast, researchFailed: true } : savedPodcast;
    resolveInProgress(podcastResponse);
    // Use res.write + res.end instead of res.json to work with keep-alive streaming
    res.write(JSON.stringify(podcastResponse));
    res.end();

    } catch (preGenErr: any) {
      // Outer catch: only fires for pre-generation errors (before the inner generation
      // try/catch). The inner catch handles generation errors and does not rethrow, so
      // any error here is from moderation, document validation, or other early checks.
      rejectInProgress(preGenErr instanceof Error ? preGenErr : new Error(String(preGenErr)));
      stopKeepAlive();
      if (res.headersSent) {
        // Headers already committed (keep-alive wrote a space before the error occurred).
        // res.json() / res.status() would throw — write the error directly and close.
        const errCode = (preGenErr instanceof Error && 'code' in preGenErr && typeof (preGenErr as { code?: unknown }).code === 'string')
          ? (preGenErr as { code: string }).code
          : 'PRE_GENERATION_ERROR';
        const errPayload = {
          error: preGenErr instanceof Error ? preGenErr.message : String(preGenErr),
          code: errCode,
        };
        if (!res.writableEnded) {
          res.write(JSON.stringify(errPayload));
          res.end();
        }
      } else {
        throw preGenErr; // Rethrow so asyncHandler returns the proper 4xx/5xx to the client
      }
    }

  }));

  app.get("/api/user/credits", asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.json({ credits: 999999, plan: 'free' });
    const creditsInfo = await getUserCredits(userId);
    res.json(creditsInfo);
  }));

  app.post("/api/user/cancel-subscription", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      
      const [user] = await db
        .update(users)
        .set({
          subscriptionPlan: 'free',
          subscriptionStatus: 'active',
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
        .returning();

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({ 
        message: "Subscription cancelled successfully",
        plan: user.subscriptionPlan,
        credits: user.credits
      });
    } catch (error: any) {
      console.error("Error cancelling subscription:", error);
      res.status(500).json({ 
        message: error.message || "Failed to cancel subscription" 
      });
    }
  });

  // Location settings endpoints
  app.get("/api/user/location", asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.json({ locationEnabled: false, locationCity: null });
    const [user] = await db
      .select({ locationEnabled: users.locationEnabled, locationCity: users.locationCity })
      .from(users)
      .where(eq(users.id, userId));
    
    res.json({
      locationEnabled: user?.locationEnabled ?? false,
      locationCity: user?.locationCity ?? null
    });
  }));

  app.patch("/api/user/location", isAuthenticated, asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { locationEnabled, locationCity } = req.body;
    
    const updateData: { locationEnabled?: boolean; locationCity?: string | null; updatedAt: Date } = {
      updatedAt: new Date()
    };
    
    if (typeof locationEnabled === 'boolean') {
      updateData.locationEnabled = locationEnabled;
    }
    if (locationCity !== undefined) {
      updateData.locationCity = locationCity || null;
    }
    
    const [user] = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, userId))
      .returning({ locationEnabled: users.locationEnabled, locationCity: users.locationCity });
    
    res.json({
      locationEnabled: user?.locationEnabled ?? false,
      locationCity: user?.locationCity ?? null
    });
  }));

  // User profile settings (alias and avatar for community features)
  app.get("/api/user/profile", asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.json({ alias: null, avatarUrl: null, firstName: null, lastName: null, profileImageUrl: null });
    
    const [user] = await db
      .select({ 
        alias: users.alias, 
        avatarUrl: users.avatarUrl,
        firstName: users.firstName,
        lastName: users.lastName,
        profileImageUrl: users.profileImageUrl
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    
    res.json({
      alias: user?.alias ?? null,
      avatarUrl: user?.avatarUrl ?? null,
      firstName: user?.firstName ?? null,
      lastName: user?.lastName ?? null,
      profileImageUrl: user?.profileImageUrl ?? null
    });
  }));

  app.patch("/api/user/profile", isAuthenticated, asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { alias, avatarUrl } = req.body;
    
    const updateData: { alias?: string | null; avatarUrl?: string | null; updatedAt: Date } = {
      updatedAt: new Date()
    };
    
    if (alias !== undefined) {
      // Validate alias: 2-30 characters, alphanumeric + underscores only
      if (alias && (alias.length < 2 || alias.length > 30 || !/^[a-zA-Z0-9_]+$/.test(alias))) {
        return res.status(400).json({
          message: "Alias must be 2-30 characters and contain only letters, numbers, and underscores"
        });
      }
      updateData.alias = alias || null;
    }
    if (avatarUrl !== undefined) {
      updateData.avatarUrl = avatarUrl || null;
    }
    
    const [user] = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, userId))
      .returning({ alias: users.alias, avatarUrl: users.avatarUrl });
    
    res.json({
      alias: user?.alias ?? null,
      avatarUrl: user?.avatarUrl ?? null
    });
  }));

  // Avatar image upload with compression
  const avatarUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    fileFilter: (_req, file, cb) => {
      if (file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new Error('Only image files are allowed'));
      }
    }
  });

  app.post("/api/user/avatar", isAuthenticated, avatarUpload.single('avatar'), asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    
    if (!req.file) {
      return res.status(400).json({ message: "No image file uploaded" });
    }

    const sharp = (await import('sharp')).default;
    
    // Compress and resize the image to 256x256 max, quality 80%
    const compressedBuffer = await sharp(req.file.buffer)
      .resize(256, 256, {
        fit: 'cover',
        position: 'center'
      })
      .jpeg({ quality: 80 })
      .toBuffer();

    // Generate unique filename
    const filename = `avatar-${userId}-${Date.now()}.jpg`;
    
    // Upload to object storage using ObjectStorageService
    const objectStorageService = new ObjectStorageService();
    const avatarUrl = await objectStorageService.uploadPublicObject(`avatars/${filename}`, compressedBuffer, 'image/jpeg');

    // Update user's avatar URL in database
    await db
      .update(users)
      .set({ avatarUrl, updatedAt: new Date() })
      .where(eq(users.id, userId));

    res.json({ avatarUrl });
  }));

  app.get("/api/podcasts", async (_req, res) => {
    try {
      const podcasts = await storage.getAllGeneratedPodcasts();
      res.json(podcasts);
    } catch (error: any) {
      console.error("Error fetching podcasts:", error);
      res.status(500).json({ 
        message: error.message || "Failed to fetch podcasts" 
      });
    }
  });

  app.get("/api/podcasts/public", asyncHandler(async (req, res) => {
    const requestId = `pub-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    console.log(`[Route] /api/podcasts/public [${requestId}] query:`, req.query);
    
    const { limit, offset, sortBy, filterByTemplate, slim } = publicPodcastsQuerySchema.parse(req.query);
    
    const [podcasts, total] = await Promise.all([
      storage.getPublicPodcastsSorted(limit, offset, sortBy, filterByTemplate),
      storage.getPublicPodcastCount(filterByTemplate),
    ]);
    
    console.log(`[Route] /api/podcasts/public [${requestId}] returning ${podcasts.length}/${total} podcasts (slim=${slim})`);
    if (podcasts.length === 0) {
      console.warn(`[Route] ⚠️ /api/podcasts/public [${requestId}] returning EMPTY array to client`);
      return res.json({ podcasts: [], total });
    }

    const userId = req.user?.id;

    // slim=1: skip expensive topComment/userLike queries.
    // Engagement counts are already inlined by getPublicPodcastsSorted() at the
    // storage layer — no extra query needed here.
    if (slim) {
      return res.json({ podcasts, total });
    }

    const podcastIds = podcasts.map(p => p.id);
    const [engagementMap, topCommentsMap, userLikesMap] = await Promise.all([
      storage.getBatchEngagement(podcastIds),
      storage.getBatchTopComments(podcastIds),
      userId ? storage.getBatchUserLikes(podcastIds, userId) : Promise.resolve(new Map()),
    ]);
    
    const enrichedPodcasts = podcasts.map(podcast => ({
      ...podcast,
      _engagement: engagementMap.get(podcast.id) || null,
      _topComment: topCommentsMap.get(podcast.id) || null,
      _userLike: userLikesMap.get(podcast.id) || null,
    }));
    
    res.json({ podcasts: enrichedPodcasts, total });
  }));

  app.get("/api/podcasts/mine", async (req, res) => {
    const requestId = `mine-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
      const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

      const cacheHeader = 'private, max-age=0, stale-while-revalidate=30';
      const userId = req.user?.id;
      if (!userId) {
        console.log(`[Route] /api/podcasts/mine [${requestId}] no userId, returning public podcasts`);
        const [publicPodcasts, publicTotal] = await Promise.all([
          storage.getPublicPodcastsSorted(limit, offset, 'newest'),
          storage.getPublicPodcastCount(),
        ]);
        res.setHeader('Cache-Control', cacheHeader);
        return res.json({ podcasts: publicPodcasts, total: publicTotal });
      }
      console.log(`[Route] /api/podcasts/mine [${requestId}] userId=${userId?.substring(0, 8)}..., limit=${limit}, offset=${offset}`);
      
      const [podcasts, total] = await Promise.all([
        storage.getMyPodcasts(userId, limit, offset),
        storage.getMyPodcastsCount(userId),
      ]);
      
      console.log(`[Route] /api/podcasts/mine [${requestId}] returning ${podcasts.length}/${total} podcasts`);
      if (podcasts.length === 0 && offset === 0) {
        console.warn(`[Route] ⚠️ /api/podcasts/mine [${requestId}] returning EMPTY for userId=${userId}`);
        res.setHeader('Cache-Control', cacheHeader);
        return res.json({ podcasts: [], total: 0 });
      }
      
      // Batch fetch engagement data, top comments for all podcasts
      const podcastIds = podcasts.map(p => p.id);
      
      const [engagementMap, topCommentsMap, userLikesMap] = await Promise.all([
        storage.getBatchEngagement(podcastIds),
        storage.getBatchTopComments(podcastIds),
        storage.getBatchUserLikes(podcastIds, userId),
      ]);
      
      // Enrich podcasts with pre-fetched data
      const enrichedPodcasts = podcasts.map(podcast => ({
        ...podcast,
        _engagement: engagementMap.get(podcast.id) || null,
        _topComment: topCommentsMap.get(podcast.id) || null,
        _userLike: userLikesMap.get(podcast.id) || null,
      }));
      
      res.setHeader('Cache-Control', 'private, max-age=0, stale-while-revalidate=30');
      res.json({ podcasts: enrichedPodcasts, total });
    } catch (error: any) {
      console.error(`[Route] ❌ /api/podcasts/mine [${requestId}] ERROR:`, error.message);
      res.status(500).json({ 
        message: error.message || "Failed to fetch my podcasts" 
      });
    }
  });

  // Smart voice-search over the full library. Used by the voice assistant to
  // resolve play/queue requests by recency ("latest", "yesterday"), partial
  // phrasing, and topic/title hints. Unlike /api/podcasts/mine this scans the
  // whole library (not just the first 50/page) and parses recency hints out
  // of natural-language queries server-side.
  app.get("/api/podcasts/search-mine", async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Sign in to search your library" });
      }

      const rawQuery = (req.query.q as string | undefined)?.toString() ?? "";
      const limit = Math.min(parseInt(req.query.limit as string) || 8, 20);
      const excludeRaw = (req.query.exclude as string | undefined) ?? "";
      const excludeIds = new Set(
        excludeRaw.split(",").map((s) => s.trim()).filter(Boolean)
      );

      const parsed = parseVoiceSearchQuery(rawQuery);

      // Resolve speaker tokens against the global voice catalog so we can
      // pre-filter the SQL by matching voice IDs and award scoring boosts
      // for episodes whose hosts/voices match the speaker hint.
      //
      // generation_params arrays use mixed identifier shapes across the
      // history of the project:
      //   - selectedVoiceIds → voices.id UUIDs
      //   - assignedVoices   → alias names (e.g. "Drake")
      //   - hostVoices       → either alias names or googleVoiceNames
      //   - selectedVoicePool → either UUIDs or googleVoiceNames
      // We therefore expand each matched voice into ALL of its known
      // identifier forms and the SQL filter @>-matches any of them in any
      // of the four jsonb arrays.
      let voiceIdentifiersForSpeaker: string[] = [];
      const voiceCorpusByVoiceIdentifier = new Map<string, Set<string>>();
      let matchedVoiceCount = 0;
      if (parsed.speakerTokens.length > 0) {
        const allVoices = await db
          .select({
            id: voices.id,
            googleVoiceName: voices.googleVoiceName,
            displayName: voices.displayName,
            aliasName: voices.aliasName,
          })
          .from(voices);
        const allIdentifiers = new Set<string>();
        for (const v of allVoices) {
          const aliasLower = (v.aliasName || "").toLowerCase();
          const displayLower = (v.displayName || "").toLowerCase();
          const googleLower = (v.googleVoiceName || "").toLowerCase();
          const matched = parsed.speakerTokens.some((tok) => {
            return (
              aliasLower === tok ||
              aliasLower.split(/\s+/).includes(tok) ||
              displayLower.includes(tok) ||
              googleLower.includes(tok)
            );
          });
          if (matched) {
            matchedVoiceCount++;
            // Build the per-voice corpus once.
            const corpus = new Set<string>();
            for (const t of aliasLower.split(/\s+/)) if (t.length > 1) corpus.add(t);
            for (const t of displayLower.split(/[\s-]+/)) if (t.length > 1) corpus.add(t);
            // Register every identifier the voice could be referenced by so
            // both the SQL filter and the per-podcast corpus lookup match.
            const identifiers = [
              v.id,
              v.googleVoiceName,
              v.aliasName,
            ].filter((s): s is string => typeof s === "string" && s.length > 0);
            for (const ident of identifiers) {
              allIdentifiers.add(ident);
              voiceCorpusByVoiceIdentifier.set(ident, corpus);
            }
          }
        }
        voiceIdentifiersForSpeaker = Array.from(allIdentifiers);
      }

      const candidates = await storage.searchMyPodcasts(userId, {
        query: parsed.cleanedQuery,
        sinceMs: parsed.sinceMs,
        untilMs: parsed.untilMs,
        moods: parsed.moods.length > 0 ? parsed.moods : undefined,
        voiceIds:
          voiceIdentifiersForSpeaker.length > 0
            ? voiceIdentifiersForSpeaker
            : undefined,
        // No explicit limit — searchMyPodcasts auto-sizes (up to 500) when
        // any filter is present so we scan the user's full library.
      });

      // Build a per-podcast speaker corpus from the matched voices that
      // appear in each candidate's generationParams. This lets the scorer
      // award speaker bonuses even though the SQL prefilter already narrowed
      // the candidate set.
      const speakerCorpusByPodcast = new Map<string, Set<string>>();
      if (voiceIdentifiersForSpeaker.length > 0) {
        for (const p of candidates) {
          const params = normalizeVoiceSearchParams(p.generationParams);
          const podcastVoiceIds: string[] = [
            ...(Array.isArray(params.selectedVoiceIds) ? params.selectedVoiceIds : []),
            ...(Array.isArray(params.assignedVoices) ? params.assignedVoices : []),
            ...(Array.isArray(params.hostVoices) ? params.hostVoices : []),
            ...(Array.isArray(params.selectedVoicePool) ? params.selectedVoicePool : []),
          ];
          const corpus = new Set<string>();
          for (const vid of podcastVoiceIds) {
            // Each matched voice is registered under all of its identifier
            // forms (id / googleVoiceName / aliasName), so a podcast referring
            // to the voice by any of those names finds the same corpus.
            const c = voiceCorpusByVoiceIdentifier.get(vid);
            if (c) c.forEach((tok) => corpus.add(tok));
          }
          if (corpus.size > 0) speakerCorpusByPodcast.set(p.id, corpus);
        }
      }

      const playable = candidates.filter(
        (p) => p.audioUrl && !excludeIds.has(p.id)
      );

      const scored = playable.map((p) => ({
        podcast: p,
        score: scorePodcastForVoice(p, parsed, speakerCorpusByPodcast),
      }));

      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const ta = new Date(a.podcast.timestamp).getTime();
        const tb = new Date(b.podcast.timestamp).getTime();
        return tb - ta;
      });

      const top = scored.slice(0, limit);

      res.setHeader("Cache-Control", "private, max-age=0, no-store");
      res.json({
        parsed: {
          cleanedQuery: parsed.cleanedQuery,
          recency: parsed.recencyLabel,
          wantsLatest: parsed.wantsLatest,
          moods: parsed.moods,
          speakerTokens: parsed.speakerTokens,
          matchedVoiceCount,
        },
        results: top.map((s) => ({
          podcast: s.podcast,
          score: s.score,
        })),
      });
    } catch (error: any) {
      console.error("[Route] /api/podcasts/search-mine error:", error?.message);
      res.status(500).json({ message: error?.message || "Search failed" });
    }
  });

  app.get("/api/podcasts/favorites", async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.json([]);
      const podcasts = await storage.getMyFavorites(userId);
      res.json(podcasts);
    } catch (error: any) {
      console.error("Error fetching favorites:", error);
      res.status(500).json({ 
        message: error.message || "Failed to fetch favorites" 
      });
    }
  });

  app.get("/api/podcasts/continue-listening", async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.json([]);
      const limit = parseInt(req.query.limit as string) || 10;
      const podcasts = await storage.getContinueListening(userId, limit);
      res.json(podcasts);
    } catch (error: any) {
      console.error("Error fetching continue listening:", error);
      res.status(500).json({ 
        message: error.message || "Failed to fetch continue listening" 
      });
    }
  });

  // Save resume position (throttled client-side to ~every 10s while playing)
  app.post("/api/playback-progress", async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const { podcastId, positionSeconds, durationSeconds } = req.body || {};
      if (typeof podcastId !== "string" || !podcastId) {
        return res.status(400).json({ message: "podcastId required" });
      }
      const pos = Number(positionSeconds);
      const dur = Number(durationSeconds);
      if (!Number.isFinite(pos) || !Number.isFinite(dur)) {
        return res.status(400).json({ message: "positionSeconds/durationSeconds must be numbers" });
      }
      const row = await storage.upsertPlaybackProgress(userId, podcastId, pos, dur);
      res.json(row);
    } catch (error: any) {
      console.error("Error saving playback progress:", error);
      res.status(500).json({ message: error.message || "Failed to save progress" });
    }
  });

  // Fetch resume position so the player can seek to it on PLAY_PODCAST
  app.get("/api/playback-progress/:podcastId", async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.json(null);
      const { podcastId } = req.params;
      const row = await storage.getPlaybackProgress(userId, podcastId);
      res.json(row || null);
    } catch (error: any) {
      console.error("Error fetching playback progress:", error);
      res.status(500).json({ message: error.message || "Failed to fetch progress" });
    }
  });

  app.get("/api/podcasts/recommended", async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.json([]);
      const limit = parseInt(req.query.limit as string) || 10;
      const podcasts = await storage.getRecommended(userId, limit);
      res.json(podcasts);
    } catch (error: any) {
      console.error("Error fetching recommended:", error);
      res.status(500).json({ 
        message: error.message || "Failed to fetch recommended" 
      });
    }
  });

  // Get podcast recommendations based on a source podcast
  app.get("/api/recommendations/:podcastId", async (req, res) => {
    try {
      const { podcastId } = req.params;
      
      // Check cache first
      const cached = getCachedRecommendations(podcastId);
      if (cached) {
        return res.json({ recommendations: cached });
      }
      
      // Fetch the source podcast
      const [sourcePodcast] = await db
        .select()
        .from(generatedPodcasts)
        .where(eq(generatedPodcasts.id, podcastId));
      
      if (!sourcePodcast) {
        return res.status(404).json({ message: "Podcast not found" });
      }
      
      // Get all public podcasts excluding the source
      const publicPodcasts = await storage.getPublicPodcasts();
      const candidatePodcasts = publicPodcasts.filter(p => p.id !== podcastId);
      
      if (candidatePodcasts.length === 0) {
        setCachedRecommendations(podcastId, []);
        return res.json({ recommendations: [] });
      }
      
      // Extract keywords from source topic (simple word tokenization)
      const sourceKeywords = sourcePodcast.topic
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(word => word.length > 3);
      
      // Score each podcast based on similarity
      const scoredPodcasts = candidatePodcasts.map(podcast => {
        let score = 0;
        
        // Same template category = higher score
        if (podcast.templateCategory === sourcePodcast.templateCategory) {
          score += 10;
        }
        
        // Keyword matching in topic
        const podcastWords = podcast.topic
          .toLowerCase()
          .replace(/[^\w\s]/g, '')
          .split(/\s+/)
          .filter(word => word.length > 3);
        
        const matchingKeywords = sourceKeywords.filter(keyword => 
          podcastWords.some(word => word.includes(keyword) || keyword.includes(word))
        );
        score += matchingKeywords.length * 2;
        
        // Title keyword matching (if title exists)
        if (podcast.title && sourcePodcast.title) {
          const titleWords = podcast.title
            .toLowerCase()
            .replace(/[^\w\s]/g, '')
            .split(/\s+/)
            .filter(word => word.length > 3);
          
          const sourceTitleWords = sourcePodcast.title
            .toLowerCase()
            .replace(/[^\w\s]/g, '')
            .split(/\s+/)
            .filter(word => word.length > 3);
          
          const titleMatches = sourceTitleWords.filter(keyword =>
            titleWords.some(word => word.includes(keyword) || keyword.includes(word))
          );
          score += titleMatches.length;
        }
        
        return { podcast, score };
      });
      
      // Sort by score (descending) and take top 4
      const recommendations = scoredPodcasts
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 4)
        .map(item => item.podcast);
      
      // If not enough recommendations with score > 0, fill with same category podcasts
      if (recommendations.length < 4) {
        const sameCategoryPodcasts = candidatePodcasts
          .filter(p => 
            p.templateCategory === sourcePodcast.templateCategory && 
            !recommendations.some(r => r.id === p.id)
          )
          .slice(0, 4 - recommendations.length);
        recommendations.push(...sameCategoryPodcasts);
      }
      
      // Cache the results
      setCachedRecommendations(podcastId, recommendations);
      
      res.json({ recommendations });
    } catch (error: any) {
      console.error("Error fetching recommendations:", error);
      res.status(500).json({ 
        message: error.message || "Failed to fetch recommendations" 
      });
    }
  });

  // Get trending podcasts (public endpoint) - MUST be before /:id route
  app.get("/api/podcasts/trending", async (req, res) => {
    const requestId = `trnd-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    console.log(`[Route] /api/podcasts/trending [${requestId}] query:`, req.query);
    
    try {
      const limit = Math.min(Number(req.query.limit) || 20, 100);
      const timeframe = (req.query.timeframe as 'hour' | 'day' | 'week') || 'day';
      const slim = req.query.slim === '1' || req.query.slim === 'true';
      
      const podcasts = await storage.getTrendingPodcasts(limit, timeframe);
      
      console.log(`[Route] /api/podcasts/trending [${requestId}] returning ${podcasts.length} podcasts (slim=${slim})`);
      if (podcasts.length === 0) {
        console.warn(`[Route] ⚠️ /api/podcasts/trending [${requestId}] returning EMPTY array to client`);
        return res.json([]);
      }

      // slim=1: skip expensive topComment/userLike queries; still include engagement
      // counts which are already available from the LEFT JOIN in getTrendingPodcasts.
      // p.engagement is typed on PodcastWithEngagement (no cast needed).
      if (slim) {
        const slimPodcasts: EnrichedPodcast[] = podcasts.map(p => ({
          ...p,
          _engagement: p.engagement || null,
        }));
        return res.json(slimPodcasts);
      }
      
      // Batch fetch engagement data, top comments for all podcasts (major performance optimization)
      const podcastIds = podcasts.map(p => p.id);
      const userId = req.user?.id;
      
      const [engagementMap, topCommentsMap, userLikesMap] = await Promise.all([
        storage.getBatchEngagement(podcastIds),
        storage.getBatchTopComments(podcastIds),
        userId ? storage.getBatchUserLikes(podcastIds, userId) : Promise.resolve(new Map()),
      ]);
      
      // Enrich podcasts with pre-fetched data
      const enrichedPodcasts = podcasts.map(podcast => ({
        ...podcast,
        _engagement: engagementMap.get(podcast.id) || null,
        _topComment: topCommentsMap.get(podcast.id) || null,
        _userLike: userLikesMap.get(podcast.id) || null,
      }));
      
      res.json(enrichedPodcasts);
    } catch (error: any) {
      console.error(`[Route] ❌ /api/podcasts/trending [${requestId}] ERROR:`, error.message);
      res.status(500).json({ 
        message: error.message || "Failed to fetch trending podcasts" 
      });
    }
  });

  // Get single podcast by ID (for shared links - public podcasts or owned private podcasts)
  app.get("/api/podcasts/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user?.id;
      
      // Try to get the podcast
      const [podcast] = await db
        .select()
        .from(generatedPodcasts)
        .where(eq(generatedPodcasts.id, id));
      
      if (!podcast) {
        return res.status(404).json({ message: "Podcast not found" });
      }

      // Check if podcast is public or owned by the user
      if (!podcast.isPublic && podcast.userId !== userId) {
        return res.status(404).json({ message: "Podcast not found or not accessible" });
      }

      res.json(podcast);
    } catch (error: any) {
      console.error("Error fetching podcast:", error);
      res.status(500).json({ 
        message: error.message || "Failed to fetch podcast" 
      });
    }
  });

  // Get single public podcast by ID (for embeds)
  app.get("/api/podcasts/:id/public", async (req, res) => {
    try {
      const { id } = req.params;
      const podcast = await storage.getPublicPodcastById(id);
      
      if (!podcast) {
        return res.status(404).json({ message: "Podcast not found or not public" });
      }

      // Return minimal fields needed for embed
      const embedData = {
        id: podcast.id,
        topic: podcast.topic,
        audioUrl: podcast.audioUrl,
        coverImageUrl: podcast.coverImageUrl,
        duration: podcast.duration,
        templateCategory: podcast.templateCategory,
      };

      res.json(embedData);
    } catch (error: any) {
      console.error("Error fetching public podcast:", error);
      res.status(500).json({ 
        message: error.message || "Failed to fetch podcast" 
      });
    }
  });

  app.patch("/api/podcasts/:id/favorite", async (req, res) => {
    try {
      const { id } = req.params;
      const { isFavorite } = z.object({ 
        isFavorite: z.boolean() 
      }).parse(req.body);

      const updatedPodcast = await storage.updatePodcastFavorite(id, isFavorite);
      
      if (!updatedPodcast) {
        return res.status(404).json({ message: "Podcast not found" });
      }

      res.json(updatedPodcast);
    } catch (error: any) {
      console.error("Error updating favorite:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid request data",
          errors: error.errors 
        });
      }

      res.status(500).json({ 
        message: error.message || "Failed to update favorite" 
      });
    }
  });

  // Check if podcast is liked (for audio player)
  app.get("/api/podcasts/likes/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const [podcast] = await db
        .select({ isFavorite: generatedPodcasts.isFavorite })
        .from(generatedPodcasts)
        .where(eq(generatedPodcasts.id, id));
      
      if (!podcast) {
        return res.status(404).json({ message: "Podcast not found" });
      }

      res.json({ isLiked: podcast.isFavorite });
    } catch (error: any) {
      console.error("Error checking like status:", error);
      res.status(500).json({ 
        message: error.message || "Failed to check like status" 
      });
    }
  });

  // NOTE: Legacy POST/DELETE /api/podcasts/:id/like handlers were removed because
  // they shadowed the real like/dislike endpoint at the bottom of this file (which
  // returns { like, engagement } and powers the LikeDislikeButtons component).
  // The "save to favorites" feature is served by PATCH /api/podcasts/:id/favorite above.

  app.patch("/api/podcasts/:id/toggle-visibility", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { id } = req.params;
      
      // First get the podcast to check its template category
      const podcast = await db.query.generatedPodcasts.findFirst({
        where: eq(generatedPodcasts.id, id)
      });
      
      if (!podcast) {
        return res.status(404).json({ message: "Podcast not found" });
      }
      
      if (podcast.userId && podcast.userId !== userId) {
        return res.status(403).json({ message: "Unauthorized" });
      }
      
      // Toggle visibility
      const updatedPodcast = await storage.togglePodcastVisibility(id, userId);
      
      if (!updatedPodcast) {
        return res.status(404).json({ message: "Podcast not found or unauthorized" });
      }

      res.json(updatedPodcast);
    } catch (error: any) {
      console.error("Error toggling visibility:", error);
      res.status(500).json({ 
        message: error.message || "Failed to toggle visibility" 
      });
    }
  });

  app.post("/api/podcasts/:id/increment-play", async (req, res) => {
    try {
      const { id } = req.params;
      const updatedPodcast = await storage.incrementPlayCount(id);
      
      if (!updatedPodcast) {
        return res.status(404).json({ message: "Podcast not found" });
      }

      res.json(updatedPodcast);
    } catch (error: any) {
      console.error("Error incrementing play count:", error);
      res.status(500).json({ 
        message: error.message || "Failed to increment play count" 
      });
    }
  });

  // Update podcast metadata (title, description) for RSS distribution
  app.patch("/api/podcasts/:id/metadata", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { id } = req.params;
      
      const schema = z.object({
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(4000).optional(),
      });
      
      const data = schema.parse(req.body);
      
      if (!data.title && data.description === undefined) {
        return res.status(400).json({ message: "At least one field (title or description) is required" });
      }
      
      const updated = await storage.updatePodcastMetadata(id, userId, data);
      
      if (!updated) {
        return res.status(404).json({ message: "Podcast not found or unauthorized" });
      }
      
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating podcast metadata:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid request data",
          errors: error.errors 
        });
      }
      
      res.status(500).json({ 
        message: error.message || "Failed to update podcast metadata" 
      });
    }
  });

  app.delete("/api/podcasts/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deletePodcast(id);
      
      if (!deleted) {
        return res.status(404).json({ message: "Podcast not found" });
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting podcast:", error);
      res.status(500).json({ 
        message: error.message || "Failed to delete podcast" 
      });
    }
  });

  // Delete podcasts older than 7 days
  app.post("/api/podcasts/cleanup/old", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const deletedCount = await storage.deleteOldPodcasts(userId, 7);
      
      res.json({ success: true, deletedCount });
    } catch (error: any) {
      console.error("Error cleaning up old podcasts:", error);
      res.status(500).json({ 
        message: error.message || "Failed to cleanup old podcasts" 
      });
    }
  });

  // ==================== PLAYLIST ROUTES ====================
  
  // Get all playlists for current user
  app.get("/api/playlists", async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.json([]);
      const userPlaylists = await storage.getPlaylistsByUser(userId);
      res.json(userPlaylists);
    } catch (error: any) {
      console.error("Error fetching playlists:", error);
      res.status(500).json({ 
        message: error.message || "Failed to fetch playlists" 
      });
    }
  });

  // Create a new playlist
  app.post("/api/playlists", async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ message: "Authentication required to create playlists" });
      const schema = z.object({
        name: z.string().min(1).max(100),
        description: z.string().optional(),
        isPublic: z.boolean().optional().default(false),
      });
      
      const { name, description, isPublic } = schema.parse(req.body);
      
      // Generate playlist cover art based on the name
      let coverImageUrl: string | null = null;
      try {
        console.log(`[Playlist] Generating cover art for playlist: "${name}"`);
        coverImageUrl = await generatePlaylistCoverArt(name);
        console.log(`[Playlist] Cover art generated successfully for: "${name}"`);
      } catch (coverError) {
        console.warn(`[Playlist] Failed to generate cover art for "${name}":`, coverError);
        // Continue without cover art - it will be null
      }
      
      const playlist = await storage.createPlaylist({
        userId,
        name,
        description: description || null,
        coverImageUrl,
        isPublic,
      });
      
      res.status(201).json(playlist);
    } catch (error: any) {
      console.error("Error creating playlist:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid request data",
          errors: error.errors 
        });
      }
      
      res.status(500).json({ 
        message: error.message || "Failed to create playlist" 
      });
    }
  });

  // Get a specific playlist with items
  app.get("/api/playlists/:id", async (req, res) => {
    try {
      const userId = req.user?.id;
      const { id } = req.params;
      
      const playlist = await storage.getPlaylistWithItems(id);
      
      if (!playlist) {
        return res.status(404).json({ message: "Playlist not found" });
      }
      
      if (!playlist.isPublic && playlist.userId !== userId) {
        return res.status(403).json({ message: "Unauthorized" });
      }
      
      res.json(playlist);
    } catch (error: any) {
      console.error("Error fetching playlist:", error);
      res.status(500).json({ 
        message: error.message || "Failed to fetch playlist" 
      });
    }
  });

  // Update a playlist
  app.patch("/api/playlists/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { id } = req.params;
      
      const schema = z.object({
        name: z.string().min(1).max(100).optional(),
        description: z.string().optional(),
        isPublic: z.boolean().optional(),
      });
      
      const data = schema.parse(req.body);
      
      // If name is being updated, regenerate cover art
      let updateData: typeof data & { coverImageUrl?: string } = { ...data };
      if (data.name) {
        try {
          console.log(`[Playlist] Regenerating cover art for renamed playlist: "${data.name}"`);
          const newCoverImageUrl = await generatePlaylistCoverArt(data.name);
          updateData.coverImageUrl = newCoverImageUrl;
          console.log(`[Playlist] Cover art regenerated for: "${data.name}"`);
        } catch (coverError) {
          console.warn(`[Playlist] Failed to regenerate cover art for "${data.name}":`, coverError);
          // Continue with update without new cover art
        }
      }
      
      const updated = await storage.updatePlaylist(id, userId, updateData);
      
      if (!updated) {
        return res.status(404).json({ message: "Playlist not found or unauthorized" });
      }
      
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating playlist:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid request data",
          errors: error.errors 
        });
      }
      
      res.status(500).json({ 
        message: error.message || "Failed to update playlist" 
      });
    }
  });

  // Delete a playlist
  app.delete("/api/playlists/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { id } = req.params;
      
      const deleted = await storage.deletePlaylist(id, userId);
      
      if (!deleted) {
        return res.status(404).json({ message: "Playlist not found or unauthorized" });
      }
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting playlist:", error);
      res.status(500).json({ 
        message: error.message || "Failed to delete playlist" 
      });
    }
  });

  // Add podcast to a playlist
  app.post("/api/playlists/:id/items", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { id } = req.params;
      
      const schema = z.object({
        podcastId: z.string().min(1),
      });
      
      const { podcastId } = schema.parse(req.body);
      
      // Verify playlist ownership
      const playlist = await storage.getPlaylistById(id);
      if (!playlist || playlist.userId !== userId) {
        return res.status(404).json({ message: "Playlist not found or unauthorized" });
      }
      
      const item = await storage.addToPlaylist(id, podcastId);
      
      res.status(201).json(item);
    } catch (error: any) {
      console.error("Error adding to playlist:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid request data",
          errors: error.errors 
        });
      }
      
      res.status(500).json({ 
        message: error.message || "Failed to add to playlist" 
      });
    }
  });

  // Remove podcast from a playlist
  app.delete("/api/playlists/:playlistId/items/:podcastId", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { playlistId, podcastId } = req.params;
      
      // Verify playlist ownership
      const playlist = await storage.getPlaylistById(playlistId);
      if (!playlist || playlist.userId !== userId) {
        return res.status(404).json({ message: "Playlist not found or unauthorized" });
      }
      
      const removed = await storage.removeFromPlaylist(playlistId, podcastId);
      
      if (!removed) {
        return res.status(404).json({ message: "Item not found in playlist" });
      }
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error removing from playlist:", error);
      res.status(500).json({ 
        message: error.message || "Failed to remove from playlist" 
      });
    }
  });

  // Reorder playlist items
  app.patch("/api/playlists/:id/reorder", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { id } = req.params;
      
      const schema = z.object({
        items: z.array(z.object({
          podcastId: z.string(),
          position: z.number().int().min(0),
        })),
      });
      
      const { items } = schema.parse(req.body);
      
      // Verify playlist ownership
      const playlist = await storage.getPlaylistById(id);
      if (!playlist || playlist.userId !== userId) {
        return res.status(404).json({ message: "Playlist not found or unauthorized" });
      }
      
      await storage.reorderPlaylistItems(id, items);
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error reordering playlist:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid request data",
          errors: error.errors 
        });
      }
      
      res.status(500).json({ 
        message: error.message || "Failed to reorder playlist" 
      });
    }
  });

  // Get playlists containing a specific podcast
  app.get("/api/podcasts/:podcastId/playlists", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { podcastId } = req.params;
      
      const playlistIds = await storage.getPlaylistsContainingPodcast(podcastId, userId);
      
      res.json({ playlistIds });
    } catch (error: any) {
      console.error("Error fetching podcast playlists:", error);
      res.status(500).json({ 
        message: error.message || "Failed to fetch podcast playlists" 
      });
    }
  });

  // ==================== FAVORITE TOPICS (Daily Personalized News) ====================
  // Get user's favorite topics
  app.get("/api/favorite-topics", async (req: any, res) => {
    try {
      const userId = req.isAuthenticated() && req.user ? req.user.id : null;
      const guestId = !userId ? (req.headers['x-guest-id'] as string | undefined) : undefined;
      const validGuestId = guestId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(guestId) ? guestId : undefined;
      if (!userId && !validGuestId) {
        return res.json({ topics: [] });
      }
      const topics = await storage.listFavoriteTopics(userId, validGuestId);
      res.json({ topics });
    } catch (error: any) {
      console.error("Error fetching favorite topics:", error);
      res.status(500).json({ 
        message: error.message || "Failed to fetch favorite topics" 
      });
    }
  });

  // Add a new favorite topic
  app.post("/api/favorite-topics", requireIdentity, async (req, res) => {
    try {
      const userId = req.userId ?? null;
      const guestId = req.guestId;
      
      const schema = z.object({
        label: z.string().min(1, "Topic is required").max(200, "Topic too long"),
        category: z.enum(['sports', 'weather', 'finance', 'tech', 'entertainment', 'politics', 'health', 'custom']).optional().default('custom'),
      });
      
      const { label, category } = schema.parse(req.body);
      
      // Check if user has reached the limit (max 20 topics)
      const existing = await storage.listFavoriteTopics(userId, guestId);
      if (existing.length >= 20) {
        return res.status(400).json({ 
          message: "You have reached the maximum of 20 favorite topics. Please remove some before adding more." 
        });
      }
      
      const topic = await storage.addFavoriteTopic({ 
        userId,
        guestId,
        label, 
        category,
      });
      
      res.json({ topic });
    } catch (error: any) {
      console.error("Error adding favorite topic:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid request data",
          errors: error.errors 
        });
      }
      
      res.status(500).json({ 
        message: error.message || "Failed to add favorite topic" 
      });
    }
  });

  // Remove a favorite topic
  app.delete("/api/favorite-topics/:id", requireIdentity, async (req, res) => {
    try {
      const userId = req.userId ?? null;
      const guestId = req.guestId;
      const { id } = req.params;
      
      const deleted = await storage.removeFavoriteTopic(id, userId, guestId);
      
      if (!deleted) {
        return res.status(404).json({ message: "Topic not found or unauthorized" });
      }
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error removing favorite topic:", error);
      res.status(500).json({ 
        message: error.message || "Failed to remove favorite topic" 
      });
    }
  });

  // Reorder favorite topics
  app.patch("/api/favorite-topics/reorder", requireIdentity, async (req, res) => {
    try {
      const userId = req.userId ?? null;
      const guestId = req.guestId;
      
      const schema = z.object({
        positions: z.array(z.object({
          id: z.string(),
          position: z.number().min(0),
        })),
      });
      
      const { positions } = schema.parse(req.body);
      
      await storage.updateFavoriteTopicPositions(userId, positions, guestId);
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error reordering favorite topics:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid request data",
          errors: error.errors 
        });
      }
      
      res.status(500).json({ 
        message: error.message || "Failed to reorder favorite topics" 
      });
    }
  });

  // ==================== NEWS PRESETS (Format, Style, Voice settings) ====================
  // Get user's news preset
  app.get("/api/news-preset", async (req: any, res) => {
    try {
      const userId: string | null = req.isAuthenticated() && req.user?.id ? req.user.id : null;
      const guestId = req.headers['x-guest-id'] as string | undefined;
      if (!userId && (!guestId || !/^[0-9a-f-]{36}$/i.test(guestId))) {
        return res.json({ preset: null });
      }
      const preset = await storage.getNewsPreset(userId, guestId);
      res.json({ preset: preset || null });
    } catch (error: any) {
      console.error("Error fetching news preset:", error);
      res.status(500).json({ 
        message: error.message || "Failed to fetch news preset" 
      });
    }
  });

  // Create or update news preset (upsert)
  app.post("/api/news-preset", requireIdentity, async (req: any, res) => {
    try {
      const userId: string | null = req.userId || null;
      const guestId: string | undefined = req.guestId;
      
      const schema = z.object({
        // Main preset settings (all optional for partial updates)
        durationMinutes: z.number().min(2).max(60).optional(),
        languageComplexity: z.number().min(1).max(10).optional(),
        numPeople: z.number().min(1).max(3).optional(),
        podcastStyle: z.enum(ALL_PODCAST_STYLES).optional(),
        timeFrame: z.enum(["past24h", "pastWeek", "pastMonth", "pastYear", "allTime", "next24h", "nextWeek", "nextMonth", "nextYear"]).optional(),
        coHostPersonality: z.enum(["casual", "academic", "executive", "storyteller", "investigative"]).optional(),
        podcastMood: z.enum(["uplifting", "serious", "humorous", "mysterious", "balanced", "energetic"]).optional(),
        language: z.string().optional(),
        selectedVoiceIds: z.array(z.string()).optional(),
        // Auto-generation settings
        autoGenerateEnabled: z.boolean().optional(),
        autoGenerateTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), // HH:mm format
        autoGenerateTimezone: z.string().optional(),
        autoGeneratePublic: z.boolean().optional(),
        // Quick Brew independent settings
        quickBrewEnabled: z.boolean().optional(),
        quickBrewDurationMinutes: z.number().min(2).max(60).optional(),
        quickBrewNumPeople: z.number().min(1).max(3).optional(),
        quickBrewPodcastStyle: z.enum(ALL_PODCAST_STYLES).optional(),
        quickBrewPodcastMood: z.enum(["uplifting", "serious", "humorous", "mysterious", "balanced", "energetic"]).optional(),
        quickBrewVoiceIds: z.array(z.string()).optional(),
      });
      
      const data = schema.parse(req.body);
      
      // Check if preset exists
      const existing = await storage.getNewsPreset(userId, guestId);
      
      let preset;
      if (existing) {
        preset = await storage.updateNewsPreset(userId, data, guestId);
      } else {
        preset = await storage.createNewsPreset({
          userId: userId ?? undefined,
          name: 'Default',
          isDefault: true,
          ...data,
          guestId: guestId ?? undefined,
        });
      }
      
      res.json({ preset });
    } catch (error: any) {
      console.error("Error saving news preset:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid preset data",
          errors: error.errors 
        });
      }
      
      res.status(500).json({ 
        message: error.message || "Failed to save news preset" 
      });
    }
  });

  // Delete news preset
  app.delete("/api/news-preset", requireIdentity, async (req: any, res) => {
    try {
      const userId: string | null = req.userId || null;
      const guestId: string | undefined = req.guestId;
      const deleted = await storage.deleteNewsPreset(userId, guestId);
      
      if (!deleted) {
        return res.status(404).json({ message: "Preset not found" });
      }
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting news preset:", error);
      res.status(500).json({ 
        message: error.message || "Failed to delete news preset" 
      });
    }
  });

  // ==================== TEACHME PRESETS (Daily Micro-Learning) ====================
  // Get user's active teachme preset
  app.get("/api/teachme-preset", requireIdentity, async (req: any, res) => {
    try {
      const userId: string | null = req.userId || null;
      const guestId: string | undefined = req.guestId;
      const preset = await storage.getTeachmePreset(userId, guestId);
      res.json({ preset: preset || null });
    } catch (error: any) {
      console.error("Error fetching teachme preset:", error);
      res.status(500).json({ 
        message: error.message || "Failed to fetch teachme preset" 
      });
    }
  });

  // Get all user's teachme presets (courses)
  app.get("/api/teachme-presets", requireIdentity, async (req: any, res) => {
    try {
      const userId: string | null = req.userId || null;
      const guestId: string | undefined = req.guestId;
      const presets = await storage.getTeachmePresets(userId, guestId);
      res.json({ presets });
    } catch (error: any) {
      console.error("Error fetching teachme presets:", error);
      res.status(500).json({ 
        message: error.message || "Failed to fetch teachme presets" 
      });
    }
  });

  // Create new teachme preset (micro-learning course)
  app.post("/api/teachme-preset", requireIdentity, async (req: any, res) => {
    try {
      const userId: string | null = req.userId || null;
      const guestId: string | undefined = req.guestId;
      
      const schema = z.object({
        name: z.string().min(1).max(100).default('My Course'),
        topic: z.string().min(1),
        episodeDuration: z.number().min(5).max(30).default(10),
        totalEpisodes: z.number().min(2).max(30).default(5),
        languageComplexity: z.number().min(1).max(10).default(6),
        numPeople: z.number().min(1).max(3).default(2),
        podcastStyle: z.enum(ALL_PODCAST_STYLES).default('conversational'),
        coHostPersonality: z.enum(["casual", "academic", "executive", "storyteller", "investigative"]).default('academic'),
        podcastMood: z.enum(["uplifting", "serious", "humorous", "mysterious", "balanced", "energetic"]).default('balanced'),
        language: z.string().default('en'),
        selectedVoiceIds: z.array(z.string()).default([]),
        autoGenerateEnabled: z.boolean().default(false),
        autoGenerateTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
        autoGenerateTimezone: z.string().default('UTC'),
        autoGeneratePublic: z.boolean().default(true),
        syllabus: z.array(z.object({
          episodeNumber: z.number(),
          title: z.string(),
          focusTopic: z.string(),
          keyPoints: z.array(z.string()),
          generated: z.boolean().default(false),
          podcastId: z.string().optional(),
        })),
      });
      
      const data = schema.parse(req.body);
      
      // Deactivate any existing active presets for this user/guest
      const existingPresets = await storage.getTeachmePresets(userId, guestId);
      for (const existing of existingPresets) {
        if (existing.isActive) {
          await storage.updateTeachmePreset(existing.id, userId, { isActive: false }, guestId);
        }
      }
      
      const preset = await storage.createTeachmePreset({
        userId: userId ?? undefined,
        ...data,
        guestId: guestId ?? undefined,
      });
      
      res.json({ preset });
    } catch (error: any) {
      console.error("Error creating teachme preset:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid preset data",
          errors: error.errors 
        });
      }
      
      res.status(500).json({ 
        message: error.message || "Failed to create teachme preset" 
      });
    }
  });

  // Update teachme preset
  app.patch("/api/teachme-preset/:presetId", requireIdentity, async (req: any, res) => {
    try {
      const userId: string | null = req.userId || null;
      const guestId: string | undefined = req.guestId;
      const { presetId } = req.params;
      
      const schema = z.object({
        name: z.string().min(1).max(100).optional(),
        isActive: z.boolean().optional(),
        autoGenerateEnabled: z.boolean().optional(),
        autoGenerateTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
        autoGenerateTimezone: z.string().optional(),
        autoGeneratePublic: z.boolean().optional(),
        playlistId: z.string().optional(),
      });
      
      const data = schema.parse(req.body);
      
      const preset = await storage.updateTeachmePreset(presetId, userId, data, guestId);
      
      if (!preset) {
        return res.status(404).json({ message: "Preset not found" });
      }
      
      res.json({ preset });
    } catch (error: any) {
      console.error("Error updating teachme preset:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid preset data",
          errors: error.errors 
        });
      }
      
      res.status(500).json({ 
        message: error.message || "Failed to update teachme preset" 
      });
    }
  });

  // Delete teachme preset
  app.delete("/api/teachme-preset/:presetId", requireIdentity, async (req: any, res) => {
    try {
      const userId: string | null = req.userId || null;
      const guestId: string | undefined = req.guestId;
      const { presetId } = req.params;
      
      const deleted = await storage.deleteTeachmePreset(presetId, userId, guestId);
      
      if (!deleted) {
        return res.status(404).json({ message: "Preset not found" });
      }
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting teachme preset:", error);
      res.status(500).json({ 
        message: error.message || "Failed to delete teachme preset" 
      });
    }
  });

  // Generate syllabus and create Daily Micro-Learning preset
  app.post("/api/teachme-preset/generate-syllabus", requireIdentity, async (req: any, res) => {
    try {
      const userId: string | null = req.userId || null;
      const guestId: string | undefined = req.guestId;
      
      const schema = z.object({
        topic: z.string().min(1),
        episodeCount: z.number().min(2).max(30).default(5),
        episodeDuration: z.number().min(5).max(30).default(10),
        languageComplexity: z.number().min(1).max(10).default(6),
        numPeople: z.number().min(1).max(3).default(2),
        podcastStyle: z.enum(ALL_PODCAST_STYLES).default('conversational'),
        coHostPersonality: z.enum(["casual", "academic", "executive", "storyteller", "investigative"]).default('academic'),
        podcastMood: z.enum(["uplifting", "serious", "humorous", "mysterious", "balanced", "energetic"]).default('balanced'),
        language: z.string().default('en'),
        selectedVoiceIds: z.array(z.string()).default([]),
        autoGenerateEnabled: z.boolean().default(true),
        autoGenerateTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("08:00"),
        autoGenerateTimezone: z.string().default('UTC'),
        autoGeneratePublic: z.boolean().default(true),
        refinedContext: z.string().optional(),
      });
      
      const data = schema.parse(req.body);
      
      console.log(`[Daily Micro-Learning] Generating syllabus for topic: "${data.topic.substring(0, 50)}..."`);
      
      // Generate syllabus using OpenAI
      const syllabusResponse = await generateCourseSyllabus(
        data.topic, 
        data.episodeCount, 
        data.refinedContext
      );
      
      // Transform to syllabus format with generated=false
      const syllabus: SyllabusEpisode[] = syllabusResponse.map((ep, idx) => ({
        episodeNumber: idx + 1,
        title: ep.title,
        focusTopic: ep.focusTopic,
        keyPoints: ep.keyPoints,
        generated: false,
      }));
      
      console.log(`[Daily Micro-Learning] Syllabus generated with ${syllabus.length} episodes`);
      
      // Deactivate any existing active presets for this user/guest
      const existingPresets = await storage.getTeachmePresets(userId, guestId);
      for (const existing of existingPresets) {
        if (existing.isActive) {
          await storage.updateTeachmePreset(existing.id, userId, { isActive: false }, guestId);
        }
      }
      
      // Create the preset with the generated syllabus
      const preset = await storage.createTeachmePreset({
        userId: userId ?? undefined,
        name: data.topic.length > 50 ? data.topic.substring(0, 47) + '...' : data.topic,
        topic: data.topic,
        episodeDuration: data.episodeDuration,
        totalEpisodes: data.episodeCount,
        languageComplexity: data.languageComplexity,
        numPeople: data.numPeople,
        podcastStyle: data.podcastStyle,
        coHostPersonality: data.coHostPersonality,
        podcastMood: data.podcastMood,
        language: data.language,
        selectedVoiceIds: data.selectedVoiceIds,
        autoGenerateEnabled: data.autoGenerateEnabled,
        autoGenerateTime: data.autoGenerateTime,
        autoGenerateTimezone: data.autoGenerateTimezone,
        autoGeneratePublic: data.autoGeneratePublic,
        syllabus,
        guestId: guestId ?? undefined,
      });
      
      console.log(`[Daily Micro-Learning] Preset created: ${preset.id}`);
      
      res.json({ 
        preset,
        message: `Daily Micro-Learning course scheduled! Your first episode will generate at ${data.autoGenerateTime} ${data.autoGenerateTimezone}.`
      });
    } catch (error: any) {
      console.error("Error generating Daily Micro-Learning syllabus:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid request data",
          errors: error.errors 
        });
      }
      
      res.status(500).json({ 
        message: error.message || "Failed to create Daily Micro-Learning course" 
      });
    }
  });

  // Legacy endpoint - not needed with Replit Auth, but kept for backward compatibility
  app.get("/api/session", async (req, res) => {
    if (req.user && req.user?.id) {
      res.json({ userId: req.user.id });
    } else {
      res.json({ userId: null });
    }
  });

  // ==================== SOCIAL FEATURES ROUTES ====================
  // Like/dislike endpoint
  app.post("/api/podcasts/:podcastId/like", async (req, res) => {
    try {
      const userId = req.user?.id || null;
      const { podcastId } = req.params;
      
      const schema = z.object({
        value: z.union([z.literal(1), z.literal(-1)]),
        guestId: z.string().optional(),
      });
      
      const { value, guestId: bodyGuestId } = schema.parse(req.body);
      // Accept guestId from request body OR x-guest-id header
      const guestId = bodyGuestId || (req.headers['x-guest-id'] as string | undefined) || undefined;
      if (!userId && !guestId) return res.status(400).json({ message: "Identity required" });
      
      // Verify podcast exists
      const podcast = await storage.getPodcast(podcastId);
      if (!podcast) {
        return res.status(404).json({ message: "Podcast not found" });
      }
      
      const result = await storage.togglePodcastLike(podcastId, userId, value, guestId);
      res.json(result);
    } catch (error: any) {
      console.error("Error toggling like:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid request data",
          errors: error.errors 
        });
      }
      
      res.status(500).json({ 
        message: error.message || "Failed to toggle like" 
      });
    }
  });

  // Get user's like for a podcast
  app.get("/api/podcasts/:podcastId/like", async (req: any, res) => {
    try {
      const userId: string | null = req.isAuthenticated() && req.user?.id ? req.user.id : null;
      const guestId = req.headers['x-guest-id'] as string | undefined;
      const { podcastId } = req.params;
      
      if (!userId && !guestId) return res.json({ like: null });
      const like = await storage.getUserLikeForPodcast(podcastId, userId, guestId);
      res.json({ like: like || null });
    } catch (error: any) {
      console.error("Error fetching like:", error);
      res.status(500).json({ 
        message: error.message || "Failed to fetch like" 
      });
    }
  });

  // Get user's liked podcasts
  app.get("/api/user/likes", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const likes = await storage.getPodcastLikesByUser(userId);
      res.json({ likes });
    } catch (error: any) {
      console.error("Error fetching user likes:", error);
      res.status(500).json({ 
        message: error.message || "Failed to fetch user likes" 
      });
    }
  });

  // Batch get engagement for multiple podcasts (reduces API calls by 90%+)
  app.post("/api/podcasts/batch-engagement", async (req, res) => {
    try {
      const { podcastIds } = req.body;
      
      if (!Array.isArray(podcastIds) || podcastIds.length === 0) {
        return res.status(400).json({ message: "podcastIds array required" });
      }
      
      // Limit batch size to prevent abuse
      if (podcastIds.length > 100) {
        return res.status(400).json({ message: "Maximum 100 podcast IDs per batch" });
      }
      
      const engagementMap = await storage.getBatchEngagement(podcastIds);
      
      // Convert Map to object for JSON serialization
      const engagements: Record<string, PodcastEngagement | null> = {};
      for (const id of podcastIds) {
        engagements[id] = engagementMap.get(id) || null;
      }
      
      res.json({ engagements });
    } catch (error: any) {
      console.error("Error fetching batch engagement:", error);
      res.status(500).json({ 
        message: error.message || "Failed to fetch engagement" 
      });
    }
  });

  // Batch enrichment: engagement + top comments + user likes (used after slim initial load)
  app.post("/api/podcasts/batch-enrichment", async (req, res) => {
    try {
      const { podcastIds, engagementIds: rawEngagementIds } = req.body;
      
      if (!Array.isArray(podcastIds) || podcastIds.length === 0) {
        return res.status(400).json({ message: "podcastIds array required" });
      }
      if (podcastIds.length > 100) {
        return res.status(400).json({ message: "Maximum 100 podcast IDs per batch" });
      }

      // engagementIds is an optional subset of podcastIds: only IDs whose _engagement
      // was not already inlined in the slim response. When provided, engagement is
      // fetched only for those IDs; topComment/userLike are still fetched for all.
      const engagementIds: string[] = Array.isArray(rawEngagementIds)
        ? rawEngagementIds.filter((id): id is string => typeof id === 'string' && podcastIds.includes(id))
        : podcastIds;
      
      const userId = req.user?.id ?? null;
      const guestId = typeof req.body.guestId === 'string' ? req.body.guestId : undefined;
      
      const [engagementMap, topCommentsMap, userLikesMap] = await Promise.all([
        engagementIds.length > 0
          ? storage.getBatchEngagement(engagementIds)
          : Promise.resolve(new Map<string, PodcastEngagement>()),
        storage.getBatchTopComments(podcastIds),
        storage.getBatchUserLikes(podcastIds, userId, guestId),
      ]);
      
      const enrichments: Record<string, { engagement: PodcastEngagement | null; topComment: unknown; userLike: unknown }> = {};
      for (const id of podcastIds) {
        enrichments[id] = {
          engagement: engagementMap.get(id) || null,
          topComment: topCommentsMap.get(id) || null,
          userLike: userLikesMap.get(id) || null,
        };
      }
      
      res.json({ enrichments });
    } catch (error: any) {
      console.error("Error fetching batch enrichment:", error);
      res.status(500).json({ 
        message: error.message || "Failed to fetch enrichment data" 
      });
    }
  });

  // Get podcast engagement (public endpoint)
  app.get("/api/podcasts/:podcastId/engagement", async (req, res) => {
    try {
      const { podcastId } = req.params;
      
      // Verify podcast exists and is public
      const podcast = await storage.getPodcast(podcastId);
      if (!podcast) {
        return res.status(404).json({ message: "Podcast not found" });
      }
      
      const engagement = await storage.getOrCreateEngagement(podcastId);
      res.json({ engagement });
    } catch (error: any) {
      console.error("Error fetching engagement:", error);
      res.status(500).json({ 
        message: error.message || "Failed to fetch engagement" 
      });
    }
  });

  // Create a comment (authenticated users OR guests with a device token)
  app.post("/api/podcasts/:podcastId/comments", async (req, res) => {
    try {
      const { podcastId } = req.params;
      
      const schema = z.object({
        body: z.string().min(1).max(5000),
        parentId: z.string().optional(),
        guestId: z.string().optional(),
        guestName: z.string().max(80).optional(),
      });
      
      const { body, parentId, guestId, guestName } = schema.parse(req.body);

      const userId = req.user?.id || null;

      // Must be either logged in or provide a guest device token
      if (!userId && !guestId) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      // Verify podcast exists
      const podcast = await storage.getPodcast(podcastId);
      if (!podcast) {
        return res.status(404).json({ message: "Podcast not found" });
      }
      
      // If replying, verify parent comment exists
      if (parentId) {
        const parentComment = await storage.getCommentById(parentId);
        if (!parentComment || parentComment.podcastId !== podcastId) {
          return res.status(400).json({ message: "Invalid parent comment" });
        }
      }
      
      const comment = await storage.createComment({
        podcastId,
        userId: userId || null,
        guestId: !userId ? (guestId || null) : null,
        guestName: !userId ? (guestName || null) : null,
        body,
        parentId: parentId || null,
      });
      
      res.json({ comment });
    } catch (error: any) {
      console.error("Error creating comment:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid request data",
          errors: error.errors 
        });
      }
      
      res.status(500).json({ 
        message: error.message || "Failed to create comment" 
      });
    }
  });

  // Get comments for a podcast (public endpoint)
  app.get("/api/podcasts/:podcastId/comments", async (req, res) => {
    try {
      const { podcastId } = req.params;
      const sort = (req.query.sort as 'best' | 'new') || 'best';
      const userId = req.user?.id;
      const guestId = req.headers['x-guest-id'] as string | undefined;
      
      // Verify podcast exists
      const podcast = await storage.getPodcast(podcastId);
      if (!podcast) {
        return res.status(404).json({ message: "Podcast not found" });
      }
      
      const comments = await storage.getCommentsByPodcast(podcastId, userId, sort, guestId);
      res.json({ comments });
    } catch (error: any) {
      console.error("Error fetching comments:", error);
      res.status(500).json({ 
        message: error.message || "Failed to fetch comments" 
      });
    }
  });

  const topCommentsCache = new Map<string, { data: any; timestamp: number }>();
  const TOP_COMMENTS_CACHE_TTL = 5 * 60 * 1000;
  const TOP_COMMENTS_CACHE_MAX = 300;

  // Get top comment for a podcast (public endpoint, cached)
  app.get("/api/podcasts/:podcastId/top-comment", async (req, res) => {
    try {
      const { podcastId } = req.params;
      
      // Check cache first
      const cached = topCommentsCache.get(podcastId);
      if (cached && Date.now() - cached.timestamp < TOP_COMMENTS_CACHE_TTL) {
        return res.json(cached.data);
      }
      
      // Verify podcast exists and is public
      const podcast = await storage.getPodcast(podcastId);
      if (!podcast) {
        return res.status(404).json({ message: "Podcast not found" });
      }
      
      if (!podcast.isPublic) {
        return res.json({ comment: null });
      }
      
      // Get all comments for this podcast sorted by best (which uses upvotes)
      const comments = await storage.getCommentsByPodcast(podcastId, undefined, 'best');
      
      // Find top-level comment with most upvotes
      const topLevelComments = comments.filter(c => !c.parentId);
      const topComment = topLevelComments.length > 0 ? topLevelComments[0] : null;
      
      const result = {
        comment: topComment ? {
          id: topComment.id,
          body: topComment.body,
          user: topComment.user,
          upvotes: topComment.upvotes,
        } : null
      };
      
      if (topCommentsCache.size >= TOP_COMMENTS_CACHE_MAX) {
        const oldest = topCommentsCache.keys().next().value;
        if (oldest) topCommentsCache.delete(oldest);
      }
      topCommentsCache.set(podcastId, { data: result, timestamp: Date.now() });
      
      res.json(result);
    } catch (error: any) {
      console.error("Error fetching top comment:", error);
      res.status(500).json({ 
        message: error.message || "Failed to fetch top comment" 
      });
    }
  });

  // Update a comment
  app.patch("/api/comments/:commentId", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { commentId } = req.params;
      
      const schema = z.object({
        body: z.string().min(1).max(5000),
      });
      
      const { body } = schema.parse(req.body);
      
      const comment = await storage.updateComment(commentId, userId, body);
      if (!comment) {
        return res.status(404).json({ message: "Comment not found or unauthorized" });
      }
      
      res.json({ comment });
    } catch (error: any) {
      console.error("Error updating comment:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid request data",
          errors: error.errors 
        });
      }
      
      res.status(500).json({ 
        message: error.message || "Failed to update comment" 
      });
    }
  });

  // Delete a comment
  app.delete("/api/comments/:commentId", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { commentId } = req.params;
      
      const success = await storage.deleteComment(commentId, userId);
      if (!success) {
        return res.status(404).json({ message: "Comment not found or unauthorized" });
      }
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting comment:", error);
      res.status(500).json({ 
        message: error.message || "Failed to delete comment" 
      });
    }
  });

  // Pin/unpin a comment (only podcast owner can do this)
  app.post("/api/comments/:commentId/pin", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { commentId } = req.params;
      
      const comment = await storage.pinComment(commentId, userId);
      if (!comment) {
        return res.status(404).json({ message: "Comment not found or unauthorized" });
      }
      
      res.json({ comment });
    } catch (error: any) {
      console.error("Error pinning comment:", error);
      res.status(500).json({ 
        message: error.message || "Failed to pin comment" 
      });
    }
  });

  // Vote on a comment
  app.post("/api/comments/:commentId/vote", requireIdentity, async (req: any, res) => {
    try {
      const userId: string | null = req.userId || null;
      const guestId: string | undefined = req.guestId;
      const { commentId } = req.params;
      
      const schema = z.object({
        value: z.union([z.literal(1), z.literal(-1)]),
      });
      
      const { value } = schema.parse(req.body);
      
      if (!userId && !guestId) return res.status(400).json({ message: "Identity required" });
      const vote = await storage.toggleCommentVote(commentId, userId, value, guestId);
      res.json({ vote });
    } catch (error: any) {
      console.error("Error voting on comment:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid request data",
          errors: error.errors 
        });
      }
      
      res.status(500).json({ 
        message: error.message || "Failed to vote on comment" 
      });
    }
  });

  // Record a share event
  app.post("/api/podcasts/:podcastId/share", async (req, res) => {
    try {
      const userId = req.user?.id;
      const { podcastId } = req.params;
      
      const schema = z.object({
        platform: z.string().optional(),
      });
      
      const { platform } = schema.parse(req.body);
      
      // Verify podcast exists
      const podcast = await storage.getPodcast(podcastId);
      if (!podcast) {
        return res.status(404).json({ message: "Podcast not found" });
      }
      
      const shareEvent = await storage.recordShare(podcastId, userId, platform);
      res.json({ share: shareEvent });
    } catch (error: any) {
      console.error("Error recording share:", error);
      res.status(500).json({ 
        message: error.message || "Failed to record share" 
      });
    }
  });

  // ==================== STRIPE ROUTES ====================
  // Initialize Stripe - blueprint:javascript_stripe integration
  if (!process.env.STRIPE_SECRET_KEY) {
    logger.warn('⚠️  Stripe integration not configured - subscription features disabled');
  }
  
  const stripe = process.env.STRIPE_SECRET_KEY 
    ? new Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: "2025-11-17.clover",
      })
    : null;

  // Subscription plan pricing (prices are in cents)
  const SUBSCRIPTION_PLANS = {
    starter: { priceId: process.env.STRIPE_PRICE_STARTER, name: 'Starter', credits: 6, price: 150 },
    creator: { priceId: process.env.STRIPE_PRICE_CREATOR, name: 'Creator', credits: 15, price: 350 },
    studio: { priceId: process.env.STRIPE_PRICE_STUDIO, name: 'Studio', credits: 50, price: 1095 },
    pro: { priceId: process.env.STRIPE_PRICE_PRO, name: 'Pro', credits: 90, price: 1995 },
    professional: { priceId: process.env.STRIPE_PRICE_PROFESSIONAL, name: 'Professional', credits: 150, price: 2995 },
  } as const;

  // Validate plan name with Zod
  const subscriptionPlanSchema = z.enum(['starter', 'creator', 'studio', 'pro', 'professional']);

  // Create checkout session for subscription
  app.post("/api/stripe/create-checkout-session", isAuthenticated, async (req, res) => {
    try {
      if (!stripe) {
        return res.status(503).json({ message: "Stripe not configured" });
      }

      // Validate plan name server-side
      const planValidation = subscriptionPlanSchema.safeParse(req.body.plan);
      if (!planValidation.success) {
        return res.status(400).json({ message: "Invalid subscription plan" });
      }

      const plan = planValidation.data;
      const user = req.user!;

      const planDetails = SUBSCRIPTION_PLANS[plan];

      // Create or get Stripe customer
      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email || undefined,
          name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || undefined,
          metadata: {
            userId: user.id,
          },
        });
        customerId = customer.id;

        // Update user with Stripe customer ID
        await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, user.id));
      }

      // Create checkout session with proper absolute URLs
      // Use custom domain in production, otherwise use request host
      const isProduction = process.env.NODE_ENV === 'production';
      const host = isProduction ? 'podbrew.pro' : (req.headers.host || 'localhost:5000');
      const protocol = isProduction || host.includes('replit.app') || host.includes('replit.dev') ? 'https' : req.protocol;
      const baseUrl = `${protocol}://${host}`;
      
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        // Let Stripe auto-detect best payment methods (Google Pay, Apple Pay, cards, etc.)
        // Wallets will appear first when available on user's device
        line_items: [
          {
            price: planDetails.priceId,
            quantity: 1,
          },
        ],
        success_url: `${baseUrl}/?checkout=success`,
        cancel_url: `${baseUrl}/?checkout=canceled`,
        metadata: {
          userId: user.id,
          plan,
        },
      });

      res.json({ sessionId: session.id, url: session.url });
    } catch (error: any) {
      console.error("Error creating checkout session:", error);
      res.status(500).json({ message: error.message || "Failed to create checkout session" });
    }
  });

  // Get current subscription status
  app.get("/api/stripe/subscription-status", async (req, res) => {
    try {
      if (!stripe) {
        return res.json({ hasSubscription: false });
      }

      const user = req.user;
      if (!user) return res.json({ hasSubscription: false });

      if (!user.stripeSubscriptionId) {
        return res.json({ hasSubscription: false });
      }

      const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId) as any;

      res.json({
        hasSubscription: true,
        status: subscription.status,
        currentPeriodEnd: (subscription.current_period_end || 0) * 1000, // Convert to milliseconds
        cancelAtPeriodEnd: subscription.cancel_at_period_end || false,
        plan: user.subscriptionPlan,
      });
    } catch (error: any) {
      console.error("Error getting subscription status:", error);
      res.status(500).json({ message: error.message || "Failed to get subscription status" });
    }
  });

  // Create billing portal session
  app.post("/api/stripe/create-portal-session", isAuthenticated, async (req, res) => {
    try {
      if (!stripe) {
        return res.status(503).json({ message: "Stripe not configured" });
      }

      const user = req.user!;

      if (!user.stripeCustomerId) {
        return res.status(400).json({ message: "No Stripe customer found" });
      }

      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.get('host') || 'localhost:5000';
      const baseUrl = `${protocol}://${host}`;
      
      const session = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: `${baseUrl}/settings`,
      });

      res.json({ url: session.url });
    } catch (error: any) {
      console.error("Error creating portal session:", error);
      res.status(500).json({ message: error.message || "Failed to create portal session" });
    }
  });

  // Stripe webhook endpoint
  app.post("/api/stripe/webhook", async (req, res) => {
    try {
      if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
        return res.status(503).send('Stripe not configured');
      }

      const sig = req.headers['stripe-signature'] as string;
      if (!sig) {
        console.error('Missing stripe-signature header');
        return res.status(400).send('Missing stripe-signature header');
      }

      // Use raw body for signature verification (critical for security)
      const rawBody = req.rawBody;
      if (!rawBody || typeof rawBody !== 'object' || !Buffer.isBuffer(rawBody)) {
        console.error('Missing or invalid raw body for webhook verification');
        return res.status(400).send('Invalid request body');
      }

      let event: Stripe.Event;

      try {
        event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
      } catch (err: any) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }

      // Handle the event
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          const userId = session.metadata?.userId;
          const plan = session.metadata?.plan;

          if (!userId || !plan || !session.subscription) {
            logger.warn('Checkout session completed but missing required metadata', { userId, plan, hasSubscription: !!session.subscription });
            break;
          }

          // Validate plan is one of our known plans
          const planValidation = subscriptionPlanSchema.safeParse(plan);
          if (!planValidation.success) {
            logger.error(`Invalid plan in checkout session: ${plan}`);
            break;
          }

          // Check if user exists before updating
          const existingUser = await db.select().from(users).where(eq(users.id, userId)).limit(1);
          if (existingUser.length === 0) {
            logger.error(`❌ Webhook failed: User ${userId} not found in database for plan ${plan}`);
            break;
          }

          // Update user subscription atomically
          const planDetails = SUBSCRIPTION_PLANS[planValidation.data];
          const result = await db.update(users).set({
            stripeSubscriptionId: session.subscription as string,
            subscriptionPlan: planValidation.data,
            subscriptionStatus: 'active',
            credits: planDetails.credits,
            updatedAt: new Date(),
          }).where(eq(users.id, userId)).returning();

          if (result.length === 0) {
            logger.error(`❌ Webhook update failed for user ${userId}`);
            break;
          }

          logger.info(`✅ Subscription activated for user ${userId} (${existingUser[0].email}): ${planValidation.data} with ${planDetails.credits} credits`);
          break;
        }

        case 'customer.subscription.updated': {
          const subscription = event.data.object as Stripe.Subscription;
          
          // Find user by Stripe subscription ID since metadata might not be present
          const userResults = await db.select().from(users).where(eq(users.stripeSubscriptionId, subscription.id));
          if (userResults.length === 0) {
            logger.warn(`No user found for subscription ${subscription.id}`);
            break;
          }

          const user = userResults[0];
          const status = subscription.status === 'active' ? 'active' : 'inactive';
          
          await db.update(users).set({
            subscriptionStatus: status,
            updatedAt: new Date(),
          }).where(eq(users.id, user.id));

          logger.info(`📝 Subscription updated for user ${user.id}: ${status}`);
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object as Stripe.Subscription;
          
          // Find user by Stripe subscription ID
          const userResults = await db.select().from(users).where(eq(users.stripeSubscriptionId, subscription.id));
          if (userResults.length === 0) {
            logger.warn(`No user found for subscription ${subscription.id}`);
            break;
          }

          const user = userResults[0];
          
          // Downgrade to free plan atomically
          await db.update(users).set({
            stripeSubscriptionId: null,
            subscriptionPlan: 'free',
            subscriptionStatus: 'inactive',
            credits: 2, // Free plan credits
            updatedAt: new Date(),
          }).where(eq(users.id, user.id));

          logger.info(`❌ Subscription cancelled for user ${user.id}`);
          break;
        }

        default:
          console.log(`Unhandled event type ${event.type}`);
      }

      res.json({ received: true });
    } catch (error: any) {
      console.error("Webhook error:", error);
      res.status(500).json({ message: error.message || "Webhook processing failed" });
    }
  });

  // ==================== PODCAST SHOWS (RSS Distribution) ====================
  
  // Get all shows for current user
  app.get("/api/shows", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const shows = await storage.getPodcastShowsByUser(userId);
      res.json(shows);
    } catch (error: any) {
      console.error("Error fetching shows:", error);
      res.status(500).json({ message: error.message || "Failed to fetch shows" });
    }
  });

  // Create a new show
  app.post("/api/shows", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const user = await storage.getUser(userId);
      
      const schema = z.object({
        name: z.string().min(1).max(255),
        description: z.string().max(4000).optional(),
        author: z.string().max(255).optional(),
        email: z.string().email().max(255).optional(),
        coverImageUrl: z.string().url().optional(),
        category: z.string().max(100).optional(),
        subcategory: z.string().max(100).optional(),
        language: z.string().max(10).optional().default('en'),
        explicit: z.boolean().optional().default(false),
        websiteUrl: z.string().url().optional(),
      });
      
      const data = schema.parse(req.body);
      
      const show = await storage.createPodcastShow({
        userId,
        ...data,
        author: data.author || user?.firstName || 'PodBrew Creator',
        email: data.email || user?.email || undefined,
      });
      
      res.status(201).json(show);
    } catch (error: any) {
      console.error("Error creating show:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request data", errors: error.errors });
      }
      
      res.status(500).json({ message: error.message || "Failed to create show" });
    }
  });

  // Get a specific show
  app.get("/api/shows/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { id } = req.params;
      
      const show = await storage.getPodcastShowById(id);
      
      if (!show || show.userId !== userId) {
        return res.status(404).json({ message: "Show not found" });
      }
      
      // Get episodes for this show
      const episodes = await storage.getShowEpisodes(id);
      
      res.json({ ...show, episodes });
    } catch (error: any) {
      console.error("Error fetching show:", error);
      res.status(500).json({ message: error.message || "Failed to fetch show" });
    }
  });

  // Update a show
  app.patch("/api/shows/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { id } = req.params;
      
      const schema = z.object({
        name: z.string().min(1).max(255).optional(),
        description: z.string().max(4000).optional(),
        author: z.string().max(255).optional(),
        email: z.string().email().max(255).optional(),
        coverImageUrl: z.string().url().optional(),
        category: z.string().max(100).optional(),
        subcategory: z.string().max(100).optional(),
        language: z.string().max(10).optional(),
        explicit: z.boolean().optional(),
        websiteUrl: z.string().url().optional(),
      });
      
      const data = schema.parse(req.body);
      
      const updated = await storage.updatePodcastShow(id, userId, data);
      
      if (!updated) {
        return res.status(404).json({ message: "Show not found or unauthorized" });
      }
      
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating show:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request data", errors: error.errors });
      }
      
      res.status(500).json({ message: error.message || "Failed to update show" });
    }
  });

  // Delete a show
  app.delete("/api/shows/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { id } = req.params;
      
      const deleted = await storage.deletePodcastShow(id, userId);
      
      if (!deleted) {
        return res.status(404).json({ message: "Show not found or unauthorized" });
      }
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting show:", error);
      res.status(500).json({ message: error.message || "Failed to delete show" });
    }
  });

  // Add episode to show
  app.post("/api/shows/:id/episodes", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { id } = req.params;
      
      const schema = z.object({
        podcastId: z.string(),
        episodeNumber: z.number().int().positive().optional(),
        seasonNumber: z.number().int().positive().optional(),
      });
      
      const { podcastId, episodeNumber, seasonNumber } = schema.parse(req.body);
      
      // Verify show ownership
      const show = await storage.getPodcastShowById(id);
      if (!show || show.userId !== userId) {
        return res.status(404).json({ message: "Show not found" });
      }
      
      // Verify podcast ownership
      const podcast = await storage.getPodcast(podcastId);
      if (!podcast || podcast.userId !== userId) {
        return res.status(404).json({ message: "Podcast not found or unauthorized" });
      }
      
      const episode = await storage.addEpisodeToShow(id, podcastId, episodeNumber, seasonNumber);
      
      res.status(201).json(episode);
    } catch (error: any) {
      console.error("Error adding episode to show:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request data", errors: error.errors });
      }
      
      // Handle duplicate key error
      if (error.code === '23505') {
        return res.status(409).json({ message: "Episode already in show" });
      }
      
      res.status(500).json({ message: error.message || "Failed to add episode" });
    }
  });

  // Remove episode from show
  app.delete("/api/shows/:showId/episodes/:podcastId", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { showId, podcastId } = req.params;
      
      // Verify show ownership
      const show = await storage.getPodcastShowById(showId);
      if (!show || show.userId !== userId) {
        return res.status(404).json({ message: "Show not found" });
      }
      
      const removed = await storage.removeEpisodeFromShow(showId, podcastId);
      
      if (!removed) {
        return res.status(404).json({ message: "Episode not found in show" });
      }
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error removing episode from show:", error);
      res.status(500).json({ message: error.message || "Failed to remove episode" });
    }
  });

  // RSS Categories endpoint
  app.get("/api/rss-categories", (req, res) => {
    const { RSS_CATEGORIES } = require("@shared/schema");
    res.json(RSS_CATEGORIES);
  });

  // ==================== PUBLIC RSS FEED ====================
  
  // RSS Feed - Public endpoint for Spotify, Apple Podcasts, etc.
  app.get("/rss/:showId", async (req, res) => {
    try {
      const { showId } = req.params;
      
      const show = await storage.getPodcastShowById(showId);
      if (!show) {
        return res.status(404).send("Show not found");
      }
      
      const episodes = await storage.getShowEpisodes(showId);
      
      // Get base URL from request
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers['host'];
      const baseUrl = `${protocol}://${host}`;
      
      // Build RSS XML
      const pubDate = episodes.length > 0 
        ? new Date(episodes[0].podcast.timestamp).toUTCString()
        : new Date().toUTCString();
      
      const escapeXml = (str: string) => {
        return str
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;');
      };
      
      const rssItems = episodes.map((ep, index) => {
        const podcast = ep.podcast;
        const epNum = ep.episodeNumber || index + 1;
        const title = podcast.title || podcast.topic;
        const description = podcast.description || `Episode about ${podcast.topic}`;
        const audioUrl = podcast.audioUrl.startsWith('http') 
          ? podcast.audioUrl 
          : `${baseUrl}${podcast.audioUrl}`;
        const coverUrl = podcast.coverImageUrl?.startsWith('http')
          ? podcast.coverImageUrl
          : podcast.coverImageUrl ? `${baseUrl}${podcast.coverImageUrl}` : show.coverImageUrl;
        
        // Parse duration (format: "MM:SS" or "HH:MM:SS")
        const durationParts = podcast.duration.split(':');
        let durationSeconds = 0;
        if (durationParts.length === 2) {
          durationSeconds = parseInt(durationParts[0]) * 60 + parseInt(durationParts[1]);
        } else if (durationParts.length === 3) {
          durationSeconds = parseInt(durationParts[0]) * 3600 + parseInt(durationParts[1]) * 60 + parseInt(durationParts[2]);
        }
        
        return `
    <item>
      <title>${escapeXml(title)}</title>
      <description><![CDATA[${description}]]></description>
      <pubDate>${new Date(podcast.timestamp).toUTCString()}</pubDate>
      <enclosure url="${escapeXml(audioUrl)}" type="audio/mpeg" length="0"/>
      <guid isPermaLink="false">${podcast.id}</guid>
      <itunes:duration>${durationSeconds}</itunes:duration>
      <itunes:episode>${epNum}</itunes:episode>
      ${ep.seasonNumber ? `<itunes:season>${ep.seasonNumber}</itunes:season>` : ''}
      ${coverUrl ? `<itunes:image href="${escapeXml(coverUrl)}"/>` : ''}
      <itunes:explicit>${show.explicit ? 'yes' : 'no'}</itunes:explicit>
    </item>`;
      }).join('\n');
      
      const feedUrl = `${baseUrl}/rss/${showId}`;
      const showCoverUrl = show.coverImageUrl?.startsWith('http')
        ? show.coverImageUrl
        : show.coverImageUrl ? `${baseUrl}${show.coverImageUrl}` : `${baseUrl}/logo.png`;
      
      const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" 
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:atom="http://www.w3.org/2005/Atom"
     xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${escapeXml(show.name)}</title>
    <description><![CDATA[${show.description || `A podcast created with PodBrew`}]]></description>
    <language>${show.language}</language>
    <link>${show.websiteUrl || baseUrl}</link>
    <atom:link href="${feedUrl}" rel="self" type="application/rss+xml"/>
    <lastBuildDate>${pubDate}</lastBuildDate>
    <pubDate>${pubDate}</pubDate>
    
    <itunes:author>${escapeXml(show.author || 'PodBrew Creator')}</itunes:author>
    <itunes:owner>
      <itunes:name>${escapeXml(show.author || 'PodBrew Creator')}</itunes:name>
      ${show.email ? `<itunes:email>${escapeXml(show.email)}</itunes:email>` : ''}
    </itunes:owner>
    <itunes:image href="${escapeXml(showCoverUrl)}"/>
    <itunes:category text="${escapeXml(show.category || 'Technology')}">
      ${show.subcategory ? `<itunes:category text="${escapeXml(show.subcategory)}"/>` : ''}
    </itunes:category>
    <itunes:explicit>${show.explicit ? 'yes' : 'no'}</itunes:explicit>
    <itunes:type>episodic</itunes:type>
${rssItems}
  </channel>
</rss>`;
      
      res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
      res.send(rss);
    } catch (error: any) {
      console.error("Error generating RSS feed:", error);
      res.status(500).send("Error generating RSS feed");
    }
  });

  // NOTE: The legacy POST /api/voice-assistant/parse endpoint was removed in Apr 2026.
  // Voice intent parsing is now handled end-to-end by the Gemini Live streaming pipeline
  // (see server/voiceAssistantLive.ts and client/src/lib/voiceLiveSession.ts), which uses
  // Live function declarations (create_podcast, navigate, play_podcast) instead of a
  // separate non-streaming JSON endpoint. No client code referenced this route.

  const httpServer = createServer(app);

  // Streaming voice assistant (Gemini Live) — bidirectional audio + tool calls
  const { attachVoiceAssistantWebSocket } = await import("./voiceAssistantLive");
  attachVoiceAssistantWebSocket(httpServer);

  // Start the scheduler for auto-generation and cleanup jobs
  startScheduler({
    generatePodcast: async (params) => {
      const {
        userId,
        topic,
        templateCategory,
        durationMinutes,
        languageComplexity,
        numPeople,
        podcastStyle,
        coHostPersonality,
        podcastMood,
        language,
        selectedVoiceIds,
        isPublic
      } = params;

      // Get user's selected voices from database
      const userVoices = selectedVoiceIds && selectedVoiceIds.length > 0
        ? await db.select().from(voices).where(inArray(voices.id, selectedVoiceIds))
        : [];
      
      // Run podcast generation, title generation, and cover art in parallel
      const [podcastResult, title, coverImageUrl] = await Promise.all([
        generatePodcast(
          topic,
          durationMinutes,
          languageComplexity,
          numPeople,
          podcastStyle as any,
          undefined, // timeFrame
          coHostPersonality as any,
          podcastMood as any,
          language,
          userVoices as any,
          templateCategory,
          undefined, // templateSpecificParams
          'premium',
          selectedVoiceIds,
          false, // locationEnabled
          undefined, // locationCity
          false, // skipPerplexityResearch
          undefined // selectedAccents
        ),
        generatePodcastTitle(topic, templateCategory),
        generateOrGetCoverArt(topic, templateCategory)
      ]);
      
      const { audioUrl, duration, citations } = podcastResult;
      
      // Save to database
      const podcast = await storage.createGeneratedPodcast({
        topic,
        title,
        audioUrl,
        coverImageUrl,
        duration,
        userId,
        isPublic,
        templateCategory,
        voiceQuality: 'premium',
        creditsCost: params.creditCost,
        citations: citations || [],
        generationParams: {
          durationMinutes,
          languageComplexity,
          numPeople,
          podcastStyle,
          coHostPersonality,
          podcastMood,
          language,
          selectedVoiceIds
        }
      });
      
      // Notify Google Indexing API for public podcasts (async, non-blocking)
      if (isPublic && podcast.id) {
        googleIndexingService.notifyUrlUpdated(podcast.id).catch(() => {});
      }
      
      return podcast;
    }
  });
  
  // ============================================================
  // FEATURES ENDPOINT — returns runtime feature flags for the frontend
  // ============================================================
  app.get("/api/features", asyncHandler(async (req, res) => {
    return res.json({
      deepDiveAvailable: isNotebookLMEnabled(),
    });
  }));

  // ============================================================
  // DEEP DIVE GENERATION — NotebookLM Podcast API
  // ============================================================
  app.post("/api/generate/deep-dive", generationLimiter, isAuthenticated, asyncHandler(async (req, res) => {
    const schema = z.object({
      topic: z.string().min(3).max(1000),
      sourceUrl: z.string().url().optional(),
      documentId: z.string().optional(),
    });

    const { topic, sourceUrl, documentId } = schema.parse(req.body);
    const userId = (req as any).user?.id as string;

    if (!isNotebookLMEnabled()) {
      throw ApiErrors.badRequest(
        "Deep Dive is not enabled on this instance. Set NOTEBOOKLM_API_ENABLED=true and NOTEBOOKLM_PROJECT_ID to enable it."
      );
    }

    // Content moderation
    const modResult = ContentModerationService.moderateTopic(topic);
    if (!modResult.allowed) {
      throw ApiErrors.badRequest(modResult.reason || "This topic contains prohibited content.");
    }

    // Credit check — flat 2 credits for a deep dive
    const DEEP_DIVE_CREDIT_COST = 2;
    await checkAndDeductCreditsAtomic(userId, DEEP_DIVE_CREDIT_COST, `deep-dive:${topic.slice(0, 40)}`);

    // Resolve optional document source
    let sourceText: string | undefined;
    if (documentId) {
      const cachedDoc = getDocument(documentId);
      if (cachedDoc?.content) {
        sourceText = cachedDoc.content;
        logger.info('[DeepDive] Using uploaded document as source', {
          documentId,
          wordCount: cachedDoc.wordCount,
        });
      }
    }

    let audioBuffer: Buffer;
    try {
      audioBuffer = await generateDeepDivePodcast({ topic, sourceUrl, sourceText });
    } catch (genErr) {
      // Refund credits on failure
      await refundCredits(userId, DEEP_DIVE_CREDIT_COST, `deep-dive-refund:${topic.slice(0, 40)}`).catch(() => {});
      throw ApiErrors.internal(
        `NotebookLM generation failed: ${genErr instanceof Error ? genErr.message : String(genErr)}`
      );
    }

    // Upload audio to object storage — refund on failure
    let audioUrl: string;
    try {
      const objectStorage = new ObjectStorageService();
      const filename = `podcasts/deepdive-${Date.now()}.mp3`;
      audioUrl = await objectStorage.uploadBuffer(filename, audioBuffer, "audio/mpeg");
    } catch (uploadErr) {
      await refundCredits(userId, DEEP_DIVE_CREDIT_COST, `deep-dive-refund:${topic.slice(0, 40)}`).catch(() => {});
      throw ApiErrors.internal(
        `Deep Dive upload failed: ${uploadErr instanceof Error ? uploadErr.message : String(uploadErr)}`
      );
    }

    // Estimate duration from file size (rough: 128kbps MP3 ≈ 16 KB/s)
    const estimatedSeconds = Math.round(audioBuffer.length / 16_000);
    const minutes = Math.floor(estimatedSeconds / 60);
    const seconds = estimatedSeconds % 60;
    const duration = `${minutes}:${seconds.toString().padStart(2, "0")}`;

    // Generate cover art
    let coverImageUrl: string | null = null;
    try {
      const { generateOrGetCoverArt: getCover } = await import("./services/CoverArtCache");
      coverImageUrl = await getCover(topic, "deepdive");
    } catch {
      // Non-fatal
    }

    // Generate a title via LLM router
    let title: string = topic.slice(0, 60);
    try {
      const generatedTitle = await generatePodcastTitle(topic, "deepdive");
      if (generatedTitle) title = generatedTitle;
    } catch {
      // Non-fatal
    }

    // Save podcast record — refund on failure
    let podcast: GeneratedPodcast;
    try {
      podcast = await storage.createGeneratedPodcast({
        topic,
        title,
        audioUrl,
        coverImageUrl: coverImageUrl || undefined,
        duration,
        userId,
        isPublic: true,
        templateCategory: "deepdive",
        voiceQuality: "premium",
        creditsCost: DEEP_DIVE_CREDIT_COST,
        researchFailed: false,
        generationParams: {
          topic,
          templateCategory: "deepdive",
          sourceUrl: sourceUrl || null,
          durationMinutes: Math.round(estimatedSeconds / 60),
          numPeople: 2,
          language: "en",
          languageComplexity: 5,
          podcastStyle: "conversational",
          timeFrame: "allTime",
        },
      });
    } catch (dbErr) {
      await refundCredits(userId, DEEP_DIVE_CREDIT_COST, `deep-dive-refund:${topic.slice(0, 40)}`).catch(() => {});
      throw ApiErrors.internal(
        `Deep Dive could not be saved: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`
      );
    }

    // Notify Google Indexing API (async, non-blocking)
    if (podcast.id) {
      googleIndexingService.notifyUrlUpdated(podcast.id).catch(() => {});
    }

    logger.info("[DeepDive] Generation complete", {
      podcastId: podcast.id,
      userId,
      topic: topic.slice(0, 60),
      durationEstimate: duration,
      audioBytes: audioBuffer.length,
    });

    return res.json(podcast);

  }));

  // Start the resumable generation scheduler for long-form podcasts
  startResumableGenScheduler();

  return httpServer;
}
