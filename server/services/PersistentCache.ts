import { db } from '../db';
import { cacheEntries } from '@shared/schema';
import { eq, lt } from 'drizzle-orm';

interface CacheValue {
  data: any;
  cachedAt: number;
  expiresAt: number;
}

const memoryCache = new Map<string, CacheValue>();

const TTL_DEFAULTS: Record<string, number> = {
  research: 24 * 60 * 60, // 24 hours
  trending: 6 * 60 * 60,  // 6 hours
  events: 12 * 60 * 60,   // 12 hours
  coverart: 7 * 24 * 60 * 60, // 7 days
};

let isWarmed = false;

export async function warmCache(): Promise<void> {
  if (isWarmed) return;
  
  try {
    const now = new Date();
    const validEntries = await db.select().from(cacheEntries);
    let loaded = 0;
    let expired = 0;
    
    for (const entry of validEntries) {
      const expiresAt = new Date(entry.expiresAt).getTime();
      if (expiresAt > now.getTime()) {
        memoryCache.set(entry.key, {
          data: entry.value,
          cachedAt: new Date(entry.createdAt).getTime(),
          expiresAt,
        });
        loaded++;
      } else {
        expired++;
      }
    }
    
    if (expired > 0) {
      await db.delete(cacheEntries).where(lt(cacheEntries.expiresAt, now));
      console.log(`[PersistentCache] Cleaned ${expired} expired entries`);
    }
    
    isWarmed = true;
    console.log(`[PersistentCache] ✅ Warmed with ${loaded} entries from database`);
  } catch (error) {
    console.error('[PersistentCache] ❌ Failed to warm cache:', error);
  }
}

export async function get<T>(key: string): Promise<T | null> {
  const now = Date.now();
  
  const cached = memoryCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.data as T;
  }
  
  if (cached) {
    memoryCache.delete(key);
  }
  
  try {
    const [entry] = await db.select().from(cacheEntries).where(eq(cacheEntries.key, key)).limit(1);
    
    if (entry) {
      const expiresAt = new Date(entry.expiresAt).getTime();
      if (expiresAt > now) {
        memoryCache.set(key, {
          data: entry.value,
          cachedAt: new Date(entry.createdAt).getTime(),
          expiresAt,
        });
        return entry.value as T;
      } else {
        await db.delete(cacheEntries).where(eq(cacheEntries.key, key));
      }
    }
  } catch (error) {
    console.error(`[PersistentCache] Error reading key ${key}:`, error);
  }
  
  return null;
}

export async function set(key: string, value: any, category: string, ttlSeconds?: number): Promise<void> {
  const ttl = ttlSeconds ?? TTL_DEFAULTS[category] ?? 3600;
  const now = Date.now();
  const expiresAt = new Date(now + ttl * 1000);
  
  memoryCache.set(key, {
    data: value,
    cachedAt: now,
    expiresAt: expiresAt.getTime(),
  });
  
  setImmediate(async () => {
    try {
      await db.insert(cacheEntries)
        .values({
          key,
          value,
          category,
          ttlSeconds: ttl,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: cacheEntries.key,
          set: {
            value,
            category,
            ttlSeconds: ttl,
            expiresAt,
            createdAt: new Date(),
          },
        });
    } catch (error) {
      console.error(`[PersistentCache] Error persisting key ${key}:`, error);
    }
  });
}

export async function del(key: string): Promise<void> {
  memoryCache.delete(key);
  
  try {
    await db.delete(cacheEntries).where(eq(cacheEntries.key, key));
  } catch (error) {
    console.error(`[PersistentCache] Error deleting key ${key}:`, error);
  }
}

export async function clearCategory(category: string): Promise<number> {
  let count = 0;
  
  const entries = Array.from(memoryCache.entries());
  for (const [key, _value] of entries) {
    const cached = await db.select().from(cacheEntries).where(eq(cacheEntries.key, key)).limit(1);
    if (cached.length > 0 && cached[0].category === category) {
      memoryCache.delete(key);
      count++;
    }
  }
  
  try {
    const result = await db.delete(cacheEntries).where(eq(cacheEntries.category, category));
    console.log(`[PersistentCache] Cleared category '${category}'`);
  } catch (error) {
    console.error(`[PersistentCache] Error clearing category ${category}:`, error);
  }
  
  return count;
}

export async function cleanupExpired(): Promise<number> {
  const now = new Date();
  let cleaned = 0;
  
  const entries = Array.from(memoryCache.entries());
  for (const [key, value] of entries) {
    if (value.expiresAt <= now.getTime()) {
      memoryCache.delete(key);
      cleaned++;
    }
  }
  
  try {
    await db.delete(cacheEntries).where(lt(cacheEntries.expiresAt, now));
  } catch (error) {
    console.error('[PersistentCache] Error cleaning expired entries:', error);
  }
  
  if (cleaned > 0) {
    console.log(`[PersistentCache] Cleaned ${cleaned} expired entries`);
  }
  
  return cleaned;
}

export async function getStats(): Promise<{ memoryEntries: number; categories: Record<string, number> }> {
  const categories: Record<string, number> = {};
  
  try {
    const entries = await db.select().from(cacheEntries);
    for (const entry of entries) {
      categories[entry.category] = (categories[entry.category] || 0) + 1;
    }
  } catch (error) {
    console.error('[PersistentCache] Error getting stats:', error);
  }
  
  return {
    memoryEntries: memoryCache.size,
    categories,
  };
}

setInterval(() => {
  cleanupExpired();
}, 60 * 60 * 1000);

console.log('[PersistentCache] Service initialized');
