import { type GeneratedPodcast, type InsertGeneratedPodcast, generatedPodcasts, type User, type UpsertUser, users, type VoiceFavorite, type InsertVoiceFavorite, voiceFavorites, guestVoiceFavorites, type Playlist, type InsertPlaylist, playlists, type PlaylistItem, type InsertPlaylistItem, playlistItems, type PlaylistWithItems, type PodcastLike, type InsertPodcastLike, podcastLikes, type Comment, type InsertComment, comments, type CommentWithUser, type CommentVote, type InsertCommentVote, commentVotes, type PodcastEngagement, type InsertPodcastEngagement, podcastEngagement, type ShareEvent, type InsertShareEvent, shareEvents, type PodcastWithEngagement, type EnrichedPodcast, type ReactionType, type FavoriteTopic, type InsertFavoriteTopic, favoriteTopics, type NewsPreset, type InsertNewsPreset, newsPresets, type TeachmePreset, type InsertTeachmePreset, teachmePresets, type SyllabusEpisode, type PodcastShow, type InsertPodcastShow, podcastShows, type ShowEpisode, type InsertShowEpisode, showEpisodes, type GenerationMetricRecord, type GenerationStatsSummary, type PlaybackProgress, playbackProgress } from "@shared/schema";
import type { InferInsertModel, SQL } from "drizzle-orm";
import { db } from "./db";
import { desc, eq, and, isNotNull, sql, asc, or, inArray, lt, gte, count, ilike } from "drizzle-orm";

// Some legacy podcast rows store the cover image as an inline base-64
// `data:` URI (≈2 MB each) instead of an object-storage URL. Shipping
// that to list endpoints bloats `/api/podcasts/mine` to ~38 MB. This
// CASE expression strips those inline URIs at the SQL layer so they
// never leave Postgres for list responses. Detail endpoints
// (`getPodcast`, `getPublicPodcastById`) keep selecting the raw column
// and still return the full URI for the rare consumers that need it
// (RSS feed, share embed, edit modal).
const slimCoverImageUrl = sql<string | null>`CASE WHEN ${generatedPodcasts.coverImageUrl} LIKE 'data:%' THEN NULL ELSE ${generatedPodcasts.coverImageUrl} END`.as('cover_image_url');

// JS-side fallback for endpoints that select all columns. Same intent
// as `slimCoverImageUrl` but applied after the row reaches Node — used
// where rewriting the projection would be invasive (e.g. JOINs that
// spread `generatedPodcasts.*`). Keep the per-row payload bounded.
function stripDataUriCover<T extends { coverImageUrl?: string | null }>(p: T): T {
  if (p && typeof p.coverImageUrl === 'string' && p.coverImageUrl.startsWith('data:')) {
    return { ...p, coverImageUrl: null };
  }
  return p;
}

const podcastCardColumns = {
  id: generatedPodcasts.id,
  topic: generatedPodcasts.topic,
  title: generatedPodcasts.title,
  audioUrl: generatedPodcasts.audioUrl,
  coverImageUrl: slimCoverImageUrl,
  duration: generatedPodcasts.duration,
  timestamp: generatedPodcasts.timestamp,
  isFavorite: generatedPodcasts.isFavorite,
  tags: generatedPodcasts.tags,
  userId: generatedPodcasts.userId,
  isPublic: generatedPodcasts.isPublic,
  templateCategory: generatedPodcasts.templateCategory,
  plays: generatedPodcasts.plays,
  engagementScore: generatedPodcasts.engagementScore,
  guestSessionId: generatedPodcasts.guestSessionId,
};

const podcastMineColumns = {
  ...podcastCardColumns,
  // description is needed by the voice-search scorer in routes.ts so
  // partial-phrase queries can be ranked against episode descriptions,
  // not just titles/topics.
  description: generatedPodcasts.description,
  // Slim payload (Task #102): the full `generation_params` JSON is too
  // heavy for list endpoints — it can be 5-10 KB per row once expanded.
  // The only field tile rendering actually needs is `numPeople` (used
  // for the "Solo / N hosts" summary line), so we project just that as
  // a top-level scalar. The legacy `generationParams` field is omitted
  // and the "Brew again" handler in client tile components lazily
  // fetches the full row via `GET /api/podcasts/:id` on click.
  // Safety: guard the `::int` cast with a regex check so any historical
  // row whose `numPeople` value is non-numeric doesn't blow up the
  // entire list query at the DB layer.
  _numPeople: sql<number | null>`case
    when (${generatedPodcasts.generationParams}->>'numPeople') ~ '^-?[0-9]+$'
    then ((${generatedPodcasts.generationParams}->>'numPeople')::int)
    else null
  end`.as('_num_people'),
  isTrial: generatedPodcasts.isTrial,
  voiceQuality: generatedPodcasts.voiceQuality,
};

export interface IStorage {
  // User operations for Replit Auth
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  
  // Voice favorites operations
  listVoiceFavorites(userId: string, guestId?: string): Promise<VoiceFavorite[]>;
  addVoiceFavorite(userId: string, voiceId: string, guestId?: string): Promise<VoiceFavorite>;
  removeVoiceFavorite(userId: string, voiceId: string, guestId?: string): Promise<boolean>;
  
  // Podcast operations
  createGeneratedPodcast(podcast: InsertGeneratedPodcast): Promise<GeneratedPodcast>;
  getAllGeneratedPodcasts(): Promise<GeneratedPodcast[]>;
  getPublicPodcasts(): Promise<GeneratedPodcast[]>;
  getPublicPodcastsSorted(limit?: number, offset?: number, sortBy?: string, filterByTemplate?: string): Promise<EnrichedPodcast[]>;
  getPublicPodcastCount(filterByTemplate?: string): Promise<number>;
  getPublicPodcastById(id: string): Promise<GeneratedPodcast | undefined>;
  getPodcast(id: string): Promise<GeneratedPodcast | undefined>;
  getMyPodcasts(userId: string, limit?: number, offset?: number): Promise<GeneratedPodcast[]>;
  getMyPodcastsCount(userId: string): Promise<number>;
  searchMyPodcasts(userId: string, params: { query?: string; sinceMs?: number; untilMs?: number; moods?: string[]; voiceIds?: string[]; limit?: number }): Promise<GeneratedPodcast[]>;
  getMyFavorites(userId: string): Promise<GeneratedPodcast[]>;
  getContinueListening(userId: string, limit?: number): Promise<(GeneratedPodcast & { _progress?: { positionSeconds: number; durationSeconds: number; percent: number } })[]>;
  getRecommended(userId: string, limit?: number): Promise<GeneratedPodcast[]>;

  // Playback progress - resume-from-position support
  upsertPlaybackProgress(userId: string, podcastId: string, positionSeconds: number, durationSeconds: number): Promise<PlaybackProgress>;
  getPlaybackProgress(userId: string, podcastId: string): Promise<PlaybackProgress | undefined>;
  updatePodcastFavorite(id: string, isFavorite: boolean): Promise<GeneratedPodcast | undefined>;
  updatePodcastTags(id: string, tags: string[]): Promise<GeneratedPodcast | undefined>;
  togglePodcastVisibility(id: string, userId: string): Promise<GeneratedPodcast | undefined>;
  incrementPlayCount(id: string): Promise<GeneratedPodcast | undefined>;
  deletePodcast(id: string): Promise<boolean>;
  deleteOldPodcasts(userId: string, daysOld?: number): Promise<number>;
  
  // Playlist operations
  createPlaylist(playlist: InsertPlaylist): Promise<Playlist>;
  getPlaylistsByUser(userId: string): Promise<Playlist[]>;
  getPlaylistById(id: string): Promise<Playlist | undefined>;
  getPlaylistWithItems(id: string): Promise<PlaylistWithItems | undefined>;
  updatePlaylist(id: string, userId: string, data: Partial<InsertPlaylist>): Promise<Playlist | undefined>;
  deletePlaylist(id: string, userId: string): Promise<boolean>;
  addToPlaylist(playlistId: string, podcastId: string): Promise<PlaylistItem>;
  removeFromPlaylist(playlistId: string, podcastId: string): Promise<boolean>;
  reorderPlaylistItems(playlistId: string, itemPositions: { podcastId: string; position: number }[]): Promise<boolean>;
  getPlaylistsContainingPodcast(podcastId: string, userId: string): Promise<string[]>;
  
  // Social features - Reactions
  togglePodcastReaction(podcastId: string, userId: string | null, reactionType: ReactionType, guestId?: string): Promise<{ reaction: PodcastLike | null; engagement: PodcastEngagement }>;
  togglePodcastLike(podcastId: string, userId: string | null, value: 1 | -1, guestId?: string): Promise<{ like: PodcastLike | null; engagement: PodcastEngagement }>; // Legacy
  getPodcastLikesByUser(userId: string): Promise<PodcastLike[]>;
  getUserLikeForPodcast(podcastId: string, userId: string | null, guestId?: string): Promise<PodcastLike | undefined>;
  
  // Social features - Comments
  createComment(comment: InsertComment): Promise<Comment>;
  getCommentsByPodcast(podcastId: string, userId?: string | null, sort?: 'best' | 'new', guestId?: string): Promise<CommentWithUser[]>;
  getCommentById(id: string): Promise<Comment | undefined>;
  updateComment(id: string, userId: string, body: string): Promise<Comment | undefined>;
  deleteComment(id: string, userId: string): Promise<boolean>;
  pinComment(id: string, podcastOwnerId: string): Promise<Comment | undefined>;
  
  // Social features - Comment Votes
  toggleCommentVote(commentId: string, userId: string | null, value: 1 | -1, guestId?: string): Promise<CommentVote | null>;
  getUserVotesForComments(commentIds: string[], userId: string | null, guestId?: string): Promise<Map<string, number>>;
  
  // Social features - Engagement
  getOrCreateEngagement(podcastId: string): Promise<PodcastEngagement>;
  updateEngagementScore(podcastId: string): Promise<PodcastEngagement>;
  getTrendingPodcasts(limit?: number, timeframe?: 'hour' | 'day' | 'week'): Promise<PodcastWithEngagement[]>;
  
  // Batch operations for performance optimization
  getBatchEngagement(podcastIds: string[]): Promise<Map<string, PodcastEngagement>>;
  getBatchUserLikes(podcastIds: string[], userId: string | null, guestId?: string): Promise<Map<string, PodcastLike>>;
  getBatchTopComments(podcastIds: string[]): Promise<Map<string, { id: string; body: string; user: { firstName: string | null; lastName: string | null; profileImageUrl: string | null }; upvotes: number } | null>>;
  
  // Social features - Shares
  recordShare(podcastId: string, userId?: string, platform?: string): Promise<ShareEvent>;
  
  // Favorite Topics - Daily Personalized News
  listFavoriteTopics(userId: string | null, guestId?: string): Promise<FavoriteTopic[]>;
  addFavoriteTopic(topic: { userId: string | null; guestId?: string; label: string; category?: string; position?: number }): Promise<FavoriteTopic>;
  removeFavoriteTopic(id: string, userId: string | null, guestId?: string): Promise<boolean>;
  updateFavoriteTopicPositions(userId: string | null, positions: { id: string; position: number }[], guestId?: string): Promise<boolean>;
  
  // News Presets - Format, Style, Voice settings
  getNewsPreset(userId: string | null, guestId?: string): Promise<NewsPreset | undefined>;
  createNewsPreset(preset: InsertNewsPreset & { guestId?: string }): Promise<NewsPreset>;
  updateNewsPreset(userId: string | null, data: Partial<InsertNewsPreset>, guestId?: string): Promise<NewsPreset | undefined>;
  deleteNewsPreset(userId: string | null, guestId?: string): Promise<boolean>;
  
  // Auto-generation scheduling
  getAutoGeneratePresets(): Promise<NewsPreset[]>;
  updateAutoGenerateStatus(presetId: string, status: string, error?: string): Promise<void>;
  
  // TeachMe Presets - Daily Micro-Learning scheduling
  getTeachmePreset(userId: string | null, guestId?: string): Promise<TeachmePreset | undefined>;
  getTeachmePresets(userId: string | null, guestId?: string): Promise<TeachmePreset[]>;
  createTeachmePreset(preset: (InsertTeachmePreset & { syllabus: SyllabusEpisode[]; guestId?: string })): Promise<TeachmePreset>;
  updateTeachmePreset(presetId: string, userId: string | null, data: Partial<InsertTeachmePreset & { syllabus?: SyllabusEpisode[]; currentEpisode?: number; playlistId?: string }>, guestId?: string): Promise<TeachmePreset | undefined>;
  deleteTeachmePreset(presetId: string, userId: string | null, guestId?: string): Promise<boolean>;
  getAutoGenerateTeachmePresets(): Promise<TeachmePreset[]>;
  updateTeachmeAutoGenerateStatus(presetId: string, status: string, error?: string): Promise<void>;
  markTeachmeEpisodeGenerated(presetId: string, episodeNumber: number, podcastId: string): Promise<TeachmePreset | undefined>;
  
  // Cleanup job methods
  getNewsPodcastsForCleanup(daysOld: number): Promise<GeneratedPodcast[]>;
  getLowEngagementPodcastsForCleanup(daysOld: number, minPlays: number): Promise<GeneratedPodcast[]>;
  
  // Podcast metadata editing
  updatePodcastMetadata(id: string, userId: string, data: { title?: string; description?: string }): Promise<GeneratedPodcast | undefined>;
  
  // Podcast Shows (RSS Distribution)
  createPodcastShow(show: InsertPodcastShow): Promise<PodcastShow>;
  getPodcastShowsByUser(userId: string): Promise<PodcastShow[]>;
  getPodcastShowById(id: string): Promise<PodcastShow | undefined>;
  updatePodcastShow(id: string, userId: string, data: Partial<InsertPodcastShow>): Promise<PodcastShow | undefined>;
  deletePodcastShow(id: string, userId: string): Promise<boolean>;
  
  // Show Episodes
  addEpisodeToShow(showId: string, podcastId: string, episodeNumber?: number, seasonNumber?: number): Promise<ShowEpisode>;
  removeEpisodeFromShow(showId: string, podcastId: string): Promise<boolean>;
  getShowEpisodes(showId: string): Promise<(ShowEpisode & { podcast: GeneratedPodcast })[]>;
  reorderShowEpisodes(showId: string, items: { podcastId: string; position: number }[]): Promise<boolean>;
  
  // Generation Metrics - Telemetry
  recordGenerationMetric(metric: Omit<GenerationMetricRecord, 'id'>): Promise<GenerationMetricRecord>;
  getRecentGenerationMetrics(limit?: number): Promise<GenerationMetricRecord[]>;
  getGenerationStatsSummary(): Promise<GenerationStatsSummary>;
}

// Database diagnostics - runs on module load
async function runDatabaseDiagnostics() {
  const startTime = Date.now();
  try {
    // Mask database URL for logging - only show provider (neon/supabase/etc)
    const dbUrl = process.env.DATABASE_URL || '';
    let dbProvider = 'unknown';
    if (dbUrl.includes('neon.tech')) dbProvider = 'neon';
    else if (dbUrl.includes('supabase')) dbProvider = 'supabase';
    else if (dbUrl.includes('railway')) dbProvider = 'railway';
    else if (dbUrl.includes('localhost')) dbProvider = 'localhost';
    
    // Run heartbeat query
    const result = await db
      .select({ 
        total: sql<number>`COUNT(*)`,
        publicCount: sql<number>`SUM(CASE WHEN is_public = true THEN 1 ELSE 0 END)`,
        privateCount: sql<number>`SUM(CASE WHEN is_public = false THEN 1 ELSE 0 END)`
      })
      .from(generatedPodcasts);
    
    const stats = result[0];
    const elapsed = Date.now() - startTime;
    
    console.log(`[StorageInit] ✅ Database connected successfully`);
    console.log(`[StorageInit] Environment: NODE_ENV=${process.env.NODE_ENV || 'undefined'}`);
    console.log(`[StorageInit] DB Provider: ${dbProvider}`);
    console.log(`[StorageInit] Podcast stats: total=${stats.total}, public=${stats.publicCount}, private=${stats.privateCount}`);
    console.log(`[StorageInit] Query time: ${elapsed}ms`);
    
    if (stats.publicCount === 0) {
      console.warn(`[StorageInit] ⚠️ WARNING: No public podcasts found! Trending/Explore will be empty.`);
    }
  } catch (error) {
    console.error(`[StorageInit] ❌ Database connection FAILED:`, error);
  }
}

// Run diagnostics on module load (non-blocking)
runDatabaseDiagnostics().catch(console.error);

// ============================================================
// STARTUP MIGRATIONS: Safe, idempotent schema additions
// Adds any missing columns that were introduced after initial deploy.
// Each statement uses IF NOT EXISTS to be fully safe to re-run.
// ============================================================
async function runStartupMigrations() {
  try {
    await db.execute(sql`
      ALTER TABLE generated_podcasts
        ADD COLUMN IF NOT EXISTS client_job_id VARCHAR
    `);
    // Unique partial index — only indexes non-null values, safe for existing NULL rows
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS generated_podcasts_client_job_id_unique
        ON generated_podcasts (client_job_id)
        WHERE client_job_id IS NOT NULL
    `);
    // Research failure flag — safe to add with a default so existing rows are unaffected
    await db.execute(sql`
      ALTER TABLE generated_podcasts
        ADD COLUMN IF NOT EXISTS research_failed BOOLEAN NOT NULL DEFAULT false
    `);
    console.log('[StartupMigration] ✅ client_job_id, research_failed columns and unique index ensured on generated_podcasts');
  } catch (error: any) {
    console.error('[StartupMigration] ❌ Failed to run startup migrations:', error.message);
  }

  // Guest identity migrations — allow guest-owned presets and voice favorites
  try {
    // Add guest_id column to news_presets and make user_id nullable
    await db.execute(sql`ALTER TABLE news_presets ADD COLUMN IF NOT EXISTS guest_id VARCHAR`);
    await db.execute(sql`ALTER TABLE news_presets ALTER COLUMN user_id DROP NOT NULL`);
    // Add guest_id column to teachme_presets and make user_id nullable
    await db.execute(sql`ALTER TABLE teachme_presets ADD COLUMN IF NOT EXISTS guest_id VARCHAR`);
    await db.execute(sql`ALTER TABLE teachme_presets ALTER COLUMN user_id DROP NOT NULL`);
    // Create guest voice favorites table (separate from user voice_favorites to avoid PK conflict)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS guest_voice_favorites (
        guest_id VARCHAR NOT NULL,
        voice_id VARCHAR NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        PRIMARY KEY (guest_id, voice_id)
      )
    `);
    // Add guest_id column to favorite_topics and make user_id nullable
    await db.execute(sql`ALTER TABLE favorite_topics ADD COLUMN IF NOT EXISTS guest_id VARCHAR`);
    await db.execute(sql`ALTER TABLE favorite_topics ALTER COLUMN user_id DROP NOT NULL`);
    console.log('[StartupMigration] ✅ Guest identity columns and guest_voice_favorites table ensured');
  } catch (error: any) {
    console.error('[StartupMigration] ❌ Failed to run guest identity migrations:', error.message);
  }

  // Fix orphaned `value` column on podcast_likes — the column predates the
  // reaction_type migration and is NOT NULL with no default, causing every
  // new like/dislike INSERT to fail with a constraint violation.
  try {
    // Only older databases have this column; skip cleanly on fresh ones.
    await db.execute(sql`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'podcast_likes' AND column_name = 'value'
        ) THEN
          ALTER TABLE podcast_likes ALTER COLUMN value SET DEFAULT 0;
        END IF;
      END $$
    `);
    console.log('[StartupMigration] ✅ podcast_likes.value column default patched');
  } catch (error: any) {
    console.error('[StartupMigration] ❌ Failed to patch podcast_likes.value default:', error.message);
  }
}

runStartupMigrations().catch(console.error);

// ============================================================
// SELF-HEAL: Re-run the inline-cover migration on every boot.
// Each Replit checkpoint restore reverts the 36 legacy podcast rows
// back to inline `data:image/...;base64,...` cover URIs, which the
// list-endpoint safety filter (`slimCoverImageUrl`) then drops, so
// every Library / Discover tile silently falls back to the
// placeholder waveform until someone notices and re-runs the
// migration script. The migration is fully idempotent — on a clean
// DB it logs one line and returns in milliseconds — so it is safe
// to run on every server boot. Failures are logged but never crash
// the server.
// ============================================================
async function runInlineCoverSelfHeal() {
  try {
    // Lazy import to avoid pulling object-storage init into the
    // module's top-level evaluation path. Also prevents a circular
    // import: the script imports `./db` which storage.ts already owns.
    //
    // Safe to import: this module is the PURE library half of the
    // migration tool — it has no `process.exit` calls and no
    // top-level side effects. The CLI wrapper (with its exit-code
    // handling) lives in `scripts/migrate-cover-images-cli.ts` and
    // is never imported here, so esbuild can't accidentally drag
    // exit logic into the production server bundle.
    const { migrateInlineCoverImages } = await import(
      "../scripts/migrate-cover-images-to-storage"
    );
    const result = await migrateInlineCoverImages();
    if (result.total === 0) {
      // Already logged a clean "Nothing to do." line inside the
      // migration helper — no need to add noise here.
      return;
    }
    if (result.failed > 0) {
      console.error(
        `[InlineCoverSelfHeal] ⚠️ Completed with ${result.failed} failure(s); ${result.remaining} row(s) still inline.`,
      );
    } else {
      console.log(
        `[InlineCoverSelfHeal] ✅ Healed ${result.migrated} inline cover row(s) (skipped ${result.skipped}, remaining ${result.remaining}).`,
      );
    }
  } catch (error: any) {
    console.error(
      "[InlineCoverSelfHeal] ❌ Failed to run inline-cover self-heal:",
      error?.message ?? error,
    );
  }
}

runInlineCoverSelfHeal().catch((err) =>
  console.error("[InlineCoverSelfHeal] ❌ Unexpected error:", err),
);

export class DatabaseStorage implements IStorage {
  // User operations for Replit Auth
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values({
        ...userData,
        credits: 30,
        subscriptionPlan: 'free',
        subscriptionStatus: 'active',
        onboardingCompleted: false,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          email: userData.email,
          firstName: userData.firstName,
          lastName: userData.lastName,
          profileImageUrl: userData.profileImageUrl,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  // Voice favorites operations
  async listVoiceFavorites(userId: string, guestId?: string): Promise<VoiceFavorite[]> {
    if (guestId && !userId) {
      // Query typed guestVoiceFavorites table; shape rows to match VoiceFavorite
      const rows = await db
        .select()
        .from(guestVoiceFavorites)
        .where(eq(guestVoiceFavorites.guestId, guestId))
        .orderBy(desc(guestVoiceFavorites.createdAt));
      return rows.map(r => ({ userId: r.guestId, voiceId: r.voiceId, createdAt: r.createdAt }));
    }
    return await db
      .select()
      .from(voiceFavorites)
      .where(eq(voiceFavorites.userId, userId))
      .orderBy(desc(voiceFavorites.createdAt));
  }

  async addVoiceFavorite(userId: string, voiceId: string, guestId?: string): Promise<VoiceFavorite> {
    if (guestId && !userId) {
      const [inserted] = await db
        .insert(guestVoiceFavorites)
        .values({ guestId, voiceId })
        .onConflictDoNothing()
        .returning();
      const row = inserted ?? await db
        .select()
        .from(guestVoiceFavorites)
        .where(and(eq(guestVoiceFavorites.guestId, guestId), eq(guestVoiceFavorites.voiceId, voiceId)))
        .limit(1)
        .then(r => r[0]);
      return { userId: row.guestId, voiceId: row.voiceId, createdAt: row.createdAt };
    }
    const [favorite] = await db
      .insert(voiceFavorites)
      .values({ userId, voiceId })
      .onConflictDoNothing()
      .returning();
    
    // If conflict (duplicate), fetch the existing record
    if (!favorite) {
      const [existing] = await db
        .select()
        .from(voiceFavorites)
        .where(
          and(
            eq(voiceFavorites.userId, userId),
            eq(voiceFavorites.voiceId, voiceId)
          )
        )
        .limit(1);
      return existing;
    }
    
    return favorite;
  }

  async removeVoiceFavorite(userId: string, voiceId: string, guestId?: string): Promise<boolean> {
    if (guestId && !userId) {
      const result = await db
        .delete(guestVoiceFavorites)
        .where(and(eq(guestVoiceFavorites.guestId, guestId), eq(guestVoiceFavorites.voiceId, voiceId)));
      return result.rowCount !== null && result.rowCount > 0;
    }
    const result = await db
      .delete(voiceFavorites)
      .where(
        and(
          eq(voiceFavorites.userId, userId),
          eq(voiceFavorites.voiceId, voiceId)
        )
      );
    return result.rowCount !== null && result.rowCount > 0;
  }

  // Podcast operations
  async createGeneratedPodcast(insertPodcast: InsertGeneratedPodcast): Promise<GeneratedPodcast> {
    const [podcast] = await db
      .insert(generatedPodcasts)
      .values(insertPodcast)
      .returning();
    return podcast;
  }

  async getAllGeneratedPodcasts(): Promise<GeneratedPodcast[]> {
    const rows = await db
      .select()
      .from(generatedPodcasts)
      .orderBy(desc(generatedPodcasts.timestamp));
    return rows.map(stripDataUriCover);
  }

  async getPublicPodcasts(): Promise<GeneratedPodcast[]> {
    const rows = await db
      .select()
      .from(generatedPodcasts)
      .where(eq(generatedPodcasts.isPublic, true))
      .orderBy(desc(generatedPodcasts.timestamp));
    return rows.map(stripDataUriCover);
  }

  async getPublicPodcastsSorted(
    limit: number = 20, 
    offset: number = 0, 
    sortBy: string = 'listens',
    filterByTemplate?: string
  ): Promise<EnrichedPodcast[]> {
    const startTime = Date.now();
    console.log(`[Storage] getPublicPodcastsSorted: limit=${limit}, offset=${offset}, sortBy=${sortBy}, filter=${filterByTemplate}, env=${process.env.NODE_ENV || 'undefined'}`);
    
    try {
      // Build where conditions
      const conditions = [eq(generatedPodcasts.isPublic, true)];
      
      // Add template filter if provided
      if (filterByTemplate && filterByTemplate !== 'all') {
        conditions.push(eq(generatedPodcasts.templateCategory, filterByTemplate));
      }
      
      const whereCondition = and(...conditions);

      // Base query: podcast metadata + engagement row inlined via LEFT JOIN.
      // A single DB round-trip covers both — no second getBatchEngagement call needed.
      const buildBaseQuery = (extraCondition?: SQL) =>
        db
          .select({ podcast: podcastCardColumns, engagementRow: podcastEngagement })
          .from(generatedPodcasts)
          .leftJoin(podcastEngagement, eq(generatedPodcasts.id, podcastEngagement.podcastId))
          .where(extraCondition ? and(whereCondition, extraCondition) : whereCondition);

      const baseQuery = buildBaseQuery();

      // Trending hot score: plays / (hours_since_creation + 2)^1.2.
      // The expression cannot be indexed, so without a prefilter Postgres has
      // to score every public row on each request. Heavy time decay (gravity
      // 1.2) means anything older than ~90 days contributes essentially zero,
      // so we restrict the candidate set to a recent window. The existing
      // (is_public, timestamp DESC) index turns what was a full-table scan
      // into a quick range scan and keeps the query fast at large library
      // sizes.
      const hotScoreSql = sql`(${generatedPodcasts.plays} + 1)::float / POWER(
        (EXTRACT(EPOCH FROM (NOW() - ${generatedPodcasts.timestamp})) / 3600.0 + 2.0)::float,
        1.2
      )`;
      const withinDaysCondition = (days: number) =>
        sql`${generatedPodcasts.timestamp} >= NOW() - (${days} || ' days')::interval`;
      // If recent windows don't fill the page we expand step-by-step rather
      // than ever scoring the full table on a hot path. All-time fallback is
      // only allowed when the candidate set is small enough that a full scan
      // is itself cheap (well under the 200ms target).
      const TRENDING_WINDOWS_DAYS = [90, 365];
      const ALL_TIME_FALLBACK_MAX_ROWS = 2000;

      // Apply the requested sort order. TypeScript infers `rows` from the select shape,
      // so r.podcast.id / r.engagementRow are fully typed with no casts needed.
      const rows = await (async () => {
        switch (sortBy) {
          case 'newest':
          case 'date':
            return baseQuery.orderBy(desc(generatedPodcasts.timestamp)).limit(limit).offset(offset);
          case 'popular':
            return baseQuery.orderBy(desc(generatedPodcasts.plays), desc(generatedPodcasts.timestamp)).limit(limit).offset(offset);
          case 'trending': {
            // Try each recency window in order. As soon as a window fills the
            // requested page we stop — that's the common case and is bounded
            // by the (is_public, timestamp DESC) index range scan.
            let lastRows: Awaited<ReturnType<typeof buildBaseQuery>> = [];
            for (const days of TRENDING_WINDOWS_DAYS) {
              lastRows = await buildBaseQuery(withinDaysCondition(days))
                .orderBy(desc(hotScoreSql), desc(generatedPodcasts.timestamp))
                .limit(limit)
                .offset(offset);
              if (lastRows.length >= limit) {
                return lastRows;
              }
            }

            // Page still not full after the widest window. Only do an
            // unbounded all-time scan if the candidate set is provably small
            // enough that a full scan is cheap. On large libraries we
            // intentionally return the (possibly short) windowed result
            // rather than spend hundreds of ms re-scoring every public row —
            // a podcast with no activity in the last year isn't trending.
            const [{ total }] = await db
              .select({ total: count() })
              .from(generatedPodcasts)
              .where(whereCondition);
            if (total <= ALL_TIME_FALLBACK_MAX_ROWS) {
              return baseQuery
                .orderBy(desc(hotScoreSql), desc(generatedPodcasts.timestamp))
                .limit(limit)
                .offset(offset);
            }
            return lastRows;
          }
          case 'duration':
            return baseQuery.orderBy(
              desc(
                sql`(
                  CASE
                    WHEN array_length(string_to_array(${generatedPodcasts.duration}, ':'), 1) >= 3 THEN
                      COALESCE(CAST(NULLIF(regexp_replace(SPLIT_PART(${generatedPodcasts.duration}, ':', 1), '[^0-9]', '', 'g'), '') AS INTEGER), 0) * 3600 +
                      COALESCE(CAST(NULLIF(regexp_replace(SPLIT_PART(${generatedPodcasts.duration}, ':', 2), '[^0-9]', '', 'g'), '') AS INTEGER), 0) * 60 +
                      COALESCE(CAST(NULLIF(regexp_replace(SPLIT_PART(${generatedPodcasts.duration}, ':', 3), '[^0-9]', '', 'g'), '') AS INTEGER), 0)
                    WHEN array_length(string_to_array(${generatedPodcasts.duration}, ':'), 1) = 2 THEN
                      COALESCE(CAST(NULLIF(regexp_replace(SPLIT_PART(${generatedPodcasts.duration}, ':', 1), '[^0-9]', '', 'g'), '') AS INTEGER), 0) * 60 +
                      COALESCE(CAST(NULLIF(regexp_replace(SPLIT_PART(${generatedPodcasts.duration}, ':', 2), '[^0-9]', '', 'g'), '') AS INTEGER), 0)
                    ELSE
                      COALESCE(CAST(NULLIF(regexp_replace(${generatedPodcasts.duration}, '[^0-9]', '', 'g'), '') AS INTEGER), 0)
                  END
                )`
              ),
              desc(generatedPodcasts.timestamp)
            ).limit(limit).offset(offset);
          case 'listens':
          default:
            return baseQuery.orderBy(desc(generatedPodcasts.plays), desc(generatedPodcasts.timestamp)).limit(limit).offset(offset);
        }
      })();
    
      const elapsed = Date.now() - startTime;
      console.log(`[Storage] getPublicPodcastsSorted found ${rows.length} podcasts in ${elapsed}ms`);
      
      // Enhanced logging for debugging production issues
      if (rows.length === 0) {
        console.warn(`[Storage] ⚠️ getPublicPodcastsSorted returned ZERO results! Running diagnostic...`);
        const countResult = await db
          .select({ 
            total: sql<number>`COUNT(*)`,
            publicCount: sql<number>`SUM(CASE WHEN is_public = true THEN 1 ELSE 0 END)`
          })
          .from(generatedPodcasts);
        console.warn(`[Storage] Diagnostic: total=${countResult[0]?.total}, public=${countResult[0]?.publicCount}`);
        if (filterByTemplate && filterByTemplate !== 'all') {
          const templateCount = await db
            .select({ count: sql<number>`COUNT(*)` })
            .from(generatedPodcasts)
            .where(and(eq(generatedPodcasts.isPublic, true), eq(generatedPodcasts.templateCategory, filterByTemplate)));
          console.warn(`[Storage] Diagnostic: publicWithTemplate(${filterByTemplate})=${templateCount[0]?.count}`);
        }
      } else {
        // r.podcast.id is typed as string by Drizzle — no cast required
        const sampleIds = rows.slice(0, 3).map(r => r.podcast.id.substring(0, 8));
        console.log(`[Storage] getPublicPodcastsSorted sample IDs: [${sampleIds.join(', ')}...]`);
      }
      
      // Map shaped results → EnrichedPodcast with _engagement from the LEFT JOIN.
      // r.podcast is the Drizzle-inferred subset of GeneratedPodcast fields; the
      // `as unknown as GeneratedPodcast` cast documents that intent without using `any`.
      return rows.map(r => ({
        ...(r.podcast as unknown as GeneratedPodcast),
        _engagement: r.engagementRow || null,
      }));
    } catch (error: any) {
      console.error('[Storage] ❌ getPublicPodcastsSorted ERROR:', error.message);
      console.error('[Storage] Stack:', error.stack);
      throw error;
    }
  }

  async getPublicPodcastCount(filterByTemplate?: string): Promise<number> {
    const conditions = [eq(generatedPodcasts.isPublic, true)];
    if (filterByTemplate && filterByTemplate !== 'all') {
      conditions.push(eq(generatedPodcasts.templateCategory, filterByTemplate));
    }
    const [result] = await db
      .select({ total: count() })
      .from(generatedPodcasts)
      .where(and(...conditions));
    return result?.total ?? 0;
  }

  async getPublicPodcastById(id: string): Promise<GeneratedPodcast | undefined> {
    const [podcast] = await db
      .select()
      .from(generatedPodcasts)
      .where(
        and(
          eq(generatedPodcasts.id, id),
          eq(generatedPodcasts.isPublic, true)
        )
      )
      .limit(1);
    return podcast;
  }

  async getPodcast(id: string): Promise<GeneratedPodcast | undefined> {
    const [podcast] = await db
      .select()
      .from(generatedPodcasts)
      .where(eq(generatedPodcasts.id, id))
      .limit(1);
    return podcast;
  }

  async getMyPodcasts(userId: string, limit = 20, offset = 0): Promise<GeneratedPodcast[]> {
    const startTime = Date.now();
    console.log(`[Storage] getMyPodcasts: userId=${userId?.substring(0, 8)}..., limit=${limit}, offset=${offset}`);
    
    const result = await db
      .select(podcastMineColumns)
      .from(generatedPodcasts)
      .where(eq(generatedPodcasts.userId, userId))
      .orderBy(desc(generatedPodcasts.timestamp))
      .limit(limit)
      .offset(offset);
    
    const elapsed = Date.now() - startTime;
    console.log(`[Storage] getMyPodcasts found ${result.length} podcasts (offset=${offset}) in ${elapsed}ms`);

    // Cast: the slim projection drops `generationParams` and adds
    // `_numPeople`. Frontend tile components have been updated to read
    // `_numPeople` first and lazily fetch the full row when they need
    // the rest (see `client/src/lib/regenerate.ts`).
    return result as unknown as GeneratedPodcast[];
  }

  async getMyPodcastsCount(userId: string): Promise<number> {
    const [result] = await db
      .select({ total: count() })
      .from(generatedPodcasts)
      .where(eq(generatedPodcasts.userId, userId));
    return Number(result?.total ?? 0);
  }

  async searchMyPodcasts(
    userId: string,
    params: {
      query?: string;
      sinceMs?: number;
      untilMs?: number;
      moods?: string[];
      voiceIds?: string[];
      limit?: number;
    }
  ): Promise<GeneratedPodcast[]> {
    // Cap candidates at 500 — at this size the JS scoring loop is still fast,
    // and the SQL ilike + recency + mood + voice predicates have already
    // pre-filtered across the user's full library.
    const hasFilter =
      !!(params.query && params.query.trim()) ||
      !!params.sinceMs ||
      !!params.untilMs ||
      (params.moods && params.moods.length > 0) ||
      (params.voiceIds && params.voiceIds.length > 0);
    const requested = params.limit ?? (hasFilter ? 500 : 50);
    const limit = Math.min(Math.max(requested, 1), 500);
    const startTime = Date.now();

    const conditions: Array<SQL | undefined> = [
      eq(generatedPodcasts.userId, userId),
    ];

    if (params.sinceMs && params.sinceMs > 0) {
      conditions.push(gte(generatedPodcasts.timestamp, new Date(params.sinceMs)));
    }
    if (params.untilMs && params.untilMs > 0) {
      conditions.push(lt(generatedPodcasts.timestamp, new Date(params.untilMs)));
    }

    const tokens = (params.query || "")
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.replace(/[^a-z0-9'-]+/g, ""))
      .filter((t) => t.length > 1);

    if (tokens.length > 0) {
      const tokenClauses = tokens.map((t) => {
        const pattern = `%${t}%`;
        return or(
          ilike(generatedPodcasts.title, pattern),
          ilike(generatedPodcasts.topic, pattern),
          ilike(generatedPodcasts.description, pattern)
        );
      });
      conditions.push(or(...tokenClauses));
    }

    if (params.moods && params.moods.length > 0) {
      // generation_params is jsonb; ->> 'podcastMood' returns text. Match
      // case-insensitively against any of the requested moods.
      const moodClauses = params.moods.map(
        (m): SQL =>
          sql`lower(${generatedPodcasts.generationParams}->>'podcastMood') = ${m.toLowerCase()}`
      );
      conditions.push(or(...moodClauses));
    }

    if (params.voiceIds && params.voiceIds.length > 0) {
      // generation_params jsonb fields like selectedVoiceIds, assignedVoices,
      // hostVoices, selectedVoicePool may all carry arrays of voice IDs. We
      // accept a match in any of them.
      const voiceClauses = params.voiceIds.map((vid): SQL => {
        const literal = JSON.stringify(vid);
        return sql`(
          (${generatedPodcasts.generationParams}->'selectedVoiceIds') @> ${literal}::jsonb
          OR (${generatedPodcasts.generationParams}->'assignedVoices') @> ${literal}::jsonb
          OR (${generatedPodcasts.generationParams}->'hostVoices') @> ${literal}::jsonb
          OR (${generatedPodcasts.generationParams}->'selectedVoicePool') @> ${literal}::jsonb
        )`;
      });
      conditions.push(or(...voiceClauses));
    }

    // Voice search (`/api/podcasts/search-mine`) scores candidates against
    // mood / speaker corpora that live inside `generation_params` — so
    // unlike `getMyPodcasts` we deliberately keep the full row here. The
    // candidate set is capped at 500 (and gated by user voice command
    // intent), so payload size is not a concern.
    const result = await db
      .select()
      .from(generatedPodcasts)
      .where(and(...conditions))
      .orderBy(desc(generatedPodcasts.timestamp))
      .limit(limit);

    const elapsed = Date.now() - startTime;
    console.log(
      `[Storage] searchMyPodcasts found ${result.length} podcasts (tokens=${tokens.length}, since=${params.sinceMs ?? 0}, until=${params.untilMs ?? 0}, moods=${params.moods?.length ?? 0}, voices=${params.voiceIds?.length ?? 0}) in ${elapsed}ms`
    );

    return result;
  }

  async getMyFavorites(userId: string): Promise<GeneratedPodcast[]> {
    const rows = await db
      .select()
      .from(generatedPodcasts)
      .where(
        and(
          eq(generatedPodcasts.isFavorite, true),
          eq(generatedPodcasts.userId, userId)
        )
      )
      .orderBy(desc(generatedPodcasts.timestamp));
    return rows.map(stripDataUriCover);
  }

  async getContinueListening(
    userId: string,
    limit: number = 10
  ): Promise<(GeneratedPodcast & { _progress?: { positionSeconds: number; durationSeconds: number; percent: number } })[]> {
    // Prefer rows with real playback_progress (resume info). Fall back to
    // podcasts that have lastPlayedAt but no progress row yet (legacy data).
    // Exclude completed (>=95%) entries — those belong in "Already heard".
    const rows = await db
      .select({
        podcast: generatedPodcasts,
        position: playbackProgress.positionSeconds,
        duration: playbackProgress.durationSeconds,
        completed: playbackProgress.completed,
        progressUpdated: playbackProgress.updatedAt,
      })
      .from(generatedPodcasts)
      .leftJoin(
        playbackProgress,
        and(
          eq(playbackProgress.podcastId, generatedPodcasts.id),
          eq(playbackProgress.userId, userId)
        )
      )
      .where(
        and(
          eq(generatedPodcasts.userId, userId),
          or(
            isNotNull(playbackProgress.id),
            isNotNull(generatedPodcasts.lastPlayedAt)
          )
        )
      )
      .orderBy(
        desc(sql`COALESCE(${playbackProgress.updatedAt}, ${generatedPodcasts.lastPlayedAt})`)
      )
      .limit(limit * 2); // Over-fetch so we can filter completed without underflow

    return rows
      .filter((r) => !r.completed)
      .slice(0, limit)
      .map((r) => {
        const podcast = stripDataUriCover(r.podcast);
        if (r.position == null || r.duration == null || r.duration <= 0) {
          return podcast;
        }
        return {
          ...podcast,
          _progress: {
            positionSeconds: r.position,
            durationSeconds: r.duration,
            percent: Math.min(100, Math.round((r.position / r.duration) * 100)),
          },
        };
      });
  }

  // Playback progress: upsert resume position for (user, podcast).
  // Marks completed=true once position passes 95% of duration so the row
  // is hidden from Continue Listening.
  async upsertPlaybackProgress(
    userId: string,
    podcastId: string,
    positionSeconds: number,
    durationSeconds: number
  ): Promise<PlaybackProgress> {
    const safePos = Math.max(0, Math.floor(positionSeconds || 0));
    const safeDur = Math.max(0, Math.floor(durationSeconds || 0));
    const completed = safeDur > 0 && safePos / safeDur >= 0.95;
    const now = new Date();
    const [row] = await db
      .insert(playbackProgress)
      .values({
        userId,
        podcastId,
        positionSeconds: safePos,
        durationSeconds: safeDur,
        completed,
      })
      .onConflictDoUpdate({
        target: [playbackProgress.userId, playbackProgress.podcastId],
        set: {
          positionSeconds: safePos,
          durationSeconds: safeDur,
          completed,
          updatedAt: now,
        },
      })
      .returning();
    return row;
  }

  async getPlaybackProgress(userId: string, podcastId: string): Promise<PlaybackProgress | undefined> {
    const [row] = await db
      .select()
      .from(playbackProgress)
      .where(and(eq(playbackProgress.userId, userId), eq(playbackProgress.podcastId, podcastId)))
      .limit(1);
    return row;
  }

  async getRecommended(userId: string, limit: number = 10): Promise<GeneratedPodcast[]> {
    // Look up the user's first favorite to seed the category, but only
    // pull the column we actually need — full row would drag in a huge
    // base-64 cover for legacy rows.
    const favorites = await db
      .select({ templateCategory: generatedPodcasts.templateCategory })
      .from(generatedPodcasts)
      .where(
        and(
          eq(generatedPodcasts.isFavorite, true),
          eq(generatedPodcasts.userId, userId)
        )
      )
      .limit(1);

    if (favorites.length === 0) {
      const rows = await db
        .select()
        .from(generatedPodcasts)
        .where(eq(generatedPodcasts.isPublic, true))
        .orderBy(desc(generatedPodcasts.plays))
        .limit(limit);
      return rows.map(stripDataUriCover);
    }

    const favoriteCategory = favorites[0].templateCategory;
    const rows = await db
      .select()
      .from(generatedPodcasts)
      .where(
        and(
          eq(generatedPodcasts.isPublic, true),
          eq(generatedPodcasts.templateCategory, favoriteCategory)
        )
      )
      .orderBy(desc(generatedPodcasts.plays))
      .limit(limit);
    return rows.map(stripDataUriCover);
  }

  async updatePodcastFavorite(id: string, isFavorite: boolean): Promise<GeneratedPodcast | undefined> {
    const [podcast] = await db
      .update(generatedPodcasts)
      .set({ isFavorite })
      .where(eq(generatedPodcasts.id, id))
      .returning();
    return podcast || undefined;
  }

  async updatePodcastTags(id: string, tags: string[]): Promise<GeneratedPodcast | undefined> {
    const [podcast] = await db
      .update(generatedPodcasts)
      .set({ tags })
      .where(eq(generatedPodcasts.id, id))
      .returning();
    return podcast || undefined;
  }

  async togglePodcastVisibility(id: string, userId: string): Promise<GeneratedPodcast | undefined> {
    const podcast = await db.query.generatedPodcasts.findFirst({
      where: eq(generatedPodcasts.id, id)
    });

    if (!podcast) return undefined;
    
    if (podcast.userId && podcast.userId !== userId) {
      return undefined;
    }

    const [updated] = await db
      .update(generatedPodcasts)
      .set({ isPublic: !podcast.isPublic })
      .where(eq(generatedPodcasts.id, id))
      .returning();
    
    return updated || undefined;
  }

  async incrementPlayCount(id: string): Promise<GeneratedPodcast | undefined> {
    const [podcast] = await db
      .update(generatedPodcasts)
      .set({ 
        plays: sql`${generatedPodcasts.plays} + 1`,
        lastPlayedAt: new Date()
      })
      .where(eq(generatedPodcasts.id, id))
      .returning();
    return podcast || undefined;
  }

  async deletePodcast(id: string): Promise<boolean> {
    const podcast = await db.query.generatedPodcasts.findFirst({
      where: eq(generatedPodcasts.id, id)
    });

    if (!podcast) return false;

    await db
      .delete(generatedPodcasts)
      .where(eq(generatedPodcasts.id, id));
    
    return true;
  }

  async deleteOldPodcasts(userId: string, daysOld: number = 7): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await db
      .delete(generatedPodcasts)
      .where(
        and(
          eq(generatedPodcasts.userId, userId),
          sql`${generatedPodcasts.timestamp} < ${cutoffDate}`
        )
      )
      .returning();

    return result.length;
  }

  // Playlist operations
  async createPlaylist(playlist: InsertPlaylist): Promise<Playlist> {
    const [created] = await db
      .insert(playlists)
      .values(playlist)
      .returning();
    return created;
  }

  async getPlaylistsByUser(userId: string): Promise<Playlist[]> {
    return await db
      .select()
      .from(playlists)
      .where(eq(playlists.userId, userId))
      .orderBy(desc(playlists.updatedAt));
  }

  async getPlaylistById(id: string): Promise<Playlist | undefined> {
    const [playlist] = await db
      .select()
      .from(playlists)
      .where(eq(playlists.id, id));
    return playlist;
  }

  async getPlaylistWithItems(id: string): Promise<PlaylistWithItems | undefined> {
    const playlist = await this.getPlaylistById(id);
    if (!playlist) return undefined;

    const items = await db
      .select({
        id: playlistItems.id,
        playlistId: playlistItems.playlistId,
        podcastId: playlistItems.podcastId,
        position: playlistItems.position,
        addedAt: playlistItems.addedAt,
        podcast: generatedPodcasts,
      })
      .from(playlistItems)
      .innerJoin(generatedPodcasts, eq(playlistItems.podcastId, generatedPodcasts.id))
      .where(eq(playlistItems.playlistId, id))
      .orderBy(asc(playlistItems.position));

    const totalDurationSeconds = items.reduce((acc, item) => {
      const match = item.podcast.duration?.match(/(\d+):(\d+)/);
      if (match) {
        return acc + parseInt(match[1]) * 60 + parseInt(match[2]);
      }
      return acc;
    }, 0);
    const totalMinutes = Math.floor(totalDurationSeconds / 60);
    const totalSeconds = totalDurationSeconds % 60;
    const totalDuration = `${totalMinutes}:${totalSeconds.toString().padStart(2, '0')}`;

    return {
      ...playlist,
      items: items.map(item => ({
        id: item.id,
        playlistId: item.playlistId,
        podcastId: item.podcastId,
        position: item.position,
        addedAt: item.addedAt,
        podcast: item.podcast,
      })),
      itemCount: items.length,
      totalDuration,
    };
  }

  async updatePlaylist(id: string, userId: string, data: Partial<InsertPlaylist>): Promise<Playlist | undefined> {
    const playlist = await this.getPlaylistById(id);
    if (!playlist || playlist.userId !== userId) return undefined;

    const [updated] = await db
      .update(playlists)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(playlists.id, id))
      .returning();
    return updated;
  }

  async deletePlaylist(id: string, userId: string): Promise<boolean> {
    const playlist = await this.getPlaylistById(id);
    if (!playlist || playlist.userId !== userId) return false;

    await db.delete(playlists).where(eq(playlists.id, id));
    return true;
  }

  async addToPlaylist(playlistId: string, podcastId: string): Promise<PlaylistItem> {
    const existingItems = await db
      .select({ position: playlistItems.position })
      .from(playlistItems)
      .where(eq(playlistItems.playlistId, playlistId))
      .orderBy(desc(playlistItems.position))
      .limit(1);
    
    const nextPosition = existingItems.length > 0 ? existingItems[0].position + 1 : 0;

    const [existing] = await db
      .select()
      .from(playlistItems)
      .where(and(
        eq(playlistItems.playlistId, playlistId),
        eq(playlistItems.podcastId, podcastId)
      ));
    
    if (existing) return existing;

    const [item] = await db
      .insert(playlistItems)
      .values({ playlistId, podcastId, position: nextPosition })
      .returning();

    await db
      .update(playlists)
      .set({ updatedAt: new Date() })
      .where(eq(playlists.id, playlistId));

    return item;
  }

  async removeFromPlaylist(playlistId: string, podcastId: string): Promise<boolean> {
    const result = await db
      .delete(playlistItems)
      .where(and(
        eq(playlistItems.playlistId, playlistId),
        eq(playlistItems.podcastId, podcastId)
      ));
    
    await db
      .update(playlists)
      .set({ updatedAt: new Date() })
      .where(eq(playlists.id, playlistId));

    return result.rowCount !== null && result.rowCount > 0;
  }

  async reorderPlaylistItems(playlistId: string, itemPositions: { podcastId: string; position: number }[]): Promise<boolean> {
    for (const { podcastId, position } of itemPositions) {
      await db
        .update(playlistItems)
        .set({ position })
        .where(and(
          eq(playlistItems.playlistId, playlistId),
          eq(playlistItems.podcastId, podcastId)
        ));
    }

    await db
      .update(playlists)
      .set({ updatedAt: new Date() })
      .where(eq(playlists.id, playlistId));

    return true;
  }

  async getPlaylistsContainingPodcast(podcastId: string, userId: string): Promise<string[]> {
    const items = await db
      .select({ playlistId: playlistItems.playlistId })
      .from(playlistItems)
      .innerJoin(playlists, eq(playlistItems.playlistId, playlists.id))
      .where(and(
        eq(playlistItems.podcastId, podcastId),
        eq(playlists.userId, userId)
      ));
    
    return items.map(item => item.playlistId);
  }

  // ============================================
  // SOCIAL FEATURES - Likes, Comments, Trending
  // ============================================

  // Calculate confidence-aware hot score from like/dislike counts.
  //
  // The previous formula collapsed reactions into `likes - dislikes`, which
  // meant a single dislike fully cancelled a single like. That left popular
  // episodes with a few haters ranking below brand-new ones with no
  // engagement. Instead, we now combine:
  //
  //   1. The Wilson lower bound on the like ratio (listen / (listen + skip)).
  //      This is the same statistic we already use for ranking comments, and
  //      it grows smoothly as a podcast accumulates positive votes — so a
  //      single dislike no longer wipes out a single like. With no votes it
  //      returns 0 (neutral).
  //   2. A log-scaled magnitude over the total reaction count, so a podcast
  //      with 100 confident-liked votes outranks one with a single like.
  //   3. Independent positive log-bonuses for shares and comments — these
  //      don't have a "negative" counterpart so they only ever add to the score.
  //   4. The classic Reddit-style time term so fresh content still has a fair
  //      shot, but doesn't dominate a clearly preferred recent episode.
  private calculateHotScore(
    reactionCounts: { listen: number; skip: number },
    shares: number,
    comments: number,
    createdAt: Date
  ): number {
    const likes = reactionCounts.listen;
    const dislikes = reactionCounts.skip;
    const totalReactions = likes + dislikes;

    // Wilson lower bound on the like ratio (0..1, 0 when no votes). Scale by
    // log of total reactions so high-confidence engagement dominates.
    const wilson = this.calculateWilsonScore(likes, dislikes);
    const reactionScore = wilson * Math.log10(totalReactions + 1);

    // Shares and comments are always positive engagement signals.
    const positiveSignals = Math.log10(shares * 1.5 + comments * 0.5 + 1);

    const qualityScore = reactionScore + positiveSignals;

    // Reddit's epoch: Dec 8, 2005. 45000 seconds ≈ 12.5 hours decay constant.
    const epochSeconds = Math.floor(createdAt.getTime() / 1000) - 1134028003;
    return qualityScore + epochSeconds / 45000;
  }

  // Calculate Wilson score lower bound for ranking by like ratio.
  // Returns a value in [0, 1] representing the lower bound of the 95%
  // confidence interval for the true positive rate. Used both for comment
  // ranking and as the foundation for the podcast hot score.
  private calculateWilsonScore(upvotes: number, downvotes: number): number {
    const n = upvotes + downvotes;
    if (n === 0) return 0;

    const phat = upvotes / n;
    const z = 1.96; // 95% confidence

    const numerator = phat + (z * z) / (2 * n) - z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * n)) / n);
    const denominator = 1 + (z * z) / n;

    return numerator / denominator;
  }

  // Reactions operations (Facebook-style emoji reactions)
  async togglePodcastReaction(podcastId: string, userId: string | null, reactionType: ReactionType, guestId?: string): Promise<{ reaction: PodcastLike | null; engagement: PodcastEngagement }> {
    // Check for existing reaction (by userId for auth users, guestId for guests)
    const lookupCondition = userId
      ? and(eq(podcastLikes.podcastId, podcastId), eq(podcastLikes.userId, userId))
      : and(eq(podcastLikes.podcastId, podcastId), eq(podcastLikes.guestId, guestId!));
    const [existingReaction] = await db
      .select()
      .from(podcastLikes)
      .where(lookupCondition);

    let resultReaction: PodcastLike | null = null;

    if (existingReaction) {
      if (existingReaction.reactionType === reactionType) {
        // Same reaction - remove it (toggle off)
        await db
          .delete(podcastLikes)
          .where(eq(podcastLikes.id, existingReaction.id));
        resultReaction = null;
      } else {
        // Different reaction - update to new reaction
        const [updated] = await db
          .update(podcastLikes)
          .set({ reactionType, updatedAt: new Date() })
          .where(eq(podcastLikes.id, existingReaction.id))
          .returning();
        resultReaction = updated;
      }
    } else {
      // No existing reaction - create new
      const [created] = await db
        .insert(podcastLikes)
        .values({ podcastId, userId: userId || null, guestId: guestId || null, reactionType })
        .returning();
      resultReaction = created;
    }

    // Update engagement metrics
    const engagement = await this.updateEngagementScore(podcastId);
    return { reaction: resultReaction, engagement };
  }

  // Legacy likes operations (for backward compatibility)
  async togglePodcastLike(podcastId: string, userId: string | null, value: 1 | -1, guestId?: string): Promise<{ like: PodcastLike | null; engagement: PodcastEngagement }> {
    // Map legacy like/dislike to reactions: 1 = listen, -1 = skip
    const reactionType: ReactionType = value === 1 ? 'listen' : 'skip';
    const result = await this.togglePodcastReaction(podcastId, userId, reactionType, guestId);
    return { like: result.reaction, engagement: result.engagement };
  }

  async getPodcastLikesByUser(userId: string): Promise<PodcastLike[]> {
    return await db
      .select()
      .from(podcastLikes)
      .where(eq(podcastLikes.userId, userId))
      .orderBy(desc(podcastLikes.createdAt));
  }

  async getUserLikeForPodcast(podcastId: string, userId: string | null, guestId?: string): Promise<PodcastLike | undefined> {
    const condition = userId
      ? and(eq(podcastLikes.podcastId, podcastId), eq(podcastLikes.userId, userId))
      : guestId
        ? and(eq(podcastLikes.podcastId, podcastId), eq(podcastLikes.guestId, guestId))
        : undefined;
    if (!condition) return undefined;
    const [like] = await db.select().from(podcastLikes).where(condition);
    return like;
  }

  // Comments operations
  async createComment(comment: InsertComment): Promise<Comment> {
    const [created] = await db
      .insert(comments)
      .values(comment)
      .returning();
    
    // Update engagement comment count
    await this.updateEngagementScore(comment.podcastId);
    
    return created;
  }

  async getCommentsByPodcast(podcastId: string, userId?: string | null, sort: 'best' | 'new' = 'best', guestId?: string): Promise<CommentWithUser[]> {
    // Get all comments for this podcast with user info (leftJoin to support guest comments)
    const allComments = await db
      .select({
        id: comments.id,
        podcastId: comments.podcastId,
        userId: comments.userId,
        guestId: comments.guestId,
        guestName: comments.guestName,
        parentId: comments.parentId,
        body: comments.body,
        status: comments.status,
        isPinned: comments.isPinned,
        upvotes: comments.upvotes,
        downvotes: comments.downvotes,
        createdAt: comments.createdAt,
        updatedAt: comments.updatedAt,
        userFirstName: users.firstName,
        userLastName: users.lastName,
        userProfileImage: users.profileImageUrl,
        userAlias: users.alias,
      })
      .from(comments)
      .leftJoin(users, eq(comments.userId, users.id))
      .where(and(
        eq(comments.podcastId, podcastId),
        eq(comments.status, 'published')
      ));

    // Get user votes if userId or guestId provided
    let userVotes = new Map<string, number>();
    if (userId || guestId) {
      const commentIds = allComments.map(c => c.id);
      userVotes = await this.getUserVotesForComments(commentIds, userId || null, guestId);
    }

    // Transform to CommentWithUser format
    const commentsWithUser: CommentWithUser[] = allComments.map(c => {
      const isGuest = !c.userId && !!c.guestId;
      const displayName = isGuest 
        ? (c.guestName || 'Anonymous') 
        : (c.userAlias || c.userFirstName || 'Listener');
      return {
        id: c.id,
        podcastId: c.podcastId,
        userId: c.userId,
        guestId: c.guestId,
        guestName: c.guestName,
        parentId: c.parentId,
        body: c.body,
        status: c.status,
        isPinned: c.isPinned,
        upvotes: c.upvotes,
        downvotes: c.downvotes,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        user: {
          id: c.userId || c.guestId || 'guest',
          firstName: isGuest ? displayName : (c.userAlias || c.userFirstName),
          lastName: isGuest ? null : c.userLastName,
          profileImageUrl: c.userProfileImage || null,
          isGuest,
          guestName: c.guestName,
        },
        userVote: userVotes.get(c.id) || 0,
      };
    });

    // Separate top-level and replies
    const topLevel = commentsWithUser.filter(c => !c.parentId);
    const replies = commentsWithUser.filter(c => c.parentId);

    // Sort function
    const sortFn = sort === 'best' 
      ? (a: CommentWithUser, b: CommentWithUser) => {
          // Pinned comments first
          if (a.isPinned && !b.isPinned) return -1;
          if (!a.isPinned && b.isPinned) return 1;
          // Then by Wilson score
          const scoreA = this.calculateWilsonScore(a.upvotes, a.downvotes);
          const scoreB = this.calculateWilsonScore(b.upvotes, b.downvotes);
          return scoreB - scoreA;
        }
      : (a: CommentWithUser, b: CommentWithUser) => {
          // Pinned comments first
          if (a.isPinned && !b.isPinned) return -1;
          if (!a.isPinned && b.isPinned) return 1;
          // Then by date (newest first)
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        };

    // Sort top-level comments
    topLevel.sort(sortFn);

    // Attach replies to parent comments
    for (const comment of topLevel) {
      const commentReplies = replies.filter(r => r.parentId === comment.id);
      commentReplies.sort(sortFn);
      comment.replies = commentReplies;
    }

    return topLevel;
  }

  async getCommentById(id: string): Promise<Comment | undefined> {
    const [comment] = await db
      .select()
      .from(comments)
      .where(eq(comments.id, id));
    return comment;
  }

  async updateComment(id: string, userId: string, body: string): Promise<Comment | undefined> {
    const comment = await this.getCommentById(id);
    if (!comment || comment.userId !== userId) return undefined;

    const [updated] = await db
      .update(comments)
      .set({ body, updatedAt: new Date() })
      .where(eq(comments.id, id))
      .returning();
    return updated;
  }

  async deleteComment(id: string, userId: string): Promise<boolean> {
    const comment = await this.getCommentById(id);
    if (!comment) return false;

    // Only the comment author can delete
    if (comment.userId !== userId) return false;

    // Mark as removed instead of actually deleting
    await db
      .update(comments)
      .set({ status: 'removed', updatedAt: new Date() })
      .where(eq(comments.id, id));
    
    // Update engagement
    await this.updateEngagementScore(comment.podcastId);
    
    return true;
  }

  async pinComment(id: string, podcastOwnerId: string): Promise<Comment | undefined> {
    const comment = await this.getCommentById(id);
    if (!comment) return undefined;

    // Verify the requester owns the podcast
    const [podcast] = await db
      .select()
      .from(generatedPodcasts)
      .where(eq(generatedPodcasts.id, comment.podcastId));
    
    if (!podcast || podcast.userId !== podcastOwnerId) return undefined;

    // Toggle pin status
    const [updated] = await db
      .update(comments)
      .set({ isPinned: !comment.isPinned, updatedAt: new Date() })
      .where(eq(comments.id, id))
      .returning();
    return updated;
  }

  // Comment Votes
  async toggleCommentVote(commentId: string, userId: string | null, value: 1 | -1, guestId?: string): Promise<CommentVote | null> {
    const comment = await this.getCommentById(commentId);
    if (!comment) return null;

    const voteCondition = userId
      ? and(eq(commentVotes.commentId, commentId), eq(commentVotes.userId, userId))
      : and(eq(commentVotes.commentId, commentId), eq(commentVotes.guestId, guestId!));

    const [existingVote] = await db
      .select()
      .from(commentVotes)
      .where(voteCondition);

    let resultVote: CommentVote | null = null;
    let upvoteChange = 0;
    let downvoteChange = 0;

    if (existingVote) {
      if (existingVote.value === value) {
        // Same value - remove vote (toggle off)
        await db
          .delete(commentVotes)
          .where(eq(commentVotes.id, existingVote.id));
        resultVote = null;
        if (value === 1) upvoteChange = -1;
        else downvoteChange = -1;
      } else {
        // Different value - update
        const [updated] = await db
          .update(commentVotes)
          .set({ value })
          .where(eq(commentVotes.id, existingVote.id))
          .returning();
        resultVote = updated;
        if (value === 1) {
          upvoteChange = 1;
          downvoteChange = -1;
        } else {
          upvoteChange = -1;
          downvoteChange = 1;
        }
      }
    } else {
      // No existing vote - create new
      const [created] = await db
        .insert(commentVotes)
        .values({ commentId, userId: userId || null, guestId: guestId || null, value })
        .returning();
      resultVote = created;
      if (value === 1) upvoteChange = 1;
      else downvoteChange = 1;
    }

    // Update comment vote counts
    await db
      .update(comments)
      .set({
        upvotes: sql`${comments.upvotes} + ${upvoteChange}`,
        downvotes: sql`${comments.downvotes} + ${downvoteChange}`,
        updatedAt: new Date(),
      })
      .where(eq(comments.id, commentId));

    return resultVote;
  }

  async getUserVotesForComments(commentIds: string[], userId: string | null, guestId?: string): Promise<Map<string, number>> {
    if (commentIds.length === 0) return new Map();

    const condition = userId
      ? and(inArray(commentVotes.commentId, commentIds), eq(commentVotes.userId, userId))
      : guestId
        ? and(inArray(commentVotes.commentId, commentIds), eq(commentVotes.guestId, guestId))
        : undefined;
    if (!condition) return new Map();

    const votes = await db
      .select()
      .from(commentVotes)
      .where(condition);

    const voteMap = new Map<string, number>();
    for (const vote of votes) {
      voteMap.set(vote.commentId, vote.value);
    }
    return voteMap;
  }

  // Engagement operations
  async getOrCreateEngagement(podcastId: string): Promise<PodcastEngagement> {
    const [existing] = await db
      .select()
      .from(podcastEngagement)
      .where(eq(podcastEngagement.podcastId, podcastId));

    if (existing) return existing;

    // Create new engagement record
    const [created] = await db
      .insert(podcastEngagement)
      .values({
        podcastId,
        likes: 0,
        dislikes: 0,
        commentCount: 0,
        shareCount: 0,
        hotScore: 0,
        trendingScore: 0,
        lastEngagementAt: new Date(),
      })
      .returning();

    return created;
  }

  async updateEngagementScore(podcastId: string): Promise<PodcastEngagement> {
    // Get podcast creation date
    const [podcast] = await db
      .select()
      .from(generatedPodcasts)
      .where(eq(generatedPodcasts.id, podcastId));

    if (!podcast) {
      throw new Error('Podcast not found');
    }

    // Count like (listen) vs dislike (skip) reactions
    const reactionResult = await db
      .select({
        listenCount: sql<number>`COALESCE(SUM(CASE WHEN ${podcastLikes.reactionType} = 'listen' THEN 1 ELSE 0 END), 0)`,
        skipCount: sql<number>`COALESCE(SUM(CASE WHEN ${podcastLikes.reactionType} = 'skip' THEN 1 ELSE 0 END), 0)`,
        totalReactions: sql<number>`COUNT(*)`,
      })
      .from(podcastLikes)
      .where(eq(podcastLikes.podcastId, podcastId));

    const reactionCounts = {
      listen: Number(reactionResult[0]?.listenCount) || 0,
      skip: Number(reactionResult[0]?.skipCount) || 0,
    };
    const totalReactions = Number(reactionResult[0]?.totalReactions) || 0;

    const likes = reactionCounts.listen;
    const dislikes = reactionCounts.skip;

    // Count comments
    const commentResult = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(comments)
      .where(and(
        eq(comments.podcastId, podcastId),
        eq(comments.status, 'published')
      ));
    const commentCount = Number(commentResult[0]?.count) || 0;

    // Count shares
    const shareResult = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(shareEvents)
      .where(eq(shareEvents.podcastId, podcastId));
    const shareCount = Number(shareResult[0]?.count) || 0;

    // Calculate hot score using weighted reactions
    const hotScore = this.calculateHotScore(reactionCounts, shareCount, commentCount, podcast.timestamp);

    // Calculate trending score (engagement velocity in last 24 hours)
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentReactionsResult = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(podcastLikes)
      .where(and(
        eq(podcastLikes.podcastId, podcastId),
        sql`${podcastLikes.createdAt} > ${dayAgo}`
      ));
    const recentReactions = Number(recentReactionsResult[0]?.count) || 0;

    const recentCommentsResult = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(comments)
      .where(and(
        eq(comments.podcastId, podcastId),
        sql`${comments.createdAt} > ${dayAgo}`
      ));
    const recentComments = Number(recentCommentsResult[0]?.count) || 0;

    // Trending score = recent engagement velocity
    const trendingScore = recentReactions * 2 + recentComments;

    // Upsert engagement record with reaction counts
    const [engagement] = await db
      .insert(podcastEngagement)
      .values({
        podcastId,
        likes,
        dislikes,
        listenCount: reactionCounts.listen,
        skipCount: reactionCounts.skip,
        totalReactions,
        commentCount,
        shareCount,
        hotScore,
        trendingScore,
        lastEngagementAt: new Date(),
      })
      .onConflictDoUpdate({
        target: podcastEngagement.podcastId,
        set: {
          likes,
          dislikes,
          listenCount: reactionCounts.listen,
          skipCount: reactionCounts.skip,
          totalReactions,
          commentCount,
          shareCount,
          hotScore,
          trendingScore,
          lastEngagementAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();

    return engagement;
  }

  async getTrendingPodcasts(limit: number = 20, timeframe: 'hour' | 'day' | 'week' = 'day'): Promise<PodcastWithEngagement[]> {
    // Get podcasts with engagement data, ordered by hot score with timestamp fallback
    // This ensures podcasts appear even when all hot_scores are 0
    const startTime = Date.now();
    console.log(`[Storage] getTrendingPodcasts called: limit=${limit}, timeframe=${timeframe}, env=${process.env.NODE_ENV || 'undefined'}`);
    
    try {
      const results = await db
        .select({
          podcast: podcastCardColumns,
          engagement: podcastEngagement,
        })
        .from(generatedPodcasts)
        .leftJoin(podcastEngagement, eq(generatedPodcasts.id, podcastEngagement.podcastId))
        .where(eq(generatedPodcasts.isPublic, true))
        .orderBy(
          desc(sql`COALESCE(${podcastEngagement.hotScore}, 0)`),
          desc(generatedPodcasts.timestamp)
        )
        .limit(limit);

      const elapsed = Date.now() - startTime;
      console.log(`[Storage] getTrendingPodcasts found ${results.length} podcasts in ${elapsed}ms`);
      
      // Enhanced logging for debugging production issues
      if (results.length === 0) {
        console.warn(`[Storage] ⚠️ getTrendingPodcasts returned ZERO results! Running diagnostic...`);
        // Run a quick count to see what's in the database
        const countResult = await db
          .select({ 
            total: sql<number>`COUNT(*)`,
            publicCount: sql<number>`SUM(CASE WHEN is_public = true THEN 1 ELSE 0 END)`
          })
          .from(generatedPodcasts);
        console.warn(`[Storage] Diagnostic: total=${countResult[0]?.total}, public=${countResult[0]?.publicCount}`);
      } else {
        // Log first few podcast IDs for correlation
        const sampleIds = results.slice(0, 3).map(r => r.podcast.id.substring(0, 8));
        const withEngagement = results.filter(r => r.engagement !== null).length;
        console.log(`[Storage] getTrendingPodcasts sample IDs: [${sampleIds.join(', ')}...], withEngagement=${withEngagement}/${results.length}`);
      }
      
      return results.map(r => ({
        ...r.podcast,
        engagement: r.engagement || undefined,
      })) as PodcastWithEngagement[];
    } catch (error: any) {
      console.error('[Storage] ❌ getTrendingPodcasts ERROR:', error.message);
      console.error('[Storage] Stack:', error.stack);
      throw error;
    }
  }

  // Share tracking
  async recordShare(podcastId: string, userId?: string, platform?: string): Promise<ShareEvent> {
    const [shareEvent] = await db
      .insert(shareEvents)
      .values({
        podcastId,
        userId: userId || null,
        platform: platform || 'clipboard',
      })
      .returning();

    // Update engagement
    await this.updateEngagementScore(podcastId);

    return shareEvent;
  }

  // Batch operations for performance optimization
  async getBatchEngagement(podcastIds: string[]): Promise<Map<string, PodcastEngagement>> {
    if (podcastIds.length === 0) return new Map();

    const engagements = await db
      .select()
      .from(podcastEngagement)
      .where(inArray(podcastEngagement.podcastId, podcastIds));

    const engagementMap = new Map<string, PodcastEngagement>();
    for (const engagement of engagements) {
      engagementMap.set(engagement.podcastId, engagement);
    }
    return engagementMap;
  }

  async getBatchUserLikes(podcastIds: string[], userId: string | null, guestId?: string): Promise<Map<string, PodcastLike>> {
    if (podcastIds.length === 0) return new Map();

    const condition = userId
      ? and(inArray(podcastLikes.podcastId, podcastIds), eq(podcastLikes.userId, userId))
      : guestId
        ? and(inArray(podcastLikes.podcastId, podcastIds), eq(podcastLikes.guestId, guestId))
        : undefined;
    if (!condition) return new Map();

    const likes = await db
      .select()
      .from(podcastLikes)
      .where(condition);

    const likeMap = new Map<string, PodcastLike>();
    for (const like of likes) {
      likeMap.set(like.podcastId, like);
    }
    return likeMap;
  }

  async getBatchTopComments(podcastIds: string[]): Promise<Map<string, { id: string; body: string; user: { firstName: string | null; lastName: string | null; profileImageUrl: string | null }; upvotes: number } | null>> {
    if (podcastIds.length === 0) return new Map();

    // Get all top-level comments for all podcasts with user info, sorted by upvotes
    const allComments = await db
      .select({
        id: comments.id,
        podcastId: comments.podcastId,
        body: comments.body,
        upvotes: comments.upvotes,
        guestName: comments.guestName,
        guestId: comments.guestId,
        userFirstName: users.firstName,
        userLastName: users.lastName,
        userAlias: users.alias,
        userProfileImage: users.profileImageUrl,
      })
      .from(comments)
      .leftJoin(users, eq(comments.userId, users.id))
      .where(and(
        inArray(comments.podcastId, podcastIds),
        eq(comments.status, 'published'),
        sql`${comments.parentId} IS NULL` // Only top-level comments
      ))
      .orderBy(desc(comments.upvotes), desc(comments.createdAt));

    // Group by podcastId and take the first (top) comment for each
    const topCommentMap = new Map<string, { id: string; body: string; user: { firstName: string | null; lastName: string | null; profileImageUrl: string | null }; upvotes: number } | null>();
    
    for (const comment of allComments) {
      if (!topCommentMap.has(comment.podcastId)) {
        const isGuest = !comment.userFirstName && !!comment.guestId;
        topCommentMap.set(comment.podcastId, {
          id: comment.id,
          body: comment.body,
          upvotes: comment.upvotes,
          user: {
            firstName: isGuest ? (comment.guestName || 'Listener') : (comment.userAlias || comment.userFirstName),
            lastName: isGuest ? null : comment.userLastName,
            profileImageUrl: comment.userProfileImage,
          },
        });
      }
    }

    // Set null for podcasts without comments
    for (const podcastId of podcastIds) {
      if (!topCommentMap.has(podcastId)) {
        topCommentMap.set(podcastId, null);
      }
    }

    return topCommentMap;
  }

  // Favorite Topics - Daily Personalized News
  async listFavoriteTopics(userId: string | null, guestId?: string): Promise<FavoriteTopic[]> {
    if (userId) {
      return await db
        .select()
        .from(favoriteTopics)
        .where(eq(favoriteTopics.userId, userId))
        .orderBy(asc(favoriteTopics.position), desc(favoriteTopics.createdAt));
    }
    if (guestId) {
      const rows = await db.execute(sql`
        SELECT * FROM favorite_topics
        WHERE guest_id = ${guestId}
        ORDER BY position ASC, created_at DESC
      `);
      return (rows as any).rows as FavoriteTopic[];
    }
    return [];
  }

  async addFavoriteTopic(topic: { userId: string | null; guestId?: string; label: string; category?: string; position?: number }): Promise<FavoriteTopic> {
    let maxPosResult: any;
    if (topic.userId) {
      [maxPosResult] = await db
        .select({ maxPos: sql<number>`COALESCE(MAX(${favoriteTopics.position}), -1)` })
        .from(favoriteTopics)
        .where(eq(favoriteTopics.userId, topic.userId));
    } else {
      const res = await db.execute(sql`
        SELECT COALESCE(MAX(position), -1) AS "maxPos" FROM favorite_topics WHERE guest_id = ${topic.guestId}
      `);
      maxPosResult = (res as any).rows?.[0] ?? { maxPos: -1 };
    }

    const nextPosition = Number(maxPosResult?.maxPos ?? -1) + 1;
    const cat = topic.category ?? 'custom';

    if (topic.userId) {
      const [newTopic] = await db
        .insert(favoriteTopics)
        .values({ userId: topic.userId, label: topic.label, category: cat, position: nextPosition })
        .returning();
      return newTopic;
    } else {
      const res = await db.execute(sql`
        INSERT INTO favorite_topics (user_id, guest_id, label, category, position)
        VALUES (NULL, ${topic.guestId}, ${topic.label}, ${cat}, ${nextPosition})
        RETURNING *
      `);
      return (res as any).rows?.[0] as FavoriteTopic;
    }
  }

  async removeFavoriteTopic(id: string, userId: string | null, guestId?: string): Promise<boolean> {
    if (userId) {
      const result = await db
        .delete(favoriteTopics)
        .where(and(eq(favoriteTopics.id, id), eq(favoriteTopics.userId, userId)))
        .returning({ id: favoriteTopics.id });
      return result.length > 0;
    } else {
      const res = await db.execute(sql`
        DELETE FROM favorite_topics WHERE id = ${id} AND guest_id = ${guestId} RETURNING id
      `);
      return ((res as any).rows?.length ?? 0) > 0;
    }
  }

  async updateFavoriteTopicPositions(userId: string | null, positions: { id: string; position: number }[], guestId?: string): Promise<boolean> {
    for (const { id, position } of positions) {
      if (userId) {
        await db
          .update(favoriteTopics)
          .set({ position })
          .where(and(eq(favoriteTopics.id, id), eq(favoriteTopics.userId, userId)));
      } else {
        await db.execute(sql`
          UPDATE favorite_topics SET position = ${position}
          WHERE id = ${id} AND guest_id = ${guestId}
        `);
      }
    }
    return true;
  }

  // News Presets - Format, Style, Voice settings
  async getNewsPreset(userId: string | null, guestId?: string): Promise<NewsPreset | undefined> {
    if (userId) {
      const [preset] = await db
        .select()
        .from(newsPresets)
        .where(and(eq(newsPresets.userId, userId), eq(newsPresets.isDefault, true)));
      return preset;
    }
    if (guestId) {
      const [preset] = await db
        .select()
        .from(newsPresets)
        .where(and(eq(newsPresets.guestId, guestId), eq(newsPresets.isDefault, true)))
        .limit(1);
      return preset;
    }
    return undefined;
  }

  async createNewsPreset(preset: InsertNewsPreset & { guestId?: string }): Promise<NewsPreset> {
    const { guestId, ...rest } = preset;
    const values: InferInsertModel<typeof newsPresets> = {
      ...rest,
      userId: rest.userId ?? null,
      guestId: guestId ?? null,
    };
    const [newPreset] = await db
      .insert(newsPresets)
      .values(values)
      .returning();
    return newPreset;
  }

  async updateNewsPreset(userId: string | null, data: Partial<InsertNewsPreset>, guestId?: string): Promise<NewsPreset | undefined> {
    if (userId) {
      const [updated] = await db
        .update(newsPresets)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(newsPresets.userId, userId), eq(newsPresets.isDefault, true)))
        .returning();
      return updated;
    }
    if (guestId) {
      const [updated] = await db
        .update(newsPresets)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(newsPresets.guestId, guestId), eq(newsPresets.isDefault, true)))
        .returning();
      return updated;
    }
    return undefined;
  }

  async deleteNewsPreset(userId: string | null, guestId?: string): Promise<boolean> {
    if (userId) {
      const result = await db
        .delete(newsPresets)
        .where(and(eq(newsPresets.userId, userId), eq(newsPresets.isDefault, true)))
        .returning({ id: newsPresets.id });
      return result.length > 0;
    }
    if (guestId) {
      const result = await db
        .delete(newsPresets)
        .where(and(eq(newsPresets.guestId, guestId), eq(newsPresets.isDefault, true)))
        .returning({ id: newsPresets.id });
      return result.length > 0;
    }
    return false;
  }

  // Auto-generation scheduling methods
  async getAutoGeneratePresets(): Promise<NewsPreset[]> {
    return db
      .select()
      .from(newsPresets)
      .where(eq(newsPresets.autoGenerateEnabled, true));
  }

  async updateAutoGenerateStatus(
    presetId: string, 
    status: string, 
    error?: string
  ): Promise<void> {
    const isSuccess = status === 'success';
    await db
      .update(newsPresets)
      .set({ 
        ...(isSuccess ? { lastAutoGeneratedAt: new Date() } : {}),
        lastGenerateStatus: status,
        lastGenerateError: error || null,
        updatedAt: new Date(),
      })
      .where(eq(newsPresets.id, presetId));
  }

  // TeachMe Presets - Daily Micro-Learning scheduling methods
  async getTeachmePreset(userId: string | null, guestId?: string): Promise<TeachmePreset | undefined> {
    if (userId) {
      const [preset] = await db
        .select()
        .from(teachmePresets)
        .where(and(eq(teachmePresets.userId, userId), eq(teachmePresets.isActive, true)))
        .orderBy(desc(teachmePresets.createdAt))
        .limit(1);
      return preset;
    }
    if (guestId) {
      const [preset] = await db
        .select()
        .from(teachmePresets)
        .where(and(eq(teachmePresets.guestId, guestId), eq(teachmePresets.isActive, true)))
        .orderBy(desc(teachmePresets.createdAt))
        .limit(1);
      return preset;
    }
    return undefined;
  }

  async getTeachmePresets(userId: string | null, guestId?: string): Promise<TeachmePreset[]> {
    if (userId) {
      return db
        .select()
        .from(teachmePresets)
        .where(eq(teachmePresets.userId, userId))
        .orderBy(desc(teachmePresets.createdAt));
    }
    if (guestId) {
      return db
        .select()
        .from(teachmePresets)
        .where(eq(teachmePresets.guestId, guestId))
        .orderBy(desc(teachmePresets.createdAt));
    }
    return [];
  }

  async createTeachmePreset(preset: InsertTeachmePreset & { syllabus: SyllabusEpisode[]; guestId?: string }): Promise<TeachmePreset> {
    const { guestId, ...rest } = preset;
    const values: InferInsertModel<typeof teachmePresets> = {
      ...rest,
      userId: rest.userId ?? null,
      guestId: guestId ?? null,
    };
    const [newPreset] = await db
      .insert(teachmePresets)
      .values(values)
      .returning();
    return newPreset;
  }

  async updateTeachmePreset(
    presetId: string, 
    userId: string | null, 
    data: Partial<InsertTeachmePreset & { syllabus?: SyllabusEpisode[]; currentEpisode?: number; playlistId?: string }>,
    guestId?: string
  ): Promise<TeachmePreset | undefined> {
    if (userId) {
      const [updated] = await db
        .update(teachmePresets)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(teachmePresets.id, presetId), eq(teachmePresets.userId, userId)))
        .returning();
      return updated;
    }
    if (guestId) {
      const [updated] = await db
        .update(teachmePresets)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(teachmePresets.id, presetId), eq(teachmePresets.guestId, guestId)))
        .returning();
      return updated;
    }
    return undefined;
  }

  async deleteTeachmePreset(presetId: string, userId: string | null, guestId?: string): Promise<boolean> {
    if (userId) {
      const result = await db
        .delete(teachmePresets)
        .where(and(eq(teachmePresets.id, presetId), eq(teachmePresets.userId, userId)))
        .returning({ id: teachmePresets.id });
      return result.length > 0;
    }
    if (guestId) {
      const result = await db
        .delete(teachmePresets)
        .where(and(eq(teachmePresets.id, presetId), eq(teachmePresets.guestId, guestId)))
        .returning({ id: teachmePresets.id });
      return result.length > 0;
    }
    return false;
  }

  async getAutoGenerateTeachmePresets(): Promise<TeachmePreset[]> {
    return db
      .select()
      .from(teachmePresets)
      .where(and(
        eq(teachmePresets.autoGenerateEnabled, true),
        eq(teachmePresets.isActive, true)
      ));
  }

  async updateTeachmeAutoGenerateStatus(
    presetId: string, 
    status: string, 
    error?: string
  ): Promise<void> {
    const isSuccess = status === 'success';
    await db
      .update(teachmePresets)
      .set({ 
        ...(isSuccess ? { lastAutoGeneratedAt: new Date() } : {}),
        lastGenerateStatus: status,
        lastGenerateError: error || null,
        updatedAt: new Date(),
      })
      .where(eq(teachmePresets.id, presetId));
  }

  async markTeachmeEpisodeGenerated(
    presetId: string, 
    episodeNumber: number, 
    podcastId: string
  ): Promise<TeachmePreset | undefined> {
    const [preset] = await db
      .select()
      .from(teachmePresets)
      .where(eq(teachmePresets.id, presetId));
    
    if (!preset) return undefined;
    
    const updatedSyllabus = (preset.syllabus as SyllabusEpisode[]).map(ep => 
      ep.episodeNumber === episodeNumber 
        ? { ...ep, generated: true, podcastId } 
        : ep
    );
    
    const [updated] = await db
      .update(teachmePresets)
      .set({ 
        syllabus: updatedSyllabus,
        currentEpisode: episodeNumber,
        updatedAt: new Date(),
      })
      .where(eq(teachmePresets.id, presetId))
      .returning();
    
    return updated;
  }

  // Cleanup job methods - Get podcasts eligible for deletion
  async getNewsPodcastsForCleanup(daysOld: number): Promise<GeneratedPodcast[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    return db
      .select()
      .from(generatedPodcasts)
      .where(and(
        eq(generatedPodcasts.templateCategory, 'news'),
        lt(generatedPodcasts.timestamp, cutoffDate)
      ));
  }

  async getLowEngagementPodcastsForCleanup(daysOld: number, minPlays: number): Promise<GeneratedPodcast[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    return db
      .select()
      .from(generatedPodcasts)
      .where(and(
        lt(generatedPodcasts.plays, minPlays),
        lt(generatedPodcasts.timestamp, cutoffDate)
      ));
  }

  // Podcast metadata editing
  async updatePodcastMetadata(
    id: string, 
    userId: string, 
    data: { title?: string; description?: string }
  ): Promise<GeneratedPodcast | undefined> {
    const [podcast] = await db
      .select()
      .from(generatedPodcasts)
      .where(eq(generatedPodcasts.id, id));
    
    if (!podcast || podcast.userId !== userId) {
      return undefined;
    }
    
    const [updated] = await db
      .update(generatedPodcasts)
      .set({
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
      })
      .where(eq(generatedPodcasts.id, id))
      .returning();
    
    return updated;
  }

  // Podcast Shows (RSS Distribution)
  async createPodcastShow(show: InsertPodcastShow): Promise<PodcastShow> {
    const [created] = await db.insert(podcastShows).values(show).returning();
    return created;
  }

  async getPodcastShowsByUser(userId: string): Promise<PodcastShow[]> {
    return db
      .select()
      .from(podcastShows)
      .where(eq(podcastShows.userId, userId))
      .orderBy(desc(podcastShows.createdAt));
  }

  async getPodcastShowById(id: string): Promise<PodcastShow | undefined> {
    const [show] = await db
      .select()
      .from(podcastShows)
      .where(eq(podcastShows.id, id));
    return show;
  }

  async updatePodcastShow(
    id: string, 
    userId: string, 
    data: Partial<InsertPodcastShow>
  ): Promise<PodcastShow | undefined> {
    const [updated] = await db
      .update(podcastShows)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(podcastShows.id, id), eq(podcastShows.userId, userId)))
      .returning();
    return updated;
  }

  async deletePodcastShow(id: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(podcastShows)
      .where(and(eq(podcastShows.id, id), eq(podcastShows.userId, userId)))
      .returning({ id: podcastShows.id });
    return result.length > 0;
  }

  // Show Episodes
  async addEpisodeToShow(
    showId: string, 
    podcastId: string, 
    episodeNumber?: number, 
    seasonNumber?: number
  ): Promise<ShowEpisode> {
    // Get max position for this show
    const [maxPos] = await db
      .select({ maxPosition: sql<number>`COALESCE(MAX(position), -1)` })
      .from(showEpisodes)
      .where(eq(showEpisodes.showId, showId));
    
    const [created] = await db
      .insert(showEpisodes)
      .values({
        showId,
        podcastId,
        episodeNumber,
        seasonNumber,
        position: (maxPos?.maxPosition ?? -1) + 1,
      })
      .returning();
    
    return created;
  }

  async removeEpisodeFromShow(showId: string, podcastId: string): Promise<boolean> {
    const result = await db
      .delete(showEpisodes)
      .where(and(eq(showEpisodes.showId, showId), eq(showEpisodes.podcastId, podcastId)))
      .returning({ id: showEpisodes.id });
    return result.length > 0;
  }

  async getShowEpisodes(showId: string): Promise<(ShowEpisode & { podcast: GeneratedPodcast })[]> {
    const results = await db
      .select()
      .from(showEpisodes)
      .innerJoin(generatedPodcasts, eq(showEpisodes.podcastId, generatedPodcasts.id))
      .where(eq(showEpisodes.showId, showId))
      .orderBy(asc(showEpisodes.position));
    
    return results.map(r => ({
      ...r.show_episodes,
      podcast: r.generated_podcasts,
    }));
  }

  async reorderShowEpisodes(
    showId: string, 
    items: { podcastId: string; position: number }[]
  ): Promise<boolean> {
    for (const item of items) {
      await db
        .update(showEpisodes)
        .set({ position: item.position })
        .where(and(
          eq(showEpisodes.showId, showId),
          eq(showEpisodes.podcastId, item.podcastId)
        ));
    }
    return true;
  }

  // In-memory storage for generation metrics (telemetry)
  private generationMetrics: GenerationMetricRecord[] = [];
  private metricIdCounter = 0;

  async recordGenerationMetric(metric: Omit<GenerationMetricRecord, 'id'>): Promise<GenerationMetricRecord> {
    // Normalize dates to ISO strings for consistent JSON serialization
    const normalizeDate = (d: string | Date): string => {
      if (typeof d === 'string') return d;
      return d instanceof Date ? d.toISOString() : new Date().toISOString();
    };
    
    const record: GenerationMetricRecord = {
      ...metric,
      id: `metric_${++this.metricIdCounter}`,
      startedAt: normalizeDate(metric.startedAt as any),
      completedAt: normalizeDate(metric.completedAt as any),
    };
    this.generationMetrics.unshift(record);
    if (this.generationMetrics.length > 1000) {
      this.generationMetrics = this.generationMetrics.slice(0, 1000);
    }
    return record;
  }

  async getRecentGenerationMetrics(limit: number = 50): Promise<GenerationMetricRecord[]> {
    return this.generationMetrics.slice(0, limit);
  }

  async getGenerationStatsSummary(): Promise<GenerationStatsSummary> {
    const metrics = this.generationMetrics;
    const successfulMetrics = metrics.filter(m => m.success);
    
    const totalGenerations = metrics.length;
    const successRate = totalGenerations > 0 ? (successfulMetrics.length / totalGenerations) * 100 : 0;
    const avgActual = successfulMetrics.length > 0 
      ? successfulMetrics.reduce((sum, m) => sum + m.actualTimeSeconds, 0) / successfulMetrics.length 
      : 0;
    const avgEstimated = successfulMetrics.length > 0 
      ? successfulMetrics.reduce((sum, m) => sum + m.estimatedTimeSeconds, 0) / successfulMetrics.length 
      : 0;
    const avgAccuracy = avgEstimated > 0 ? (avgActual / avgEstimated) * 100 : 0;

    const buckets = [
      { bucket: '2min', minDuration: 0, maxDuration: 2 },
      { bucket: '5min', minDuration: 3, maxDuration: 5 },
      { bucket: '10min', minDuration: 6, maxDuration: 10 },
      { bucket: '20min', minDuration: 11, maxDuration: 20 },
      { bucket: '30min', minDuration: 21, maxDuration: 30 },
      { bucket: '60min', minDuration: 31, maxDuration: 60 },
    ];

    const byDurationBucket = buckets.map(({ bucket, minDuration, maxDuration }) => {
      const bucketMetrics = successfulMetrics.filter(
        m => m.durationMinutes >= minDuration && m.durationMinutes <= maxDuration
      );
      const count = bucketMetrics.length;
      const avgActualSeconds = count > 0 
        ? bucketMetrics.reduce((sum, m) => sum + m.actualTimeSeconds, 0) / count 
        : 0;
      const avgEstimatedSeconds = count > 0 
        ? bucketMetrics.reduce((sum, m) => sum + m.estimatedTimeSeconds, 0) / count 
        : 0;
      const avgAccuracyPercent = avgEstimatedSeconds > 0 ? (avgActualSeconds / avgEstimatedSeconds) * 100 : 0;
      
      return { bucket, minDuration, maxDuration, count, avgActualSeconds, avgEstimatedSeconds, avgAccuracyPercent };
    });

    const templateCounts = new Map<string, { total: number; successful: number; totalSeconds: number }>();
    metrics.forEach(m => {
      const existing = templateCounts.get(m.templateCategory) || { total: 0, successful: 0, totalSeconds: 0 };
      existing.total++;
      if (m.success) {
        existing.successful++;
        existing.totalSeconds += m.actualTimeSeconds;
      }
      templateCounts.set(m.templateCategory, existing);
    });

    const byTemplate = Array.from(templateCounts.entries()).map(([template, data]) => ({
      template,
      count: data.total,
      avgActualSeconds: data.successful > 0 ? data.totalSeconds / data.successful : 0,
      successRate: data.total > 0 ? (data.successful / data.total) * 100 : 0,
    }));

    return {
      totalGenerations,
      successRate,
      averageActualSeconds: avgActual,
      averageEstimatedSeconds: avgEstimated,
      averageAccuracyPercent: avgAccuracy,
      byDurationBucket,
      byTemplate,
    };
  }
}

export const storage = new DatabaseStorage();
