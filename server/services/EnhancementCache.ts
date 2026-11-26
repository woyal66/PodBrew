import crypto from 'crypto';
import { enhanceTopic as enhanceTopicOriginal } from '../openai';

interface EnhancedTopic {
  original: string;
  enhanced: string;
  params: Record<string, any>;
  cachedAt: number;
}

const enhancementCache = new Map<string, EnhancedTopic>();

// Dynamic TTL based on template category and timeframe
// News/events with past24h need fresh data - use 1 hour max
function getEnhancementCacheTTL(templateCategory?: string, timeFrame?: string): number {
  const isNewsOrEvents = ['news', 'events', 'sports'].includes(templateCategory || '');
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

function hashTopic(topic: string, params: Record<string, any>): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ topic, params }))
    .digest('hex')
    .substring(0, 16);
}

// Auto-cleanup expired entries every 2 hours (more frequent for news freshness)
setInterval(() => {
  const now = Date.now();
  const expired: string[] = [];
  
  Array.from(enhancementCache.entries()).forEach(([key, value]) => {
    const ttl = getEnhancementCacheTTL(value.params.templateCategory, value.params.timeFrame);
    if (now - value.cachedAt > ttl) {
      expired.push(key);
    }
  });
  
  expired.forEach(key => enhancementCache.delete(key));
  if (expired.length > 0) {
    console.log(`[EnhancementCache] Cleaned up ${expired.length} expired entries`);
  }
}, 2 * 60 * 60 * 1000);

export async function enhanceTopicCached(
  topic: string,
  style: string | undefined,
  complexity: number | undefined,
  numPeople: number | undefined,
  timeFrame: string | undefined,
  coHostPersonality: string | undefined,
  templateCategory: string | undefined
): Promise<string> {
  const params = { style, complexity, numPeople, timeFrame, coHostPersonality, templateCategory };
  const hash = hashTopic(topic, params);
  
  const cached = enhancementCache.get(hash);
  const cacheTTL = getEnhancementCacheTTL(templateCategory, timeFrame);
  
  if (cached && Date.now() - cached.cachedAt < cacheTTL) {
    const ttlHours = Math.round(cacheTTL / (60 * 60 * 1000));
    console.log(`[EnhancementCache] 🟢 CACHE HIT for topic hash: ${hash} (${templateCategory || 'custom'}, ${timeFrame || 'default'}, TTL: ${ttlHours}h)`);
    return cached.enhanced;
  }
  
  console.log(`[EnhancementCache] 🔵 CACHE MISS, generating enhancement for: "${topic.substring(0, 40)}..." (${templateCategory || 'custom'}, ${timeFrame || 'default'})`);
  const enhanced = await enhanceTopicOriginal(
    topic,
    (style || 'conversational') as any,
    complexity || 5,
    numPeople || 2,
    (timeFrame || 'pastMonth') as any,
    (coHostPersonality || 'casual') as any,
    templateCategory || 'custom'
  );
  
  enhancementCache.set(hash, {
    original: topic,
    enhanced,
    params,
    cachedAt: Date.now()
  });
  
  const ttlHours = Math.round(cacheTTL / (60 * 60 * 1000));
  console.log(`[EnhancementCache] ✅ Cached enhancement for: "${topic.substring(0, 40)}..." (TTL: ${ttlHours}h)`);
  return enhanced;
}

export function clearEnhancementCache(): void {
  enhancementCache.clear();
  console.log('[EnhancementCache] ✅ Cache cleared');
}

export function getEnhancementCacheStats(): Record<string, any> {
  return {
    entriesCount: enhancementCache.size,
    entries: Array.from(enhancementCache.entries()).map(([key, value]) => ({
      topic: value.original.substring(0, 50),
      templateCategory: value.params.templateCategory,
      timeFrame: value.params.timeFrame,
      age: Date.now() - value.cachedAt,
      ageSeconds: Math.round((Date.now() - value.cachedAt) / 1000)
    }))
  };
}
