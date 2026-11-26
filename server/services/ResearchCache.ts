import { gatherRealTimeContent } from '../perplexity';
import * as PersistentCache from './PersistentCache';

interface ResearchResult {
  content: string;
  citations: string[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
import type { GenerationParams } from '@shared/schema';

interface CachedResearch {
  topic: string;
  content: string;
  citations: string[];
  timeFrame: string;
  cachedAt: number;
}

const researchCache = new Map<string, CachedResearch>();

// Determine TTL based on timeframe
function getResearchCacheTTL(timeFrame: string): number {
  switch (timeFrame) {
    case '24h':
    case 'past24h':
      return 1 * 60 * 60 * 1000; // 1 hour for breaking news (stricter for freshness)
    case 'week':
    case 'pastWeek':
      return 4 * 60 * 60 * 1000; // 4 hours for weekly news
    case 'month':
    case 'pastMonth':
      return 8 * 60 * 60 * 1000; // 8 hours for monthly news
    case 'all':
    case 'allTime':
      return 12 * 60 * 60 * 1000; // 12 hours for general research
    default:
      return 8 * 60 * 60 * 1000; // Default to 8 hours
  }
}

// Auto-cleanup expired entries every 2 hours
setInterval(() => {
  const now = Date.now();
  const expired: string[] = [];
  
  Array.from(researchCache.entries()).forEach(([key, value]) => {
    const ttl = getResearchCacheTTL(value.timeFrame);
    if (now - value.cachedAt > ttl) {
      expired.push(key);
    }
  });
  
  expired.forEach(key => researchCache.delete(key));
  if (expired.length > 0) {
    console.log(`[ResearchCache] Cleaned up ${expired.length} expired entries`);
  }
}, 2 * 60 * 60 * 1000);

export async function gatherRealTimeContentCached(
  topic: string,
  params: GenerationParams
): Promise<ResearchResult> {
  const locationKey = params.locationEnabled && params.locationCity 
    ? `|loc:${params.locationCity}` 
    : '';
  const cacheKey = `${topic}|${params.timeFrame || 'month'}|${params.templateCategory || 'custom'}|dur:${params.durationMinutes || 10}${locationKey}`;
  const cached = researchCache.get(cacheKey);
  
  const cacheTTL = getResearchCacheTTL(params.timeFrame || 'month');
  
  if (cached && Date.now() - cached.cachedAt < cacheTTL) {
    console.log(`[ResearchCache] 🟢 CACHE HIT for topic: "${topic.substring(0, 40)}..." (${params.timeFrame})`);
    return {
      content: cached.content,
      citations: cached.citations,
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    };
  }
  
  console.log(`[ResearchCache] 🔵 CACHE MISS for topic: "${topic.substring(0, 40)}..." (${params.timeFrame}), checking PersistentCache...`);
  
  // Check PersistentCache (PostgreSQL) before making API call
  const persistentKey = `research:${cacheKey}`;
  const persistedData = await PersistentCache.get<CachedResearch>(persistentKey);
  
  if (persistedData && persistedData.content) {
    // Found in PersistentCache - populate memory cache and return
    researchCache.set(cacheKey, persistedData);
    console.log(`[ResearchCache] 🟣 PERSISTENT CACHE HIT for topic: "${topic.substring(0, 40)}..."`);
    return {
      content: persistedData.content,
      citations: persistedData.citations,
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    };
  }
  
  console.log(`[ResearchCache] 🔵 No persistent cache, fetching fresh for: "${topic.substring(0, 40)}..."`);
  const result = await gatherRealTimeContent(topic, params);
  
  const cacheData: CachedResearch = {
    topic,
    content: result.content,
    citations: result.citations,
    timeFrame: params.timeFrame || 'month',
    cachedAt: Date.now()
  };
  
  researchCache.set(cacheKey, cacheData);
  
  // Persist to PostgreSQL (convert TTL from ms to seconds)
  const ttlSeconds = Math.floor(cacheTTL / 1000);
  await PersistentCache.set(persistentKey, cacheData, 'research', ttlSeconds);
  
  console.log(`[ResearchCache] ✅ Cached research for: "${topic.substring(0, 40)}..." - persisted to DB`);
  return result;
}

export function clearResearchCache(): void {
  researchCache.clear();
  console.log('[ResearchCache] ✅ Cache cleared');
}

export function getResearchCacheStats(): Record<string, any> {
  return {
    entriesCount: researchCache.size,
    entries: Array.from(researchCache.entries()).map(([key, value]) => ({
      topic: value.topic.substring(0, 50),
      timeFrame: value.timeFrame,
      age: Date.now() - value.cachedAt,
      ageSeconds: Math.round((Date.now() - value.cachedAt) / 1000)
    }))
  };
}
