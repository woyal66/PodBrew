interface CachedTranscript {
  id: string;
  sourceType: 'youtube' | 'podcast' | 'spotify';
  sourceId: string;
  title: string;
  transcript: string;
  wordCount: number;
  duration?: number;
  language?: string;
  method: string;
  metadata: {
    show?: string;
    channel?: string;
    publishedAt?: string;
    thumbnailUrl?: string;
    audioUrl?: string;
  };
  createdAt: Date;
  accessedAt: Date;
  accessCount: number;
}

interface TranscriptCacheStats {
  totalItems: number;
  byType: {
    youtube: number;
    podcast: number;
    spotify: number;
  };
  totalWords: number;
  hitRate: number;
  oldestEntry: Date | null;
  newestEntry: Date | null;
}

const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHE_SIZE = 100;

class TranscriptCache {
  private cache = new Map<string, CachedTranscript>();
  private hits = 0;
  private misses = 0;

  constructor() {
    setInterval(() => this.cleanup(), 60 * 60 * 1000);
  }

  private generateKey(sourceType: string, sourceId: string): string {
    return `${sourceType}:${sourceId}`;
  }

  private normalizeSourceId(sourceType: string, url: string): string {
    if (sourceType === 'youtube') {
      const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      return match ? match[1] : url;
    }
    
    if (sourceType === 'spotify') {
      const match = url.match(/episode\/([a-zA-Z0-9]+)/);
      return match ? match[1] : url;
    }
    
    return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }

  get(sourceType: 'youtube' | 'podcast' | 'spotify', sourceIdOrUrl: string): CachedTranscript | null {
    const sourceId = this.normalizeSourceId(sourceType, sourceIdOrUrl);
    const key = this.generateKey(sourceType, sourceId);
    const cached = this.cache.get(key);

    if (cached) {
      if (Date.now() - cached.createdAt.getTime() > CACHE_EXPIRY_MS) {
        console.log(`[TranscriptCache] Expired entry removed: ${key}`);
        this.cache.delete(key);
        this.misses++;
        return null;
      }

      cached.accessedAt = new Date();
      cached.accessCount++;
      this.hits++;
      console.log(`[TranscriptCache] HIT: ${key} (${cached.wordCount} words, accessed ${cached.accessCount} times)`);
      return cached;
    }

    this.misses++;
    console.log(`[TranscriptCache] MISS: ${key}`);
    return null;
  }

  set(
    sourceType: 'youtube' | 'podcast' | 'spotify',
    sourceIdOrUrl: string,
    data: {
      title: string;
      transcript: string;
      duration?: number;
      language?: string;
      method: string;
      metadata?: CachedTranscript['metadata'];
    }
  ): CachedTranscript {
    const sourceId = this.normalizeSourceId(sourceType, sourceIdOrUrl);
    const key = this.generateKey(sourceType, sourceId);

    if (this.cache.size >= MAX_CACHE_SIZE) {
      this.evictLeastRecentlyUsed();
    }

    const entry: CachedTranscript = {
      id: key,
      sourceType,
      sourceId,
      title: data.title,
      transcript: data.transcript,
      wordCount: data.transcript.split(/\s+/).length,
      duration: data.duration,
      language: data.language,
      method: data.method,
      metadata: data.metadata || {},
      createdAt: new Date(),
      accessedAt: new Date(),
      accessCount: 1
    };

    this.cache.set(key, entry);
    console.log(`[TranscriptCache] STORED: ${key} (${entry.wordCount} words, method: ${data.method})`);
    
    return entry;
  }

  has(sourceType: 'youtube' | 'podcast' | 'spotify', sourceIdOrUrl: string): boolean {
    const sourceId = this.normalizeSourceId(sourceType, sourceIdOrUrl);
    const key = this.generateKey(sourceType, sourceId);
    const cached = this.cache.get(key);
    
    if (!cached) return false;
    
    if (Date.now() - cached.createdAt.getTime() > CACHE_EXPIRY_MS) {
      this.cache.delete(key);
      return false;
    }
    
    return true;
  }

  delete(sourceType: 'youtube' | 'podcast' | 'spotify', sourceIdOrUrl: string): boolean {
    const sourceId = this.normalizeSourceId(sourceType, sourceIdOrUrl);
    const key = this.generateKey(sourceType, sourceId);
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    console.log('[TranscriptCache] Cache cleared');
  }

  private evictLeastRecentlyUsed(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    const entries = Array.from(this.cache.entries());
    for (let i = 0; i < entries.length; i++) {
      const [key, entry] = entries[i];
      const accessTime = entry.accessedAt.getTime();
      if (accessTime < oldestTime) {
        oldestTime = accessTime;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      console.log(`[TranscriptCache] Evicted LRU entry: ${oldestKey}`);
    }
  }

  private cleanup(): void {
    const now = Date.now();
    let removed = 0;

    const entries = Array.from(this.cache.entries());
    for (let i = 0; i < entries.length; i++) {
      const [key, entry] = entries[i];
      if (now - entry.createdAt.getTime() > CACHE_EXPIRY_MS) {
        this.cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      console.log(`[TranscriptCache] Cleanup: removed ${removed} expired entries`);
    }
  }

  getStats(): TranscriptCacheStats {
    const entries = Array.from(this.cache.values());
    const totalHits = this.hits + this.misses;

    return {
      totalItems: entries.length,
      byType: {
        youtube: entries.filter(e => e.sourceType === 'youtube').length,
        podcast: entries.filter(e => e.sourceType === 'podcast').length,
        spotify: entries.filter(e => e.sourceType === 'spotify').length
      },
      totalWords: entries.reduce((sum, e) => sum + e.wordCount, 0),
      hitRate: totalHits > 0 ? this.hits / totalHits : 0,
      oldestEntry: entries.length > 0 
        ? new Date(Math.min(...entries.map(e => e.createdAt.getTime())))
        : null,
      newestEntry: entries.length > 0 
        ? new Date(Math.max(...entries.map(e => e.createdAt.getTime())))
        : null
    };
  }

  getAllEntries(): CachedTranscript[] {
    return Array.from(this.cache.values());
  }
}

export const transcriptCache = new TranscriptCache();
export type { CachedTranscript, TranscriptCacheStats };
