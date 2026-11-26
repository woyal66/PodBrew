import { getTrendingTopics, type TrendingCategory, type TrendingTopic } from '../perplexity';
import * as PersistentCache from './PersistentCache';
import { logger } from '../utils/logger';
import { isQuotaError, isProviderInCooldown, setProviderCooldown } from './providerQuotaGuard';
import { fetchGoogleNewsFallback } from './GoogleNewsFallback';

interface CachedTrending {
  category: string;
  topics: TrendingTopic[];
  cachedAt: number;
  isEmpty: boolean;
}

interface FailedAttempt {
  failedAt: number;
  retryCount: number;
  lastError?: string;
}

const trendingCache = new Map<string, CachedTrending>();
const failedAttempts = new Map<string, FailedAttempt>();
// Dedupe concurrent background refreshes per cache key.
const inFlightRefreshes = new Map<string, Promise<TrendingTopic[]>>();

const TRENDING_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours total TTL
const TRENDING_CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours in seconds for PersistentCache
const TRENDING_SWR_THRESHOLD = 4 * 60 * 60 * 1000; // serve cached + refresh in background after 4h
const TRENDING_FRESH_MS = 24 * 60 * 60 * 1000; // 24h freshness window for individual topics
const EMPTY_RESULT_TTL = 5 * 60 * 1000; // 5 minutes for empty results (allow quick retry)
const FAILED_RETRY_DELAY = 2 * 60 * 1000; // 2 minutes before retrying failed requests
const MAX_RETRY_COUNT = 3;
const WARMER_SKIP_FRESH_MS = 60 * 60 * 1000; // warmer skips entries refreshed within the last hour

// Auto-cleanup expired entries every hour
setInterval(() => {
  const now = Date.now();
  const expired: string[] = [];

  Array.from(trendingCache.entries()).forEach(([key, value]) => {
    const ttl = value.isEmpty ? EMPTY_RESULT_TTL : TRENDING_CACHE_TTL;
    if (now - value.cachedAt > ttl) {
      expired.push(key);
    }
  });

  expired.forEach(key => trendingCache.delete(key));
  if (expired.length > 0) {
    console.log(`[TrendingCache] Cleaned up ${expired.length} expired entries`);
  }

  // Clean up old failed attempts
  const expiredFailed: string[] = [];
  Array.from(failedAttempts.entries()).forEach(([key, value]) => {
    if (now - value.failedAt > TRENDING_CACHE_TTL) {
      expiredFailed.push(key);
    }
  });
  expiredFailed.forEach(key => failedAttempts.delete(key));
}, 60 * 60 * 1000);

function normalizeLocation(location: string): string {
  return location.trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildCacheKey(category: TrendingCategory, location?: string): string {
  const normalizedLocation = location ? normalizeLocation(location) : undefined;
  return normalizedLocation ? `${category}:${normalizedLocation}` : category;
}

/**
 * Drop topics whose publishedAt is older than 24h. Topics with an unknown
 * publishedAt are kept (we don't have evidence they're stale).
 */
function filterFreshTopics(topics: TrendingTopic[], cacheKey: string): TrendingTopic[] {
  const cutoff = Date.now() - TRENDING_FRESH_MS;
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
    console.log(`[TrendingCache] 🧹 Filtered ${dropped} stale topic(s) (>24h) for ${cacheKey}`);
  }
  return fresh;
}

/**
 * Hit Perplexity, apply the freshness filter, and persist a successful result
 * into both the in-memory and PostgreSQL caches. Returns the topics actually
 * stored. Empty results are cached only with the short empty TTL — they never
 * get promoted to the long persistent cache (so we'll retry quickly).
 */
async function fetchAndStoreTrending(
  category: TrendingCategory,
  location: string | undefined,
  cacheKey: string,
): Promise<TrendingTopic[]> {
  const persistentKey = `trending:${cacheKey}`;
  const now = Date.now();

  let rawTopics: TrendingTopic[];
  let usedFallback = false;

  if (isProviderInCooldown('perplexity')) {
    // Primary provider in cool-down — go straight to free RSS fallback.
    console.log(`[TrendingCache] ⏸ Perplexity in cool-down for ${cacheKey}, using RSS fallback`);
    rawTopics = await fetchGoogleNewsFallback(category);
    usedFallback = true;
  } else {
    try {
      rawTopics = await getTrendingTopics(category, location);
    } catch (err) {
      if (isQuotaError(err)) {
        const msg = err instanceof Error ? err.message.slice(0, 120) : String(err);
        setProviderCooldown('perplexity', msg);
        console.log(`[TrendingCache] ⚡ Quota error for ${cacheKey}, activating RSS fallback`);
        rawTopics = await fetchGoogleNewsFallback(category);
        usedFallback = true;
      } else {
        throw err;
      }
    }
  }

  const topics = filterFreshTopics(rawTopics, cacheKey);

  if (topics.length > 0) {
    trendingCache.set(cacheKey, {
      category: cacheKey,
      topics,
      cachedAt: now,
      isEmpty: false,
    });
    failedAttempts.delete(cacheKey);
    if (!usedFallback) {
      await PersistentCache.set(persistentKey, { topics, cachedAt: now }, 'trending', TRENDING_CACHE_TTL_SECONDS);
      console.log(`[TrendingCache] ✅ Cached ${cacheKey} (${topics.length} topics, from ${rawTopics.length} raw) - persisted to DB`);
    } else {
      console.log(`[TrendingCache] ✅ Cached ${cacheKey} via RSS fallback (${topics.length} topics) — not persisted to DB`);
    }
  } else {
    // Cache empty result with the short TTL so we don't hammer the API, but
    // do NOT touch the persistent cache (would lock in the empty result for 6h).
    trendingCache.set(cacheKey, {
      category: cacheKey,
      topics: [],
      cachedAt: now,
      isEmpty: true,
    });
    console.log(`[TrendingCache] ⚠️ Empty result for ${cacheKey}, cached with short TTL (no DB write)`);
  }

  return topics;
}

/**
 * Schedule a deduped background refresh for a cache key without making the
 * caller wait. Concurrent triggers share the same in-flight promise.
 */
function refreshTrendingInBackground(category: TrendingCategory, location: string | undefined, cacheKey: string): void {
  if (inFlightRefreshes.has(cacheKey)) return;
  console.log(`[TrendingCache] 🔁 SWR background refresh kicked off for ${cacheKey}`);
  const refreshPromise = fetchAndStoreTrending(category, location, cacheKey)
    .catch((err) => {
      console.error(`[TrendingCache] Background refresh failed for ${cacheKey}:`, err);
      return [] as TrendingTopic[];
    })
    .finally(() => {
      inFlightRefreshes.delete(cacheKey);
    });
  inFlightRefreshes.set(cacheKey, refreshPromise);
}

export interface CachedTrendingResult {
  topics: TrendingTopic[];
  lastUpdated: string;
  /**
   * Set when the latest fresh-fetch attempt failed (e.g. provider quota
   * exhausted, rate limited, network). May be present alongside non-empty
   * `topics` when we're returning stale cache after a failed refresh — the
   * UI can use this to indicate "data may be stale".
   */
  error?: string;
}

export async function getTrendingTopicsCached(
  category: TrendingCategory,
  location?: string,
): Promise<CachedTrendingResult> {
  const cacheKey = buildCacheKey(category, location);
  const cached = trendingCache.get(cacheKey);
  const now = Date.now();

  // Hot path: in-memory hit, decide whether to also fire SWR.
  if (cached) {
    const ttl = cached.isEmpty ? EMPTY_RESULT_TTL : TRENDING_CACHE_TTL;
    if (now - cached.cachedAt < ttl) {
      if (!cached.isEmpty) {
        const age = now - cached.cachedAt;
        if (age >= TRENDING_SWR_THRESHOLD) {
          console.log(`[TrendingCache] 🟡 SWR HIT for ${cacheKey} (age=${Math.round(age / 60000)}m, ${cached.topics.length} topics)`);
          refreshTrendingInBackground(category, location, cacheKey);
        } else {
          console.log(`[TrendingCache] 🟢 CACHE HIT for ${cacheKey} (${cached.topics.length} topics)`);
        }
      } else {
        console.log(`[TrendingCache] 🟡 CACHE HIT (empty result, will retry soon) for ${cacheKey}`);
      }
      return { topics: cached.topics, lastUpdated: new Date(cached.cachedAt).toISOString() };
    }
  }

  // Check if we're in a retry delay period after failures
  const failedAttempt = failedAttempts.get(cacheKey);
  if (failedAttempt && now - failedAttempt.failedAt < FAILED_RETRY_DELAY) {
    if (failedAttempt.retryCount >= MAX_RETRY_COUNT) {
      const retryError = failedAttempt.lastError || 'Provider unavailable after repeated failures';
      if (cached && cached.topics.length > 0) {
        console.log(`[TrendingCache] 🔴 Max retries reached for ${cacheKey}, returning stale cache (${cached.topics.length} topics)`);
        return { topics: cached.topics, lastUpdated: new Date(cached.cachedAt).toISOString(), error: retryError };
      }
      console.log(`[TrendingCache] 🔴 Max retries reached for ${cacheKey}, no cache available`);
      return { topics: [], lastUpdated: new Date().toISOString(), error: retryError };
    }
  }

  console.log(`[TrendingCache] 🔵 CACHE MISS or expired for ${cacheKey}, checking PersistentCache...`);

  // Check PersistentCache (PostgreSQL) before making API call
  const persistentKey = `trending:${cacheKey}`;
  const persistedData = await PersistentCache.get<{ topics: TrendingTopic[]; cachedAt: number }>(persistentKey);

  if (persistedData && persistedData.topics.length > 0) {
    // Reapply the 24h freshness filter on the persisted set so a long-lived
    // entry doesn't keep serving stale items just because it lives in the DB.
    const fresh = filterFreshTopics(persistedData.topics, cacheKey);
    trendingCache.set(cacheKey, {
      category: cacheKey,
      topics: fresh,
      cachedAt: persistedData.cachedAt,
      isEmpty: fresh.length === 0,
    });
    console.log(`[TrendingCache] 🟣 PERSISTENT CACHE HIT for ${cacheKey} (${fresh.length} topics, age=${Math.round((now - persistedData.cachedAt) / 60000)}m)`);

    if (fresh.length > 0) {
      // If the DB-loaded entry is older than the SWR threshold, refresh it in
      // the background so the next reader sees fresh content.
      if (now - persistedData.cachedAt >= TRENDING_SWR_THRESHOLD) {
        refreshTrendingInBackground(category, location, cacheKey);
      }
      return { topics: fresh, lastUpdated: new Date(persistedData.cachedAt).toISOString() };
    }
  }

  console.log(`[TrendingCache] 🔵 No persistent cache, fetching fresh for ${cacheKey}...`);

  // Dedupe with any background refresh that's already running for this key.
  const inFlight = inFlightRefreshes.get(cacheKey);
  if (inFlight) {
    try {
      const topics = await inFlight;
      const stamped = trendingCache.get(cacheKey)?.cachedAt ?? Date.now();
      return { topics, lastUpdated: new Date(stamped).toISOString() };
    } catch {
      // Fall through and try a real fetch below.
    }
  }

  try {
    const refreshPromise = fetchAndStoreTrending(category, location, cacheKey).finally(() => {
      inFlightRefreshes.delete(cacheKey);
    });
    inFlightRefreshes.set(cacheKey, refreshPromise);
    const topics = await refreshPromise;
    const stamped = trendingCache.get(cacheKey)?.cachedAt ?? Date.now();
    return { topics, lastUpdated: new Date(stamped).toISOString() };
  } catch (error) {
    console.error(`[TrendingCache] ❌ Error fetching ${cacheKey}:`, error);
    const message = error instanceof Error ? error.message : String(error);

    const existing = failedAttempts.get(cacheKey);
    const retryCount = (existing?.retryCount || 0) + 1;
    failedAttempts.set(cacheKey, {
      failedAt: now,
      retryCount,
      lastError: message,
    });

    logger.warn('Trending topics provider failure', {
      cacheKey,
      category,
      location,
      retryCount,
      hasStaleCache: Boolean(cached),
      error: message,
    });

    if (cached) {
      console.log(`[TrendingCache] 🔄 Returning stale cache for ${cacheKey} after error`);
      return { topics: cached.topics, lastUpdated: new Date(cached.cachedAt).toISOString(), error: message };
    }

    return { topics: [], lastUpdated: new Date().toISOString(), error: message };
  }
}

/**
 * Used by the background warmer. Refreshes the cache for a single
 * (category, location) pair unless it was already refreshed within the last
 * hour. Returns a small status object for logging. Importantly, this also
 * consults PostgreSQL via PersistentCache so that immediately after a
 * server restart we don't blindly re-fetch every key from Perplexity when
 * the DB still has fresh entries.
 */
export async function warmTrendingTopic(
  category: TrendingCategory,
  location?: string,
): Promise<{ key: string; skipped: boolean; topics: number; ageMinutes: number | null }> {
  const cacheKey = buildCacheKey(category, location);
  const now = Date.now();

  // 1) In-memory hit that's still fresh enough — skip without any I/O.
  const cached = trendingCache.get(cacheKey);
  if (cached && !cached.isEmpty && now - cached.cachedAt < WARMER_SKIP_FRESH_MS) {
    return {
      key: cacheKey,
      skipped: true,
      topics: cached.topics.length,
      ageMinutes: Math.round((now - cached.cachedAt) / 60000),
    };
  }

  // 2) On cold restart the in-memory cache is empty but the DB may still
  //    have a fresh entry. Hydrate from PersistentCache and skip if recent.
  const persistentKey = `trending:${cacheKey}`;
  const persistedData = await PersistentCache.get<{ topics: TrendingTopic[]; cachedAt: number }>(persistentKey);
  if (persistedData && persistedData.topics.length > 0) {
    const persistedAge = now - persistedData.cachedAt;
    if (persistedAge < WARMER_SKIP_FRESH_MS) {
      const fresh = filterFreshTopics(persistedData.topics, cacheKey);
      trendingCache.set(cacheKey, {
        category: cacheKey,
        topics: fresh,
        cachedAt: persistedData.cachedAt,
        isEmpty: fresh.length === 0,
      });
      return {
        key: cacheKey,
        skipped: true,
        topics: fresh.length,
        ageMinutes: Math.round(persistedAge / 60000),
      };
    }
  }

  const ageMinutes = cached ? Math.round((now - cached.cachedAt) / 60000) : null;

  // Avoid double-firing if a SWR refresh is already running.
  const existing = inFlightRefreshes.get(cacheKey);
  if (existing) {
    const topics = await existing;
    return { key: cacheKey, skipped: false, topics: topics.length, ageMinutes };
  }

  const refreshPromise = fetchAndStoreTrending(category, location, cacheKey).finally(() => {
    inFlightRefreshes.delete(cacheKey);
  });
  inFlightRefreshes.set(cacheKey, refreshPromise);
  const topics = await refreshPromise;
  return { key: cacheKey, skipped: false, topics: topics.length, ageMinutes };
}

export function clearTrendingCache(): void {
  trendingCache.clear();
  failedAttempts.clear();
  console.log('[TrendingCache] ✅ Cache cleared');
}

export function getTrendingCacheStats(): Record<string, any> {
  return {
    entriesCount: trendingCache.size,
    failedAttemptsCount: failedAttempts.size,
    inFlightCount: inFlightRefreshes.size,
    entries: Array.from(trendingCache.entries()).map(([key, value]) => ({
      category: key,
      topicsCount: value.topics.length,
      isEmpty: value.isEmpty,
      age: Date.now() - value.cachedAt,
      ageSeconds: Math.round((Date.now() - value.cachedAt) / 1000)
    })),
    failedAttempts: Array.from(failedAttempts.entries()).map(([key, value]) => ({
      category: key,
      retryCount: value.retryCount,
      failedAgoSeconds: Math.round((Date.now() - value.failedAt) / 1000)
    }))
  };
}
