import crypto from 'crypto';
import { enhanceTopicWithContext as enhanceTopicWithContextOriginal } from '../perplexity';

interface CachedContext {
  topic: string;
  category: string;
  timeFrame?: string;
  result: any;
  cachedAt: number;
}

const contextCache = new Map<string, CachedContext>();

// Dynamic TTL based on template category and timeframe
// News/events with past24h need fresh data - use 1 hour max
function getContextCacheTTL(category: string, timeFrame?: string): number {
  const isNewsOrEvents = ['news', 'events', 'sports'].includes(category);
  // Default to past24h for news templates if timeFrame not specified
  const effectiveTimeFrame = isNewsOrEvents && !timeFrame ? 'past24h' : timeFrame;
  const isBreakingNews = ['24h', 'past24h'].includes(effectiveTimeFrame || '');
  
  if (isNewsOrEvents && isBreakingNews) {
    return 1 * 60 * 60 * 1000; // 1 hour for breaking news (match ResearchCache)
  }
  if (isNewsOrEvents) {
    return 4 * 60 * 60 * 1000; // 4 hours for other news timeframes
  }
  return 24 * 60 * 60 * 1000; // 24 hours for non-news content
}

function hashTopicContext(topic: string, category: string, timeFrame?: string): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ topic, category, timeFrame }))
    .digest('hex')
    .substring(0, 16);
}

// Auto-cleanup expired entries every 2 hours (more frequent for news freshness)
setInterval(() => {
  const now = Date.now();
  const expired: string[] = [];
  
  Array.from(contextCache.entries()).forEach(([key, value]) => {
    const ttl = getContextCacheTTL(value.category, value.timeFrame);
    if (now - value.cachedAt > ttl) {
      expired.push(key);
    }
  });
  
  expired.forEach(key => contextCache.delete(key));
  if (expired.length > 0) {
    console.log(`[ContextCache] Cleaned up ${expired.length} expired entries`);
  }
}, 2 * 60 * 60 * 1000);

export async function enhanceTopicWithContextCached(
  topic: string,
  category: string,
  timeFrame?: string
): Promise<any> {
  const hash = hashTopicContext(topic, category, timeFrame);
  const cached = contextCache.get(hash);
  const cacheTTL = getContextCacheTTL(category, timeFrame);
  
  if (cached && Date.now() - cached.cachedAt < cacheTTL) {
    const ttlHours = Math.round(cacheTTL / (60 * 60 * 1000));
    console.log(`[ContextCache] 🟢 CACHE HIT for context hash: ${hash} (${category}, ${timeFrame || 'default'}, TTL: ${ttlHours}h)`);
    return cached.result;
  }
  
  console.log(`[ContextCache] 🔵 CACHE MISS, generating context for: "${topic.substring(0, 40)}..." (${category}, ${timeFrame || 'default'})`);
  const result = await enhanceTopicWithContextOriginal(topic, category);
  
  contextCache.set(hash, {
    topic,
    category,
    timeFrame,
    result,
    cachedAt: Date.now()
  });
  
  const ttlHours = Math.round(cacheTTL / (60 * 60 * 1000));
  console.log(`[ContextCache] ✅ Cached context for: "${topic.substring(0, 40)}..." (TTL: ${ttlHours}h)`);
  return result;
}

export function clearContextCache(): void {
  contextCache.clear();
  console.log('[ContextCache] ✅ Cache cleared');
}

export function getContextCacheStats(): Record<string, any> {
  return {
    entriesCount: contextCache.size,
    entries: Array.from(contextCache.entries()).map(([key, value]) => ({
      topic: value.topic.substring(0, 50),
      category: value.category,
      timeFrame: value.timeFrame,
      age: Date.now() - value.cachedAt,
      ageSeconds: Math.round((Date.now() - value.cachedAt) / 1000)
    }))
  };
}
