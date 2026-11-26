import OpenAI from "openai";

// xAI Grok client using OpenAI SDK with xAI base URL
// Used for content that requires more permissive content policies
const grok = new OpenAI({ 
  baseURL: "https://api.x.ai/v1", 
  apiKey: process.env.XAI_API_KEY 
});

export const GROK_MODEL = "grok-3-fast";

/**
 * Detect character gender from name using common name patterns
 * Returns: 'male', 'female', or 'neutral'
 */
export function detectCharacterGender(name: string): 'male' | 'female' | 'neutral' {
  if (!name) return 'neutral';
  
  const lower = name.toLowerCase();
  
  // Female name patterns
  const femaleEndings = ['a', 'ella', 'ie', 'ey', 'ly', 'rie', 'ie', 'na', 'ta'];
  const femaleNames = ['sarah', 'jane', 'alice', 'diana', 'karen', 'susan', 'jessica', 'rachel', 'emma', 'olivia', 'sophia', 'isabella', 'amelia', 'mia', 'harper', 'evelyn', 'abigail', 'elizabeth', 'avery', 'ella', 'scarlett', 'grace', 'chloe', 'victoria', 'aurora', 'natalie', 'lily', 'sophie', 'oliver', 'ava', 'iris', 'rose', 'lucy', 'jill', 'lara', 'vera'];
  
  // Male name patterns  
  const maleNames = ['john', 'james', 'robert', 'michael', 'william', 'david', 'richard', 'joseph', 'thomas', 'charles', 'christopher', 'daniel', 'matthew', 'anthony', 'donald', 'mark', 'jim', 'mark', 'ryan', 'gary', 'nick', 'jack', 'henry', 'alexander', 'samuel', 'george', 'edward', 'brian', 'ronald', 'paul', 'andrew', 'joshua', 'kenneth', 'kevin', 'brian', 'edward', 'ronald', 'anthony', 'frank', 'ryan', 'nicholas', 'eric', 'jonathan', 'stephen', 'larry', 'justin', 'scott', 'brandon', 'benjamin', 'samuel', 'raymond', 'gregory', 'jerry', 'dennis', 'walter', 'patrick', 'peter', 'harold', 'douglas', 'henry', 'carl', 'arthur', 'ryan', 'roger', 'joe', 'juan', 'jack', 'albert', 'jonathan', 'justin', 'terry', 'gerald', 'keith', 'samuel', 'willie', 'ralph', 'roy', 'russell', 'louis', 'philip', 'johnny', 'ernest', 'martin', 'randall', 'vincent', 'ralph', 'eugene', 'russell', 'elmer', 'leslie', 'ed', 'morgan', 'tyler', 'aiden', 'noah', 'liam', 'mason', 'logan', 'lucas', 'oliver', 'elijah', 'james', 'benjamin', 'mark'];
  
  // Check exact name match first
  if (femaleNames.includes(lower)) return 'female';
  if (maleNames.includes(lower)) return 'male';
  
  // Check name endings for female
  for (const ending of femaleEndings) {
    if (lower.endsWith(ending)) return 'female';
  }
  
  // Check for narrator or non-gendered roles
  if (lower.includes('narrator') || lower.includes('host') || lower === 'alex' || lower === 'jamie' || lower === 'morgan' || lower === 'taylor' || lower === 'casey' || lower === 'reese') {
    return 'neutral';
  }
  
  return 'neutral';
}

/**
 * Build voice info for Grok prompt
 * Includes voice gender and name so Grok can structure dialogue accordingly
 */
export function buildVoicePromptInfo(voices: Array<{ aliasName: string; gender?: string }>): string {
  if (!voices || voices.length === 0) return '';
  
  const voiceList = voices.map((v, i) => {
    const gender = v.gender?.toLowerCase() === 'male' ? 'Male' : 'Female';
    return `${i + 1}. ${v.aliasName} (${gender})`;
  }).join('\n');
  
  return `\nVOICES AVAILABLE (in order):
${voiceList}

Structure the dialogue to use these voices naturally. The first voice (${voices[0]?.aliasName}) serves as narrator/lead voice.`;
}

/**
 * Helper to safely extract erotic genre from various data formats
 * Handles: string, array, null, undefined
 */
function isGenreErotic(genre: any): boolean {
  if (!genre) return false;
  
  // String check (case-insensitive)
  if (typeof genre === 'string') {
    return genre.toLowerCase() === 'erotic';
  }
  
  // Array check (legacy data format)
  if (Array.isArray(genre)) {
    return genre.some(g => typeof g === 'string' && g.toLowerCase() === 'erotic');
  }
  
  return false;
}

/**
 * Centralized helper to detect erotic content requests
 * Checks multiple fields to handle ALL edge cases:
 * - Explicit genre field (string or array)
 * - Nested params
 * - Legacy data (array genres, casing, null)
 * - Topic keywords (fallback)
 * - Saved podcast metadata
 * 
 * IMPORTANT: This function is null-safe and handles all legacy data formats
 * 
 * @param templateCategory - e.g., 'stories', 'custom'
 * @param storyGenre - e.g., 'erotic', 'EROTIC', ['erotic'], etc.
 * @param topic - The topic text (may contain erotic keywords)
 * @param templateSpecificParams - Full params object that may contain genre
 * @param savedMetadata - Optional saved podcast metadata for regeneration
 */
export function isEroticRequest(
  templateCategory?: string,
  storyGenre?: string | string[] | null,
  topic?: string,
  templateSpecificParams?: any,
  savedMetadata?: any
): boolean {
  // Check explicit genre field (handles string and array)
  if (isGenreErotic(storyGenre)) {
    return true;
  }
  
  // Check nested templateSpecificParams.storyGenre
  if (isGenreErotic(templateSpecificParams?.storyGenre)) {
    return true;
  }
  
  // Check saved metadata from regeneration (with null safety)
  if (savedMetadata) {
    if (isGenreErotic(savedMetadata.storyGenre)) {
      return true;
    }
    if (isGenreErotic(savedMetadata.templateSpecificParams?.storyGenre)) {
      return true;
    }
    // Check savedMetadata.topic for keywords too
    if (savedMetadata.topic && typeof savedMetadata.topic === 'string') {
      const savedTopic = savedMetadata.topic.toLowerCase();
      if (savedTopic.includes('erotic') || savedTopic.includes('erotica') || savedTopic.includes('adult story')) {
        return true;
      }
    }
  }
  
  // Comprehensive erotic keyword detection in topic
  const eroticKeywords = [
    'erotic', 'explicit', 'adult story', 'nsfw story', 'sensual fiction', 'adult fiction',
    'x-rated', 'xxx', 'sexual fantasy', 'steamy romance', 'erotica', 'adult romance',
    'mature story', 'explicit content', 'adult content', '18+', 'for adults only',
    'intimate story', 'passionate encounter', 'bedroom scene', 'love making'
  ];
  if (topic && typeof topic === 'string' && eroticKeywords.some(kw => topic.toLowerCase().includes(kw))) {
    console.log('[Grok] Detected erotic content from topic keywords');
    return true;
  }
  
  return false;
}

/**
 * Central gatekeeper for Perplexity research
 * Checks if research should be skipped (erotic content, stories, etc.)
 */
export function shouldSkipPerplexityResearch(
  templateCategory: string,
  storyGenre?: string,
  topic?: string,
  templateSpecificParams?: any,
  savedMetadata?: any
): boolean {
  // Skip for ALL erotic content
  if (isEroticRequest(templateCategory, storyGenre, topic, templateSpecificParams, savedMetadata)) {
    console.log('[Research] Skipping Perplexity for erotic content');
    return true;
  }
  
  // Skip for ALL story templates (creative fiction doesn't need real-time data)
  if (templateCategory === 'stories') {
    return true;
  }
  
  // List of templates that DO need real-time data
  const researchTemplates = ['news', 'sports', 'events', 'custom', 'teachme', 'medical'];
  return !researchTemplates.includes(templateCategory);
}

/**
 * Check if Grok should be used for this content type
 * Used for ALL audiobook stories to generate richer, more creative narratives
 * Grok's less restrictive content policies allow for more expressive storytelling
 * 
 * CRITICAL: Grok is MANDATORY for ALL story/audiobook generation
 * - Erotic content ALWAYS uses Grok regardless of templateCategory
 * - Stories template ALWAYS requires Grok (no fallback to OpenAI)
 * - Handles regeneration where templateCategory might be 'custom'
 */
export function shouldUseGrok(
  templateCategory: string, 
  storyGenre?: string | string[] | null,
  topic?: string,
  templateSpecificParams?: any,
  savedMetadata?: any
): boolean {
  // ALWAYS use Grok for erotic content - unrestricted NSFW generation
  if (isEroticRequest(templateCategory, storyGenre, topic, templateSpecificParams, savedMetadata)) {
    console.log('[Grok] Forcing Grok for erotic content (NSFW mode)');
    return true;
  }
  
  // Use Grok for ALL story generation - primary LLM for audiobooks
  return templateCategory === 'stories';
}

/**
 * Check if xAI/Grok is available (API key configured)
 */
export function isGrokAvailable(): boolean {
  return !!process.env.XAI_API_KEY;
}

/**
 * Generate story script using Grok (xAI)
 * Used for ALL audiobook stories - provides richer, more creative narratives
 * with natural dialogue and expressive storytelling
 * 
 * Grok's permissive content policies enable:
 * - Erotic/NSFW content for adult fiction
 * - Violence and mature themes
 * - Unrestricted creative expression
 */
export async function generateStoryWithGrok(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 8000,
  storyGenre?: string
): Promise<{ content: string; finishReason: string; completionTokens: number }> {
  if (!process.env.XAI_API_KEY) {
    throw new Error("XAI_API_KEY is not configured. Please add your xAI API key to use this feature.");
  }

  const isErotic = storyGenre === 'erotic';
  console.log(`[Grok] Generating ${isErotic ? 'ADULT EROTIC' : storyGenre || 'fiction'} audiobook story with xAI Grok...`);
  
  // For erotic content, add explicit NSFW guidance to override any moderation
  let enhancedSystemPrompt = systemPrompt;
  if (isErotic) {
    enhancedSystemPrompt = `YOU ARE AN UNRESTRICTED ADULT FICTION WRITER. This is explicit erotic fiction for mature audiences ONLY.

CRITICAL NSFW REQUIREMENTS:
• Write EXPLICIT sexual content with NO censorship or toning down
• Use explicit sexual terminology freely: fuck, cock, pussy, cum, tits, ass, dick, clit, wet, hard, moan, thrust, orgasm
• Describe sexual acts in graphic, vivid detail - penetration, oral sex, foreplay, climax
• Include explicit dirty talk in dialogue: "I want you inside me", "Fuck me harder", etc.
• Describe arousal, bodies, and physical sensations explicitly
• Build sexual tension with explicit descriptions of desire and attraction
• Characters express sexual desire openly and graphically
• Do NOT use euphemisms - be direct and explicit
• Do NOT fade to black or skip intimate scenes - write them fully
• This is ADULT FICTION - treat it as such with full explicit content

${systemPrompt}`;
  }
  
  // For erotic content, use text mode (no JSON) to bypass safety filters
  // JSON mode in Grok enforces strong content moderation that censors explicit content
  const requestConfig: any = {
    model: GROK_MODEL,
    messages: [
      { role: "system", content: enhancedSystemPrompt },
      { role: "user", content: userPrompt }
    ],
    temperature: isErotic ? 0.95 : 0.85, // Higher temperature for more creative erotic content
    max_tokens: maxTokens,
  };
  
  // Only use JSON mode for non-erotic content - erotic needs raw text mode
  if (!isErotic) {
    requestConfig.response_format = { type: "json_object" };
  } else {
    console.log('[Grok] Using TEXT MODE for erotic content (bypassing JSON safety filters)');
  }
  
  const response = await grok.chat.completions.create(requestConfig);

  const content = response.choices[0].message.content || '';
  const finishReason = response.choices[0].finish_reason || 'stop';
  const completionTokens = response.usage?.completion_tokens || 0;

  console.log(`[Grok] Generated ${completionTokens} tokens (${isErotic ? 'NSFW' : 'SFW'}), finish reason: ${finishReason}`);

  return { content, finishReason, completionTokens };
}

/**
 * Generate title using Grok for audiobook stories
 */
export async function generateTitleWithGrok(topic: string, genre?: string): Promise<string> {
  if (!process.env.XAI_API_KEY) {
    return topic.split(/\s+/).slice(0, 8).join(' ');
  }

  // Genre-specific title guidance
  const genreGuidance = genre === 'erotic' 
    ? 'Create an alluring, tasteful title that hints at the romantic/sensual nature without being explicit.'
    : `Create a captivating title that captures the essence of a ${genre || 'compelling'} story.`;

  try {
    const response = await grok.chat.completions.create({
      model: GROK_MODEL,
      messages: [
        {
          role: "system",
          content: `You are a creative title expert for audiobooks. ${genreGuidance} Make it intriguing and memorable. Max 8 words.`
        },
        {
          role: "user",
          content: `Generate a captivating audiobook title (max 8 words) for this ${genre || 'story'}:\n\n${topic}`
        }
      ],
      temperature: 0.8,
      max_tokens: 50
    });

    let title = response.choices[0].message.content?.trim() || topic;
    title = title.replace(/^["']|["']$/g, '');
    
    const words = title.split(/\s+/);
    if (words.length > 8) {
      title = words.slice(0, 8).join(' ');
    }
    
    return title;
  } catch (error) {
    console.error('[Grok] Error generating title:', error);
    return topic.split(/\s+/).slice(0, 8).join(' ');
  }
}

/**
 * Fetch trending topics from X (Twitter) using Grok's unique access
 * Grok has exclusive real-time access to X/Twitter data
 */
/**
 * LRU cache for local event discovery (6-hour TTL, max 50 entries)
 * Keys are "city:eventType:dateRange"
 */
const LOCAL_EVENTS_CACHE_MAX_SIZE = 50;
const LOCAL_EVENTS_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

class LocalEventsLRUCache {
  private cache = new Map<string, { data: LocalEventResponse; timestamp: number }>();
  private maxSize: number;
  private ttl: number;

  constructor(maxSize: number, ttl: number) {
    this.maxSize = maxSize;
    this.ttl = ttl;
  }

  get(key: string): LocalEventResponse | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    // Check if expired
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    // Move to end (most recently used) by re-inserting
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.data;
  }

  set(key: string, data: LocalEventResponse): void {
    // Delete if exists (to update order)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    
    // Evict oldest entries if at capacity
    while (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  // Cleanup expired entries periodically
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of Array.from(this.cache.entries())) {
      if (now - entry.timestamp > this.ttl) {
        this.cache.delete(key);
      }
    }
  }
}

const localEventsCache = new LocalEventsLRUCache(LOCAL_EVENTS_CACHE_MAX_SIZE, LOCAL_EVENTS_CACHE_TTL);

// Cleanup expired entries every hour
setInterval(() => localEventsCache.cleanup(), 60 * 60 * 1000);

/**
 * Enrich news podcast research with Grok Live Search (web + X/Twitter)
 * Returns social pulse, trending reactions, and public sentiment from X alongside web sources.
 * Gracefully returns empty result on any error — this is additive, not critical path.
 */
export async function getNewsContextFromGrok(
  topic: string,
  timeframe: string = 'past 24 hours'
): Promise<{ content: string; citations: string[] }> {
  if (!process.env.XAI_API_KEY) {
    return { content: '', citations: [] };
  }

  try {
    console.log(`[Grok] Fetching live news social context for: "${topic.substring(0, 60)}..."`);

    const response = await grok.chat.completions.create({
      model: GROK_MODEL,
      messages: [
        {
          role: 'system',
          content: `You are a news research assistant specialising in social media pulse and real-time public sentiment. 
Your job is to find what people on X (Twitter) and the web are saying about a news topic right now.
Focus on: trending reactions, viral posts, public sentiment shifts, expert opinions shared on X, and any breaking developments not yet in mainstream news.
Be factual, cite sources, and keep the response structured and concise.`
        },
        {
          role: 'user',
          content: `What is the social media pulse and public sentiment around "${topic}" in the ${timeframe}? 
Include trending X (Twitter) discussions, viral reactions, notable expert or public figure posts, and any breaking angles from the web. 
Summarise the social context in 3-5 paragraphs.`
        }
      ],
      temperature: 0.4,
      max_tokens: 1500,
      search_parameters: {
        mode: 'on',
        sources: [{ type: 'web' }, { type: 'x' }],
        max_search_results: 15,
        return_citations: true
      }
    } as any);

    const message = response.choices[0]?.message;
    if (!message?.content) {
      return { content: '', citations: [] };
    }

    const citations: string[] = ((response as any).citations || []).map((c: any) =>
      typeof c === 'string' ? c : c?.url || ''
    ).filter(Boolean);

    console.log(`[Grok] Live news social context: ${message.content.length} chars, ${citations.length} citations`);
    return { content: message.content, citations };
  } catch (error) {
    console.error('[Grok] Live search for news context failed (non-critical):', error);
    return { content: '', citations: [] };
  }
}

export interface LocalEvent {
  name: string;
  venue: string;
  date: string;
  time?: string;
  description: string;
  category: string;
  ticketInfo?: string;
  sourceUrl?: string;
  engagementLevel: 'viral' | 'trending' | 'rising' | 'upcoming';
}

interface LocalEventResponse {
  events: LocalEvent[];
  city: string;
  lastUpdated: string;
  disclaimer: string;
}

/**
 * Discover local events using Grok's X/Twitter data access
 * Grok excels at finding real-time event information from social media
 */
export async function getXLocalEvents(
  city: string,
  eventType?: string,
  dateRange: 'today' | 'this_week' | 'this_month' = 'this_week',
  count: number = 15
): Promise<LocalEventResponse> {
  if (!process.env.XAI_API_KEY) {
    throw new Error("XAI_API_KEY is not configured. Local event discovery requires an xAI API key.");
  }

  // Check cache first (LRU cache handles TTL internally)
  const cacheKey = eventType ? `${city}:${eventType}:${dateRange}` : `${city}:all:${dateRange}`;
  const cached = localEventsCache.get(cacheKey);
  if (cached) {
    console.log(`[Grok] Returning cached local events for ${cacheKey}`);
    return cached;
  }

  console.log(`[Grok] Fetching local events in ${city}${eventType ? ` (${eventType})` : ''} for ${dateRange}...`);

  const eventTypeFilter = eventType 
    ? `Focus specifically on ${eventType} events (e.g., ${eventType} shows, ${eventType} performances, ${eventType} gigs).`
    : 'Include a variety of event types like concerts, comedy shows, festivals, sports, theater, exhibitions, and local gigs.';

  const dateRangeText = dateRange === 'today' 
    ? 'happening TODAY' 
    : dateRange === 'this_week' 
      ? 'happening in the next 7 days' 
      : 'happening in the next 30 days';

  try {
    const response = await grok.chat.completions.create({
      model: GROK_MODEL,
      messages: [
        {
          role: "system",
          content: `You are an expert at finding local events and shows using real-time X/Twitter data and social media buzz. You have access to what people are posting about upcoming events in specific cities.

Your task is to identify up to ${count} upcoming events ${dateRangeText} in ${city}.

${eventTypeFilter}

For each event, provide:
1. Event name - the official name of the show/event
2. Venue - where it's happening (venue name and address if known)
3. Date - the date(s) it's happening (format: "December 3, 2025" or "December 3-5, 2025")
4. Time - start time if known (format: "7:00 PM")
5. Description - brief 1-2 sentence description of the event
6. Category - type of event (concert, comedy, festival, sports, theater, exhibition, workshop, local-gig)
7. Ticket info - pricing or where to get tickets if mentioned
8. Source URL - link to official event page or ticket site if available
9. Engagement level - based on social buzz (viral = huge buzz, trending = significant discussion, rising = gaining attention, upcoming = scheduled but less buzz)

Order events chronologically by date, starting with the soonest.
Be as accurate as possible with dates and venues. If you're not certain about specific details, indicate that.

Return ONLY valid JSON with this structure:
{
  "events": [
    {
      "name": "Event name",
      "venue": "Venue Name, Address",
      "date": "December 3, 2025",
      "time": "7:00 PM",
      "description": "Brief description",
      "category": "comedy",
      "ticketInfo": "$25 at venue or online",
      "sourceUrl": "https://example.com/event",
      "engagementLevel": "trending"
    }
  ]
}`
        },
        {
          role: "user",
          content: `What are the upcoming ${eventType || 'events and shows'} ${dateRangeText} in ${city}? Give me real, specific events with dates, venues, and details based on current social media activity and event listings.`
        }
      ],
      temperature: 0.7,
      max_tokens: 4000,
      response_format: { type: "json_object" }
    });

    const content = response.choices[0].message.content || '{"events": []}';
    
    try {
      const parsed = JSON.parse(content);
      const events: LocalEvent[] = (parsed.events || []).map((event: any) => ({
        name: event.name || 'Untitled Event',
        venue: event.venue || 'Venue TBA',
        date: event.date || 'Date TBA',
        time: event.time || undefined,
        description: event.description || '',
        category: event.category || 'event',
        ticketInfo: event.ticketInfo || undefined,
        sourceUrl: event.sourceUrl || undefined,
        engagementLevel: event.engagementLevel || 'upcoming'
      }));

      console.log(`[Grok] Found ${events.length} local events in ${city}`);

      const result: LocalEventResponse = {
        events,
        city,
        lastUpdated: new Date().toISOString(),
        disclaimer: "Event information sourced from social media. Please verify details with official sources before attending."
      };

      // Cache the result (LRU cache handles timestamp internally)
      localEventsCache.set(cacheKey, result);

      return result;
    } catch (parseError) {
      console.error('[Grok] Error parsing local events response:', parseError);
      return {
        events: [],
        city,
        lastUpdated: new Date().toISOString(),
        disclaimer: "Unable to parse event data. Please try again."
      };
    }
  } catch (error) {
    console.error('[Grok] Error fetching local events:', error);
    throw error;
  }
}

// X Trending Topics Cache (6h TTL with stale-while-revalidate at ~4h).
const X_TRENDING_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
const X_TRENDING_SWR_THRESHOLD = 4 * 60 * 60 * 1000; // refresh in background after 4h
const X_TRENDING_FRESH_MS = 24 * 60 * 60 * 1000; // 24h freshness window for individual topics

export interface XTrendingTopic {
  title: string;
  description: string;
  category: string;
  engagementLevel: 'viral' | 'trending' | 'rising';
  source: 'x';
  // ISO 8601 timestamp of when the underlying X discussion started, if known.
  publishedAt?: string;
}

interface XTrendingCacheEntry {
  topics: XTrendingTopic[];
  lastUpdated: string;
  cachedAt: number;
}
const xTrendingCache = new Map<string, XTrendingCacheEntry>();
// Dedupe concurrent background refreshes per cache key so we never fan out
// multiple in-flight Grok calls for the same trending key.
const xInFlightRefreshes = new Map<string, Promise<XTrendingCacheEntry | null>>();

// Cleanup expired X trending cache entries every hour
setInterval(() => {
  const now = Date.now();
  const expired: string[] = [];
  xTrendingCache.forEach((entry, key) => {
    if (now - entry.cachedAt > X_TRENDING_CACHE_TTL) {
      expired.push(key);
    }
  });
  expired.forEach(key => xTrendingCache.delete(key));
  if (expired.length > 0) {
    console.log(`[Grok] Cleaned up ${expired.length} expired X trending cache entries`);
  }
}, 60 * 60 * 1000);

/**
 * Drop topics whose publishedAt is older than 24h. Topics with an unknown
 * publishedAt are kept (we don't have evidence they're stale).
 */
function filterFreshXTopics(topics: XTrendingTopic[], cacheKey: string): XTrendingTopic[] {
  const now = Date.now();
  const cutoff = now - X_TRENDING_FRESH_MS;
  let dropped = 0;
  const fresh = topics.filter(t => {
    if (!t.publishedAt) return true;
    const ts = Date.parse(t.publishedAt);
    if (isNaN(ts)) return true;
    if (ts < cutoff) {
      dropped++;
      return false;
    }
    return true;
  });
  if (dropped > 0) {
    console.log(`[Grok] 🧹 Filtered ${dropped} stale X topic(s) (>24h) for ${cacheKey}`);
  }
  return fresh;
}

/**
 * Actually call Grok to fetch trending X topics. Does not touch the cache —
 * the caller decides whether to cache the result and when to invoke this.
 */
async function fetchXTrendingFromGrok(
  category: string | undefined,
  count: number,
  cacheKey: string,
): Promise<XTrendingCacheEntry | null> {
  const currentDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  console.log(`[Grok] Fetching ${count} trending topics from X${category ? ` in category: ${category}` : ''}...`);

  const categoryFilter = category
    ? `Focus specifically on ${category} topics.`
    : 'Include a variety of categories like technology, politics, entertainment, sports, business, and culture.';

  try {
    const response = await grok.chat.completions.create({
      model: GROK_MODEL,
      messages: [
        {
          role: "system",
          content: `You are a real-time X/Twitter analyst. TODAY'S DATE: ${currentDate}

CRITICAL REQUIREMENT: You must ONLY identify topics that are trending RIGHT NOW - within the LAST 24 HOURS. STRICTLY REJECT any topic that is older than 24 hours or based on old news.

Your task is to identify the ${count} most interesting and podcast-worthy topics that started trending TODAY or yesterday on X.

${categoryFilter}

For each topic, provide:
1. A clear, engaging title that would work as a podcast topic
2. A brief description explaining why it's trending RIGHT NOW and what the current conversation is about
3. The category it belongs to
4. The engagement level (viral = massive engagement, trending = significant discussion, rising = gaining momentum)
5. The publish time of the underlying X post / discussion that anchors this trend, in ISO 8601 (e.g. 2025-04-28T15:30:00Z). If you genuinely can't tell, use null.

IMPORTANT: Only include topics with posts/discussions from the last 24 hours. If a topic is not currently active, do not include it.

Return ONLY valid JSON with this structure:
{
  "topics": [
    {
      "title": "Topic title here",
      "description": "Brief 1-2 sentence description of why it's trending NOW",
      "category": "technology|politics|entertainment|sports|business|culture|science|health|gaming|music",
      "engagementLevel": "viral|trending|rising",
      "publishedAt": "2025-04-28T15:30:00Z"
    }
  ]
}`
        },
        {
          role: "user",
          content: `As of ${currentDate}, what are the top ${count} trending topics on X RIGHT NOW (within the last 24 hours only) that would make great podcast content? ONLY include topics that are actively being discussed today. ${category ? `Focus on ${category} topics.` : 'Give me a diverse mix across different categories.'}`
        }
      ],
      temperature: 0.7,
      max_tokens: 2000,
      response_format: { type: "json_object" }
    });

    const content = response.choices[0].message.content || '{"topics": []}';

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      console.error('[Grok] Error parsing X trending response:', parseError);
      return null;
    }

    const rawTopics: XTrendingTopic[] = (parsed.topics || []).map((topic: any) => {
      let publishedAt: string | undefined;
      if (typeof topic.publishedAt === 'string' && topic.publishedAt.trim()) {
        const parsedDate = new Date(topic.publishedAt);
        if (!isNaN(parsedDate.getTime())) {
          publishedAt = parsedDate.toISOString();
        }
      }
      return {
        title: topic.title || 'Untitled Topic',
        description: topic.description || '',
        category: topic.category || 'general',
        engagementLevel: topic.engagementLevel || 'trending',
        source: 'x' as const,
        publishedAt,
      };
    });

    const topics = filterFreshXTopics(rawTopics, cacheKey);
    console.log(`[Grok] Found ${topics.length} trending X topics (from ${rawTopics.length} raw)`);

    const lastUpdated = new Date().toISOString();
    const entry: XTrendingCacheEntry = { topics, lastUpdated, cachedAt: Date.now() };

    // Only persist non-empty results so an empty fetch doesn't replace a good
    // cached entry. The caller still gets the empty result for this call.
    if (topics.length > 0) {
      xTrendingCache.set(cacheKey, entry);
      console.log(`[Grok] ✅ Cached X trending (${cacheKey}): ${topics.length} topics`);
    }

    return entry;
  } catch (error) {
    console.error('[Grok] Error fetching X trending topics:', error);
    throw error;
  }
}

/**
 * Schedule a single, deduped background refresh for the given X cache key.
 * Concurrent callers all see the same in-flight promise.
 */
function refreshXTrendingInBackground(category: string | undefined, count: number, cacheKey: string): void {
  if (xInFlightRefreshes.has(cacheKey)) return;
  console.log(`[Grok] 🔁 SWR background refresh kicked off for X (${cacheKey})`);
  const refreshPromise = fetchXTrendingFromGrok(category, count, cacheKey)
    .catch((err) => {
      console.error(`[Grok] Background X refresh failed for ${cacheKey}:`, err);
      return null;
    })
    .finally(() => {
      xInFlightRefreshes.delete(cacheKey);
    });
  xInFlightRefreshes.set(cacheKey, refreshPromise);
}

export async function getXTrendingTopics(category?: string, count: number = 10): Promise<{
  topics: XTrendingTopic[];
  lastUpdated: string;
}> {
  if (!process.env.XAI_API_KEY) {
    throw new Error("XAI_API_KEY is not configured. X trending topics require an xAI API key.");
  }

  const cacheKey = category || 'all';
  const cached = xTrendingCache.get(cacheKey);
  const now = Date.now();

  if (cached) {
    const age = now - cached.cachedAt;
    if (age < X_TRENDING_CACHE_TTL) {
      // Still cached. If we're past the SWR threshold, kick off a background
      // refresh while serving the existing value immediately.
      if (age >= X_TRENDING_SWR_THRESHOLD) {
        console.log(`[Grok] 🟡 SWR HIT for X trending (${cacheKey}, age=${Math.round(age / 60000)}m)`);
        refreshXTrendingInBackground(category, count, cacheKey);
      } else {
        console.log(`[Grok] 🟢 CACHE HIT for X trending (${cacheKey}): ${cached.topics.length} topics`);
      }
      return { topics: cached.topics, lastUpdated: cached.lastUpdated };
    }
  }

  // No fresh cache — block on a real fetch (deduped with any background one).
  const inFlight = xInFlightRefreshes.get(cacheKey);
  if (inFlight) {
    const result = await inFlight;
    if (result) return { topics: result.topics, lastUpdated: result.lastUpdated };
  }

  try {
    const refreshPromise = fetchXTrendingFromGrok(category, count, cacheKey).finally(() => {
      xInFlightRefreshes.delete(cacheKey);
    });
    xInFlightRefreshes.set(cacheKey, refreshPromise);
    const result = await refreshPromise;
    if (result) return { topics: result.topics, lastUpdated: result.lastUpdated };
    return { topics: [], lastUpdated: new Date().toISOString() };
  } catch (err) {
    // On hard failure, fall back to stale cache if available rather than 500ing.
    if (cached) {
      console.log(`[Grok] 🔄 Returning stale X cache for ${cacheKey} after error`);
      return { topics: cached.topics, lastUpdated: cached.lastUpdated };
    }
    throw err;
  }
}

export function clearXTrendingCache(): void {
  xTrendingCache.clear();
  console.log('[Grok] ✅ X trending cache cleared');
}

/**
 * Returns the age of the X trending cache entry for a given category in
 * milliseconds, or null if no entry exists. Used by the background warmer to
 * decide whether to skip a key without re-fetching from Grok.
 */
export function getXTrendingCacheAge(category?: string): number | null {
  const cacheKey = category || 'all';
  const cached = xTrendingCache.get(cacheKey);
  if (!cached) return null;
  return Date.now() - cached.cachedAt;
}

export default grok;
