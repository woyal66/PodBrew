import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, jsonb, integer, real, primaryKey, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const generatedPodcasts = pgTable("generated_podcasts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  topic: text("topic").notNull(),
  title: text("title"), // AI-generated catchy heading (max 8 words)
  description: text("description"), // User-editable episode description for RSS feeds
  audioUrl: text("audio_url").notNull(),
  coverImageUrl: text("cover_image_url"),
  duration: varchar("duration").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  isFavorite: boolean("is_favorite").notNull().default(false),
  tags: text("tags").array().notNull().default(sql`ARRAY[]::text[]`),
  sessionId: text("session_id"),
  userId: varchar("user_id"),
  isPublic: boolean("is_public").notNull().default(true),
  generationParams: jsonb("generation_params"),
  templateCategory: varchar("template_category").notNull().default('custom'),
  citations: text("citations").array().notNull().default(sql`ARRAY[]::text[]`),
  voiceQuality: varchar("voice_quality").notNull().default('standard'), // Match production schema
  creditsCost: real("credits_cost").notNull().default(0),
  plays: integer("plays").notNull().default(0),
  lastPlayedAt: timestamp("last_played_at"),
  promoImageUrl: text("promo_image_url"),
  engagementScore: integer("engagement_score").notNull().default(0),
  // Trial podcast tracking
  isTrial: boolean("is_trial").notNull().default(false), // True for guest trial podcasts
  guestSessionId: varchar("guest_session_id"), // Browser fingerprint/localStorage token for anonymous users
  // Idempotency key: client-generated job ID to prevent duplicate generation on retries
  clientJobId: varchar("client_job_id"),
  // Research failure flag: true if live Perplexity research failed and episode used general knowledge
  researchFailed: boolean("research_failed").notNull().default(false),
}, (table) => ({
  // Speeds up /api/podcasts/mine (user library) by orders of magnitude
  userTimestampIdx: index("podcasts_user_timestamp_idx").on(table.userId, table.timestamp.desc()),
  // Speeds up /api/podcasts/public (Discover feed - newest sort)
  publicTimestampIdx: index("podcasts_public_timestamp_idx").on(table.isPublic, table.timestamp.desc()),
  // Speeds up Discover popular sort
  publicPlaysIdx: index("podcasts_public_plays_idx").on(table.isPublic, table.plays.desc()),
}));

// Guest sessions for trial podcast tracking
export const guestSessions = pgTable("guest_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionToken: varchar("session_token").notNull().unique(), // Browser-generated token
  trialUsed: boolean("trial_used").notNull().default(false), // Has the trial been used?
  trialPodcastId: varchar("trial_podcast_id"), // ID of the trial podcast created
  convertedToUserId: varchar("converted_to_user_id"), // User ID if guest signs up
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(), // When trial podcast should be deleted
});

// Pending podcast generations for checkpoint-based resumption
// Used when server restarts during long-form podcast generation
export const pendingGenerations = pgTable("pending_generations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  topic: text("topic").notNull(),
  title: text("title"),
  description: text("description"),
  coverImageUrl: text("cover_image_url"),
  durationMinutes: integer("duration_minutes").notNull(),
  templateCategory: varchar("template_category").notNull().default('custom'),
  generationParams: jsonb("generation_params"), // Full settings for resumption
  // Progress tracking
  status: varchar("status").notNull().default('pending'), // pending, processing, script_complete, synthesizing, assembling, complete, failed
  // Script generation checkpointing
  scriptOutline: jsonb("script_outline"), // Generated outline for resumption
  completedSections: integer("completed_sections").notNull().default(0), // Script sections completed
  totalSections: integer("total_sections").notNull().default(0),
  scriptSegments: jsonb("script_segments"), // Generated script segments as JSON
  // TTS progress tracking
  completedSegments: integer("completed_segments").notNull().default(0), // TTS progress
  totalSegments: integer("total_segments").notNull().default(0),
  audioChunkUrls: text("audio_chunk_urls").array().notNull().default(sql`ARRAY[]::text[]`), // URLs of completed audio chunks in object storage
  // Credit tracking (idempotent)
  creditsDeducted: boolean("credits_deducted").notNull().default(false),
  creditsCost: real("credits_cost").notNull().default(0),
  citations: text("citations").array().notNull().default(sql`ARRAY[]::text[]`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  attempts: integer("attempts").notNull().default(0), // Number of resume attempts
});

export type PendingGeneration = typeof pendingGenerations.$inferSelect;
export type InsertPendingGeneration = typeof pendingGenerations.$inferInsert;

// Guest session types
export const insertGuestSessionSchema = createInsertSchema(guestSessions).omit({
  id: true,
  createdAt: true,
});
export type InsertGuestSession = z.infer<typeof insertGuestSessionSchema>;
export type GuestSession = typeof guestSessions.$inferSelect;

export const insertGeneratedPodcastSchema = createInsertSchema(generatedPodcasts).omit({
  id: true,
  timestamp: true,
  isFavorite: true,
  tags: true,
  plays: true,
  lastPlayedAt: true,
  promoImageUrl: true,
  engagementScore: true,
});

export type InsertGeneratedPodcast = z.infer<typeof insertGeneratedPodcastSchema>;
export type GeneratedPodcast = typeof generatedPodcasts.$inferSelect;

// Session storage table for Replit Auth
// This table is mandatory for Replit Auth session management
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
);

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  password: varchar("password"), // Hashed password for email/password auth
  googleId: varchar("google_id").unique(), // Google OAuth ID
  authProvider: varchar("auth_provider").notNull().default('email'), // 'google' or 'email'
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  alias: varchar("alias"), // User's display name (alias) for community/comments
  avatarUrl: varchar("avatar_url"), // Custom avatar URL (can override OAuth profile image)
  credits: real("credits").notNull().default(2),
  subscriptionPlan: varchar("subscription_plan").default('free'),
  subscriptionStatus: varchar("subscription_status").default('active'),
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  tierRestrictions: jsonb("tier_restrictions"),
  stripeCustomerId: varchar("stripe_customer_id").unique(), // Stripe customer ID for billing
  stripeSubscriptionId: varchar("stripe_subscription_id"), // Active Stripe subscription ID
  locationEnabled: boolean("location_enabled").notNull().default(false), // Enable location-aware content
  locationCity: varchar("location_city"), // User's city for local news/weather/events
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).omit({
  createdAt: true,
  updatedAt: true,
});

// Upsert schema for Replit Auth integration
export const upsertUserSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  profileImageUrl: z.string().nullable(),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type UpsertUser = z.infer<typeof upsertUserSchema>;
export type User = typeof users.$inferSelect;

export const subscriptions = pgTable("subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  plan: varchar("plan").notNull(),
  status: varchar("status").notNull().default('active'),
  currentPeriodStart: timestamp("current_period_start").notNull(),
  currentPeriodEnd: timestamp("current_period_end").notNull(),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptions.$inferSelect;

// Voice Favorites - User's favorite voices
export const voiceFavorites = pgTable("voice_favorites", {
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  voiceId: varchar("voice_id").notNull(), // googleVoiceName from voices table
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => {
  return {
    pk: primaryKey({ columns: [table.userId, table.voiceId], name: 'voice_favorites_pkey' }),
  };
});

export const insertVoiceFavoriteSchema = createInsertSchema(voiceFavorites).omit({
  createdAt: true,
});

export type InsertVoiceFavorite = z.infer<typeof insertVoiceFavoriteSchema>;
export type VoiceFavorite = typeof voiceFavorites.$inferSelect;

// Guest voice favorites — separate table so voice_favorites primary key is not broken
export const guestVoiceFavorites = pgTable("guest_voice_favorites", {
  guestId: varchar("guest_id").notNull(),
  voiceId: varchar("voice_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => {
  return {
    pk: primaryKey({ columns: [table.guestId, table.voiceId], name: 'guest_voice_favorites_pkey' }),
  };
});

export const insertGuestVoiceFavoriteSchema = createInsertSchema(guestVoiceFavorites).omit({
  createdAt: true,
});

export type InsertGuestVoiceFavorite = z.infer<typeof insertGuestVoiceFavoriteSchema>;
export type GuestVoiceFavorite = typeof guestVoiceFavorites.$inferSelect;

// DEPRECATED: Legacy voice IDs kept only for backward compatibility with old stored data
// New podcasts should use selectedVoiceIds (UUIDs from voice catalog) instead
export const voiceIdSchema = z.enum([
  'ash', 'sage', 'coral', 'river', 'sky', 'ember',
  'luna', 'sol', 'iris', 'jade', 'ruby', 'amber',
  'atlas', 'lyra',
]);

export const voiceQualitySchema = z.enum(['standard', 'premium', 'ultra', 'cinematic']);

// Valid timeframes for events and other templates
export type TimeFrame = 'past24h' | 'pastWeek' | 'pastMonth' | 'pastYear' | 'allTime' | 'next24h' | 'nextWeek' | 'nextMonth' | 'nextYear';

export const MUSIC_STYLE_IDS = ['none', 'ambient', 'news', 'upbeat', 'cinematic', 'jazz', 'acoustic', 'inspiring'] as const;
export type MusicStyleId = typeof MUSIC_STYLE_IDS[number];

export const generationParamsSchema = z.object({
  topic: z.string(),
  durationMinutes: z.number(),
  languageComplexity: z.number(),
  numPeople: z.number(),
  podcastStyle: z.string(),
  timeFrame: z.string(),
  coHostPersonality: z.string().optional(),
  podcastMood: z.enum(['uplifting', 'serious', 'humorous', 'mysterious', 'balanced', 'energetic']).optional().default('balanced'),
  language: z.string(),
  selectedVoicePool: z.array(voiceIdSchema).optional(),
  assignedVoices: z.array(voiceIdSchema).optional(),
  selectedVoiceIds: z.array(z.string()).optional(), // Custom voices selected from marketplace
  hostVoices: z.array(z.string()).optional(),
  templateCategory: z.string().optional(),
  eventFormat: z.enum(['recap', 'preview', 'guide']).optional(), // Events template format
  tonePreset: z.string().optional(), // Phase 2: neutral, warm, excited, investigative, dramatic
  voiceCustomization: z.object({
    pitch: z.number().optional(), // -5 to +5 semitones
    rate: z.number().optional(), // 0.8 to 1.2x
    volume: z.number().optional(), // -10 to +10 dB
  }).optional(),
  locationEnabled: z.boolean().optional(), // Enable location-aware content
  locationCity: z.string().nullable().optional(), // User's city for local news/weather/events
  musicStyle: z.enum(MUSIC_STYLE_IDS).optional(), // Lyria 3 background music style
});

export type GenerationParams = z.infer<typeof generationParamsSchema>;
export type VoiceQuality = z.infer<typeof voiceQualitySchema>;

// DEPRECATED: Legacy voice definitions removed
// All podcasts now use the Voice Catalog (voices table) with 30 premium Gemini voices
// Old voice IDs (alloy, echo, nova, fable, etc.) have been completely removed
export const AVAILABLE_VOICES = {
} as const;

export type VoiceId = keyof typeof AVAILABLE_VOICES;

export const VOICE_QUALITY_TIERS = {
  premium: { 
    label: 'Premium', 
    description: 'Gemini 2.5 Flash TTS - Premium voices (Default)', 
    costPerMillion: 0.6,
    creditsPerMinute: 0.1,
    modelTypes: ['gemini-2.5-flash'],
  },
} as const;

export const PODCAST_MOODS = {
  uplifting: {
    label: 'Uplifting',
    description: 'Optimistic & Inspiring',
  },
  serious: {
    label: 'Serious',
    description: 'Professional & Thoughtful',
  },
  humorous: {
    label: 'Humorous',
    description: 'Light & Entertaining',
  },
  mysterious: {
    label: 'Mysterious',
    description: 'Intriguing & Suspenseful',
  },
  balanced: {
    label: 'Balanced',
    description: 'Even & Neutral',
  },
  energetic: {
    label: 'Energetic',
    description: 'Dynamic & Enthusiastic',
  },
} as const;

export type PodcastMood = keyof typeof PODCAST_MOODS;

export const SUBSCRIPTION_PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    credits: 2,
    price: 0,
    features: ['2 credits/month', '18 min standard quality', 'Up to 3 hosts', 'Unlimited listening', 'All templates', 'Download & share'],
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    credits: 6,
    price: 1.50,
    features: ['6 credits/month', '60 min standard quality', 'Up to 2 hosts', 'Unlimited listening', 'All templates', 'Stream only (no download)'],
    canDownload: false,
  },
  creator: {
    id: 'creator',
    name: 'Creator',
    credits: 15,
    price: 3.50,
    features: ['15 credits/month', '150 min standard quality', 'Up to 3 hosts', 'Unlimited listening', 'All templates', 'Download & share', 'Cloud storage'],
  },
  studio: {
    id: 'studio',
    name: 'Studio',
    credits: 50,
    price: 10.95,
    features: ['50 credits/month', '500 min standard quality', 'Up to 3 hosts', 'Unlimited listening', 'All quality tiers', 'All templates', 'Download & share', 'Cloud storage'],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    credits: 90,
    price: 19.95,
    features: ['90 credits/month', '900 min standard quality', 'Up to 4 hosts', 'Unlimited listening', 'All quality tiers', 'All templates', 'Download & share', 'Cloud storage', 'Priority generation'],
  },
  professional: {
    id: 'professional',
    name: 'Professional',
    credits: 150,
    price: 29.95,
    features: ['150 credits/month', '1,500 min standard quality', 'Up to 5 hosts', 'Unlimited listening', 'All quality tiers', 'All templates', 'Download & share', 'Cloud storage', 'Priority generation', 'API access'],
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    credits: 999999999,
    price: 0,
    features: ['Unlimited credits', 'Unlimited duration', 'Up to 5 hosts', 'Unlimited listening', 'All quality tiers', 'All templates', 'Download & share', 'Cloud storage', 'Priority generation', 'API access'],
  },
} as const;

export type SubscriptionPlan = keyof typeof SUBSCRIPTION_PLANS;

export const TEMPLATE_CATEGORIES = {
  custom: {
    id: 'custom',
    name: 'Custom Topic',
    description: 'Create a podcast about any topic with full customization',
    icon: 'Mic',
    color: '#1DB954',
  },
  teachme: {
    id: 'teachme',
    name: 'Teach Me',
    description: 'Learn any subject with structured, engaging educational content',
    icon: 'GraduationCap',
    color: '#EF4444',
  },
  news: {
    id: 'news',
    name: 'News Briefing',
    description: 'Real-time news updates and topic-specific briefings',
    icon: 'Newspaper',
    color: '#3B82F6',
  },
  documents: {
    id: 'documents',
    name: 'Summarise Tool',
    description: 'Summarize PDFs, Word docs, books, and research papers',
    icon: 'FileText',
    color: '#8B5CF6',
  },
  sports: {
    id: 'sports',
    name: 'Sports Recap',
    description: 'Game summaries, player stats, and season analysis',
    icon: 'Trophy',
    color: '#F59E0B',
  },
  events: {
    id: 'events',
    name: 'Event Information',
    description: 'Conference, concert, and event details with schedules',
    icon: 'Calendar',
    color: '#10B981',
  },
  stories: {
    id: 'stories',
    name: 'Audiobook',
    description: 'Craft immersive AI-generated audiobooks in any genre — written and narrated just for you',
    icon: 'BookOpen',
    color: '#EC4899',
  },
  medical: {
    id: 'medical',
    name: 'Ask AI Doctor',
    description: 'Health information and condition explanations (educational only)',
    icon: 'Stethoscope',
    color: '#06B6D4',
  },
  deepdive: {
    id: 'deepdive',
    name: 'Deep Dive',
    description: 'Google NotebookLM-powered conversational deep dive between two AI hosts',
    icon: 'BrainCircuit',
    color: '#6366F1',
  },
} as const;

export type TemplateCategory = keyof typeof TEMPLATE_CATEGORIES;

export const templateCategorySchema = z.enum([
  'custom',
  'news',
  'documents',
  'sports',
  'teachme',
  'events',
  'stories',
  'medical',
  'deepdive',
]);

// Voice Catalog Schema - Phase 0 & 1
export const voices = pgTable("voices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  googleVoiceName: varchar("google_voice_name").notNull().unique(), // e.g., "en-US-Neural2-A"
  displayName: varchar("display_name").notNull(), // e.g., "Neural-A"
  aliasName: varchar("alias_name").notNull(), // e.g., "Max" - personalized name fitting accent/tone
  description: text("description"), // e.g., "Clear, professional male voice"
  accent: varchar("accent").notNull(), // US, UK, AU, IN, etc.
  gender: varchar("gender").notNull(), // MALE, FEMALE, NEUTRAL
  modelType: varchar("model_type").notNull(), // Neural2, WaveNet, Journey, Studio, News, Chirp3HD
  tier: varchar("tier").notNull(), // standard, premium, ultra, cinematic
  category: varchar("category").notNull().default('core'), // core, regional, specialty, news
  toneArchetype: varchar("tone_archetype"), // warm, authoritative, energetic, calm, investigative
  avatarUrl: text("avatar_url"), // URL to AI-generated portrait
  previewUrl: text("preview_url"), // URL to audio preview sample
  accentPreviewUrls: jsonb("accent_preview_urls").$type<Record<string, string>>(), // Map of accent -> preview URL
  watermarkIntroUrl: text("watermark_intro_url"), // URL to cached intro watermark (zero-credit generation)
  watermarkOutroUrl: text("watermark_outro_url"), // URL to cached outro watermark (zero-credit generation)
  supportedStyles: text("supported_styles").array().default(sql`ARRAY[]::text[]`), // For Chirp3 HD voices
  calibratedWps: real("calibrated_wps"), // Measured words-per-second from calibration test (null = use global default)
  calibratedAt: timestamp("calibrated_at"), // When the WPS calibration was last performed
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertVoiceSchema = createInsertSchema(voices).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertVoice = z.infer<typeof insertVoiceSchema>;
export type Voice = typeof voices.$inferSelect;

// SSML Prosody Presets - Phase 2
export const prosodyPresets = pgTable("prosody_presets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull().unique(), // neutral, warm, excited, investigative, dramatic
  displayName: varchar("display_name").notNull(),
  description: text("description"),
  pitchAdjustment: varchar("pitch_adjustment").notNull().default('+0st'), // e.g., "+2st", "-1st"
  rateAdjustment: varchar("rate_adjustment").notNull().default('100%'), // e.g., "110%", "90%"
  volumeAdjustment: varchar("volume_adjustment").notNull().default('+0dB'), // e.g., "+2dB", "-1dB"
  emphasisLevel: varchar("emphasis_level").notNull().default('moderate'), // none, reduced, moderate, strong
  ssmlTemplate: text("ssml_template"), // Optional custom SSML wrapper
  emotionMarkers: jsonb("emotion_markers"), // Mapping of emotion tags to SSML adjustments
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertProsodyPresetSchema = createInsertSchema(prosodyPresets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertProsodyPreset = z.infer<typeof insertProsodyPresetSchema>;
export type ProsodyPreset = typeof prosodyPresets.$inferSelect;

// User Monthly Usage Tracking
export const userMonthlyUsage = pgTable("user_monthly_usage", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  month: varchar("month").notNull(), // Format: YYYY-MM
  creditsUsed: real("credits_used").notNull().default(0),
  minutesGenerated: integer("minutes_generated").notNull().default(0),
  podcastsCreated: integer("podcasts_created").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertUserMonthlyUsageSchema = createInsertSchema(userMonthlyUsage).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUserMonthlyUsage = z.infer<typeof insertUserMonthlyUsageSchema>;
export type UserMonthlyUsage = typeof userMonthlyUsage.$inferSelect;

// Playlists - User-created podcast playlists
export const playlists = pgTable("playlists", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  coverImageUrl: text("cover_image_url"),
  isPublic: boolean("is_public").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPlaylistSchema = createInsertSchema(playlists).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPlaylist = z.infer<typeof insertPlaylistSchema>;
export type Playlist = typeof playlists.$inferSelect;

// Playlist Items - Podcasts in a playlist with ordering
export const playlistItems = pgTable("playlist_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  playlistId: varchar("playlist_id").notNull().references(() => playlists.id, { onDelete: 'cascade' }),
  podcastId: varchar("podcast_id").notNull().references(() => generatedPodcasts.id, { onDelete: 'cascade' }),
  position: integer("position").notNull().default(0),
  addedAt: timestamp("added_at").notNull().defaultNow(),
});

export const insertPlaylistItemSchema = createInsertSchema(playlistItems).omit({
  id: true,
  addedAt: true,
});

export type InsertPlaylistItem = z.infer<typeof insertPlaylistItemSchema>;
export type PlaylistItem = typeof playlistItems.$inferSelect;

// Playlist with items and podcast details (for API responses)
export type PlaylistWithItems = Playlist & {
  items: (PlaylistItem & { podcast: GeneratedPodcast })[];
  itemCount: number;
  totalDuration: string;
};

// ============================================
// DAILY PERSONALIZED NEWS - Favorite Topics
// ============================================

// Favorite Topics - User's saved topics for daily personalized news
export const favoriteTopics = pgTable("favorite_topics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  label: text("label").notNull(), // Topic text e.g., "NBA basketball results", "Brisbane weather"
  category: varchar("category").default('custom'), // Optional category: sports, weather, finance, tech, custom
  position: integer("position").notNull().default(0), // For ordering
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertFavoriteTopicSchema = createInsertSchema(favoriteTopics).omit({
  id: true,
  createdAt: true,
});

export type InsertFavoriteTopic = z.infer<typeof insertFavoriteTopicSchema>;
export type FavoriteTopic = typeof favoriteTopics.$inferSelect;

// ============================================
// NEWS PRESETS - Saved Format, Style, Voice Settings
// ============================================

// News Presets - User's saved presets for quick news brewing
export const newsPresets = pgTable("news_presets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: 'cascade' }), // null for guests
  guestId: varchar("guest_id"), // guest device token (mutually exclusive with userId)
  name: varchar("name").notNull().default('Default'), // Preset name
  isDefault: boolean("is_default").notNull().default(true), // Primary preset to use
  // Format settings
  durationMinutes: integer("duration_minutes").notNull().default(5),
  languageComplexity: integer("language_complexity").notNull().default(6),
  // Style settings
  numPeople: integer("num_people").notNull().default(1),
  podcastStyle: varchar("podcast_style").notNull().default('news'),
  timeFrame: varchar("time_frame").notNull().default('past24h'),
  coHostPersonality: varchar("co_host_personality").notNull().default('executive'),
  podcastMood: varchar("podcast_mood").notNull().default('balanced'),
  language: varchar("language").notNull().default('en'),
  // Voice settings
  selectedVoiceIds: text("selected_voice_ids").array().notNull().default(sql`ARRAY[]::text[]`),
  // Quick Brew independent settings - separate from main news template
  quickBrewEnabled: boolean("quick_brew_enabled").notNull().default(false), // Toggle for using custom Quick Brew settings
  quickBrewDurationMinutes: integer("quick_brew_duration_minutes").default(5),
  quickBrewNumPeople: integer("quick_brew_num_people").default(1),
  quickBrewPodcastStyle: varchar("quick_brew_podcast_style").default('news'),
  quickBrewPodcastMood: varchar("quick_brew_podcast_mood").default('balanced'),
  quickBrewVoiceIds: text("quick_brew_voice_ids").array().default(sql`ARRAY[]::text[]`),
  // Deduplication - Remember previous day's script to avoid repetitive content
  lastGeneratedScriptSummary: text("last_generated_script_summary"), // First 800 chars of previous day's script
  lastGeneratedDate: timestamp("last_generated_date"), // Date when script was generated
  // Auto-generation scheduling
  autoGenerateEnabled: boolean("auto_generate_enabled").notNull().default(false),
  autoGenerateTime: varchar("auto_generate_time"), // HH:mm format (24-hour), e.g., "06:00"
  autoGenerateTimezone: varchar("auto_generate_timezone").default('UTC'), // IANA timezone, e.g., "America/New_York"
  autoGeneratePublic: boolean("auto_generate_public").notNull().default(true), // Default public visibility
  lastAutoGeneratedAt: timestamp("last_auto_generated_at"), // Last successful auto-generation timestamp
  lastGenerateStatus: varchar("last_generate_status"), // success, insufficient_credits, failed, skipped
  lastGenerateError: text("last_generate_error"), // Error message if failed
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertNewsPresetSchema = createInsertSchema(newsPresets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertNewsPreset = z.infer<typeof insertNewsPresetSchema>;
export type NewsPreset = typeof newsPresets.$inferSelect;

// ============================================
// TEACHME PRESETS - Daily Micro-Learning Scheduling
// ============================================

// Syllabus Episode structure stored as JSON
export type SyllabusEpisode = {
  episodeNumber: number;
  title: string;
  focusTopic: string;
  keyPoints: string[];
  generated: boolean;
  podcastId?: string;
};

// TeachMe Presets - User's saved micro-learning course configurations
export const teachmePresets = pgTable("teachme_presets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: 'cascade' }), // null for guests
  guestId: varchar("guest_id"), // guest device token (mutually exclusive with userId)
  name: varchar("name").notNull().default('My Course'),
  topic: text("topic").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  episodeDuration: integer("episode_duration").notNull().default(10),
  totalEpisodes: integer("total_episodes").notNull().default(5),
  currentEpisode: integer("current_episode").notNull().default(0),
  syllabus: jsonb("syllabus").$type<SyllabusEpisode[]>().notNull().default(sql`'[]'::jsonb`),
  playlistId: varchar("playlist_id").references(() => playlists.id, { onDelete: 'set null' }),
  languageComplexity: integer("language_complexity").notNull().default(6),
  numPeople: integer("num_people").notNull().default(2),
  podcastStyle: varchar("podcast_style").notNull().default('conversational'),
  coHostPersonality: varchar("co_host_personality").notNull().default('academic'),
  podcastMood: varchar("podcast_mood").notNull().default('balanced'),
  language: varchar("language").notNull().default('en'),
  selectedVoiceIds: text("selected_voice_ids").array().notNull().default(sql`ARRAY[]::text[]`),
  autoGenerateEnabled: boolean("auto_generate_enabled").notNull().default(false),
  autoGenerateTime: varchar("auto_generate_time"),
  autoGenerateTimezone: varchar("auto_generate_timezone").default('UTC'),
  autoGeneratePublic: boolean("auto_generate_public").notNull().default(true),
  lastAutoGeneratedAt: timestamp("last_auto_generated_at"),
  lastGenerateStatus: varchar("last_generate_status"),
  lastGenerateError: text("last_generate_error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertTeachmePresetSchema = createInsertSchema(teachmePresets).omit({
  id: true,
  currentEpisode: true,
  syllabus: true,
  playlistId: true,
  lastAutoGeneratedAt: true,
  lastGenerateStatus: true,
  lastGenerateError: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertTeachmePreset = z.infer<typeof insertTeachmePresetSchema>;
export type TeachmePreset = typeof teachmePresets.$inferSelect;

// ============================================
// SOCIAL FEATURES - Reactions, Comments, Trending
// ============================================

// Reaction types for podcasts (like/dislike)
export const REACTION_TYPES = ['listen', 'skip'] as const;
export type ReactionType = typeof REACTION_TYPES[number];

// Podcast Reactions - Tracks user like/dislike on podcasts
export const podcastLikes = pgTable("podcast_likes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  podcastId: varchar("podcast_id").notNull().references(() => generatedPodcasts.id, { onDelete: 'cascade' }),
  userId: varchar("user_id").references(() => users.id, { onDelete: 'cascade' }), // null for guests
  guestId: varchar("guest_id"), // guest device token for unauthenticated users
  reactionType: varchar("reaction_type").notNull().default('listen'), // 'listen' (like) or 'skip' (dislike)
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  uniqueUserPodcast: sql`CREATE UNIQUE INDEX IF NOT EXISTS podcast_likes_user_podcast_idx ON podcast_likes(user_id, podcast_id) WHERE user_id IS NOT NULL`,
  uniqueGuestPodcast: sql`CREATE UNIQUE INDEX IF NOT EXISTS podcast_likes_guest_podcast_idx ON podcast_likes(guest_id, podcast_id) WHERE guest_id IS NOT NULL`,
}));

export const insertPodcastLikeSchema = createInsertSchema(podcastLikes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPodcastLike = z.infer<typeof insertPodcastLikeSchema>;
export type PodcastLike = typeof podcastLikes.$inferSelect;

// Comments - User comments on podcasts with threading support
export const comments = pgTable("comments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  podcastId: varchar("podcast_id").notNull().references(() => generatedPodcasts.id, { onDelete: 'cascade' }),
  userId: varchar("user_id").references(() => users.id, { onDelete: 'cascade' }), // null for guests
  guestId: varchar("guest_id"), // guest device token for unauthenticated commenters
  guestName: varchar("guest_name"), // display name chosen by guest
  parentId: varchar("parent_id"), // For threaded replies - null means top-level comment
  body: text("body").notNull(),
  status: varchar("status").notNull().default('published'), // published, pending, removed
  isPinned: boolean("is_pinned").notNull().default(false),
  upvotes: integer("upvotes").notNull().default(0),
  downvotes: integer("downvotes").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCommentSchema = createInsertSchema(comments).omit({
  id: true,
  status: true,
  isPinned: true,
  upvotes: true,
  downvotes: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertComment = z.infer<typeof insertCommentSchema>;
export type Comment = typeof comments.$inferSelect;

// Comment with user info for display
export type CommentWithUser = Comment & {
  user: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    profileImageUrl: string | null;
    isGuest?: boolean;
    guestName?: string | null;
  };
  replies?: CommentWithUser[];
  userVote?: number; // 1, -1, or 0 (no vote)
};

// Comment Votes - User votes on comments (for Wilson score ranking)
export const commentVotes = pgTable("comment_votes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  commentId: varchar("comment_id").notNull().references(() => comments.id, { onDelete: 'cascade' }),
  userId: varchar("user_id").references(() => users.id, { onDelete: 'cascade' }), // null for guests
  guestId: varchar("guest_id"), // guest device token for unauthenticated voters
  value: integer("value").notNull(), // 1 = upvote, -1 = downvote
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  uniqueUserComment: sql`CREATE UNIQUE INDEX IF NOT EXISTS comment_votes_user_comment_idx ON comment_votes(user_id, comment_id) WHERE user_id IS NOT NULL`,
  uniqueGuestComment: sql`CREATE UNIQUE INDEX IF NOT EXISTS comment_votes_guest_comment_idx ON comment_votes(guest_id, comment_id) WHERE guest_id IS NOT NULL`,
}));

export const insertCommentVoteSchema = createInsertSchema(commentVotes).omit({
  id: true,
  createdAt: true,
});

export type InsertCommentVote = z.infer<typeof insertCommentVoteSchema>;
export type CommentVote = typeof commentVotes.$inferSelect;

// Podcast Engagement - Denormalized engagement metrics + hot score
export const podcastEngagement = pgTable("podcast_engagement", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  podcastId: varchar("podcast_id").notNull().references(() => generatedPodcasts.id, { onDelete: 'cascade' }).unique(),
  likes: integer("likes").notNull().default(0), // Derived: count of like (listen) reactions
  dislikes: integer("dislikes").notNull().default(0), // Derived: count of dislike (skip) reactions
  listenCount: integer("listen_count").notNull().default(0), // Like reactions (kept = likes for now)
  skipCount: integer("skip_count").notNull().default(0), // Dislike reactions (kept = dislikes for now)
  totalReactions: integer("total_reactions").notNull().default(0), // Total reaction count
  commentCount: integer("comment_count").notNull().default(0),
  shareCount: integer("share_count").notNull().default(0),
  hotScore: real("hot_score").notNull().default(0), // Reddit-style hot ranking score
  trendingScore: real("trending_score").notNull().default(0), // Velocity-based trending score
  lastEngagementAt: timestamp("last_engagement_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPodcastEngagementSchema = createInsertSchema(podcastEngagement).omit({
  id: true,
  updatedAt: true,
});

export type InsertPodcastEngagement = z.infer<typeof insertPodcastEngagementSchema>;
export type PodcastEngagement = typeof podcastEngagement.$inferSelect;

// Share Events - Track share actions for trending algorithm
export const shareEvents = pgTable("share_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  podcastId: varchar("podcast_id").notNull().references(() => generatedPodcasts.id, { onDelete: 'cascade' }),
  userId: varchar("user_id").references(() => users.id, { onDelete: 'set null' }), // Can be null for anonymous shares
  platform: varchar("platform"), // 'clipboard', 'twitter', 'facebook', etc.
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertShareEventSchema = createInsertSchema(shareEvents).omit({
  id: true,
  createdAt: true,
});

export type InsertShareEvent = z.infer<typeof insertShareEventSchema>;
export type ShareEvent = typeof shareEvents.$inferSelect;

// Playback progress - tracks where each user left off in each podcast
// so the Continue Listening rail can resume from position, not just timestamp.
export const playbackProgress = pgTable("playback_progress", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  podcastId: varchar("podcast_id").notNull().references(() => generatedPodcasts.id, { onDelete: 'cascade' }),
  positionSeconds: integer("position_seconds").notNull().default(0),
  durationSeconds: integer("duration_seconds").notNull().default(0),
  completed: boolean("completed").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userPodcastUnique: unique("playback_progress_user_podcast_unique").on(table.userId, table.podcastId),
  userUpdatedIdx: index("playback_progress_user_updated_idx").on(table.userId, table.updatedAt),
}));

export const insertPlaybackProgressSchema = createInsertSchema(playbackProgress).omit({
  id: true,
  updatedAt: true,
});

export type InsertPlaybackProgress = z.infer<typeof insertPlaybackProgressSchema>;
export type PlaybackProgress = typeof playbackProgress.$inferSelect;

// Podcast with engagement data for API responses
export type PodcastWithEngagement = GeneratedPodcast & {
  engagement?: PodcastEngagement;
  userLike?: number; // 1, -1, or 0 (no vote)
};

// Top comment shape returned by getBatchTopComments
export type PodcastTopComment = {
  id: string;
  body: string;
  user: { firstName: string | null; lastName: string | null; profileImageUrl: string | null };
  upvotes: number;
} | null;

// Enrichment fields attached to podcast objects returned from the public/trending endpoints
export type EnrichedPodcast = GeneratedPodcast & {
  _engagement?: PodcastEngagement | null;
  _topComment?: PodcastTopComment;
  _userLike?: PodcastLike | null;
  // Slim list payload (Task #102): the `/api/podcasts/mine` response no
  // longer carries the full `generationParams` blob; instead it projects
  // just the `numPeople` value tile rendering needs. Optional everywhere
  // because detail-page rows still carry the full `generationParams`.
  _numPeople?: number | null;
  // Resume-from-position info attached by getContinueListening when the
  // current user has saved playback progress for this podcast.
  _progress?: {
    positionSeconds: number;
    durationSeconds: number;
    percent: number;
  };
};

// Tier Restrictions Schema
export const tierRestrictionsSchema = z.object({
  maxDurationMinutes: z.number(), // e.g., 2 for free tier
  maxHosts: z.number(), // e.g., 3 for free tier, 4 for pro, 5 for professional
  monthlyCredits: z.number(), // e.g., 30 for free tier
  allowedVoiceTiers: z.array(voiceQualitySchema), // e.g., ['standard'] for free tier
  allowedTemplates: z.array(templateCategorySchema).optional(), // Optional template restrictions
});

export type TierRestrictions = z.infer<typeof tierRestrictionsSchema>;

// Default tier restrictions by plan
// Note: All voice tiers are available to all users. Paid plans offer more credits and longer durations.
// Host limits: Free/Creator/Studio = 3, Pro = 4, Professional/Enterprise = 5
export const DEFAULT_TIER_RESTRICTIONS: Record<SubscriptionPlan, TierRestrictions> = {
  free: {
    maxDurationMinutes: 20,
    maxHosts: 3,
    monthlyCredits: 999999,
    allowedVoiceTiers: ['standard', 'premium', 'ultra', 'cinematic'],
  },
  starter: {
    maxDurationMinutes: 20,
    maxHosts: 3,
    monthlyCredits: 999999,
    allowedVoiceTiers: ['standard', 'premium', 'ultra', 'cinematic'],
  },
  creator: {
    maxDurationMinutes: 20,
    maxHosts: 3,
    monthlyCredits: 999999,
    allowedVoiceTiers: ['standard', 'premium', 'ultra', 'cinematic'],
  },
  studio: {
    maxDurationMinutes: 20,
    maxHosts: 3,
    monthlyCredits: 999999,
    allowedVoiceTiers: ['standard', 'premium', 'ultra', 'cinematic'],
  },
  pro: {
    maxDurationMinutes: 20,
    maxHosts: 4,
    monthlyCredits: 999999,
    allowedVoiceTiers: ['standard', 'premium', 'ultra', 'cinematic'],
  },
  professional: {
    maxDurationMinutes: 20,
    maxHosts: 5,
    monthlyCredits: 999999,
    allowedVoiceTiers: ['standard', 'premium', 'ultra', 'cinematic'],
  },
  enterprise: {
    maxDurationMinutes: 20,
    maxHosts: 5,
    monthlyCredits: 999999,
    allowedVoiceTiers: ['standard', 'premium', 'ultra', 'cinematic'],
  },
};

// Generated Image type (for AI image generation feature)
export interface GeneratedImage {
  id: string;
  imageUrl: string;
  prompt: string;
  timestamp: Date | string;
  isFavorite: boolean | string;
}

// Podcast Shows - RSS feed channels for distribution to Spotify, Apple Podcasts, etc.
export const podcastShows = pgTable("podcast_shows", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  author: varchar("author", { length: 255 }),
  email: varchar("email", { length: 255 }),
  coverImageUrl: text("cover_image_url"),
  category: varchar("category", { length: 100 }),
  subcategory: varchar("subcategory", { length: 100 }),
  language: varchar("language", { length: 10 }).notNull().default('en'),
  explicit: boolean("explicit").notNull().default(false),
  websiteUrl: text("website_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPodcastShowSchema = createInsertSchema(podcastShows).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPodcastShow = z.infer<typeof insertPodcastShowSchema>;
export type PodcastShow = typeof podcastShows.$inferSelect;

// Show Episodes - Links podcasts to shows for RSS feeds
export const showEpisodes = pgTable("show_episodes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  showId: varchar("show_id").notNull().references(() => podcastShows.id, { onDelete: 'cascade' }),
  podcastId: varchar("podcast_id").notNull().references(() => generatedPodcasts.id, { onDelete: 'cascade' }),
  episodeNumber: integer("episode_number"),
  seasonNumber: integer("season_number"),
  position: integer("position").notNull().default(0),
  addedAt: timestamp("added_at").notNull().defaultNow(),
}, (table) => ({
  uniqueShowPodcast: sql`CREATE UNIQUE INDEX IF NOT EXISTS show_episodes_show_podcast_idx ON show_episodes(show_id, podcast_id)`,
}));

export const insertShowEpisodeSchema = createInsertSchema(showEpisodes).omit({
  id: true,
  addedAt: true,
});

export type InsertShowEpisode = z.infer<typeof insertShowEpisodeSchema>;
export type ShowEpisode = typeof showEpisodes.$inferSelect;

// Persistent Cache - Cross-deploy caching for expensive API calls
export const cacheEntries = pgTable("cache_entries", {
  key: varchar("key").primaryKey(),
  value: jsonb("value").notNull(),
  category: varchar("category").notNull(), // 'research', 'trending', 'events', 'coverart'
  ttlSeconds: integer("ttl_seconds").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
});

export const insertCacheEntrySchema = createInsertSchema(cacheEntries).omit({
  createdAt: true,
});

export type InsertCacheEntry = z.infer<typeof insertCacheEntrySchema>;
export type CacheEntry = typeof cacheEntries.$inferSelect;

// RSS feed categories for iTunes/Spotify
export const RSS_CATEGORIES = [
  { name: 'Arts', subcategories: ['Books', 'Design', 'Fashion & Beauty', 'Food', 'Performing Arts', 'Visual Arts'] },
  { name: 'Business', subcategories: ['Careers', 'Entrepreneurship', 'Investing', 'Management', 'Marketing', 'Non-Profit'] },
  { name: 'Comedy', subcategories: ['Comedy Interviews', 'Improv', 'Stand-Up'] },
  { name: 'Education', subcategories: ['Courses', 'How To', 'Language Learning', 'Self-Improvement'] },
  { name: 'Fiction', subcategories: ['Comedy Fiction', 'Drama', 'Science Fiction'] },
  { name: 'Health & Fitness', subcategories: ['Alternative Health', 'Fitness', 'Medicine', 'Mental Health', 'Nutrition', 'Sexuality'] },
  { name: 'History', subcategories: [] },
  { name: 'Kids & Family', subcategories: ['Education for Kids', 'Parenting', 'Pets & Animals', 'Stories for Kids'] },
  { name: 'Leisure', subcategories: ['Animation & Manga', 'Automotive', 'Aviation', 'Crafts', 'Games', 'Hobbies', 'Home & Garden', 'Video Games'] },
  { name: 'Music', subcategories: ['Music Commentary', 'Music History', 'Music Interviews'] },
  { name: 'News', subcategories: ['Business News', 'Daily News', 'Entertainment News', 'News Commentary', 'Politics', 'Sports News', 'Tech News'] },
  { name: 'Religion & Spirituality', subcategories: ['Buddhism', 'Christianity', 'Hinduism', 'Islam', 'Judaism', 'Religion', 'Spirituality'] },
  { name: 'Science', subcategories: ['Astronomy', 'Chemistry', 'Earth Sciences', 'Life Sciences', 'Mathematics', 'Natural Sciences', 'Nature', 'Physics', 'Social Sciences'] },
  { name: 'Society & Culture', subcategories: ['Documentary', 'Personal Journals', 'Philosophy', 'Places & Travel', 'Relationships'] },
  { name: 'Sports', subcategories: ['Baseball', 'Basketball', 'Cricket', 'Fantasy Sports', 'Football', 'Golf', 'Hockey', 'Rugby', 'Soccer', 'Swimming', 'Tennis', 'Volleyball', 'Wilderness', 'Wrestling'] },
  { name: 'Technology', subcategories: ['AI & Data Science', 'Gadgets', 'Tech News', 'Programming', 'Software How-To'] },
  { name: 'True Crime', subcategories: [] },
  { name: 'TV & Film', subcategories: ['After Shows', 'Film History', 'Film Interviews', 'Film Reviews', 'TV Reviews'] },
] as const;

// Generation Metrics - Telemetry for podcast generation timing
// Note: Dates are serialized as ISO strings over JSON API
export interface GenerationMetricRecord {
  id: string;
  userId: string;
  templateCategory: string;
  durationMinutes: number;
  requestedDurationMinutes: number;
  estimatedTimeSeconds: number;
  actualTimeSeconds: number;
  startedAt: string; // ISO date string (serialized from Date)
  completedAt: string; // ISO date string (serialized from Date)
  success: boolean;
  errorMessage?: string;
}

export interface GenerationStatsSummary {
  totalGenerations: number;
  successRate: number;
  averageActualSeconds: number;
  averageEstimatedSeconds: number;
  averageAccuracyPercent: number;
  byDurationBucket: {
    bucket: string;
    minDuration: number;
    maxDuration: number;
    count: number;
    avgActualSeconds: number;
    avgEstimatedSeconds: number;
    avgAccuracyPercent: number;
  }[];
  byTemplate: {
    template: string;
    count: number;
    avgActualSeconds: number;
    successRate: number;
  }[];
}
