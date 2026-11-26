/**
 * LyriaMusic - AI-generated background music for podcasts
 * Uses Google Lyria 3 Clip model via the Gemini API
 *
 * Model: lyria-3-clip-preview → always 30-second MP3 clips
 * Cost: ~$0.04 / clip
 * Caching: In-memory LRU + object-storage persistence keyed on prompt hash
 */

import { GoogleGenAI } from '@google/genai';
import * as crypto from 'crypto';
import { ObjectStorageService } from '../objectStorage';

// -----------------------------------------------------------------------
// Feature flag
// -----------------------------------------------------------------------
export function isMusicEnabled(): boolean {
  const flag = process.env.LYRIA_MUSIC_ENABLED;
  return flag === undefined || flag === 'true' || flag === '1';
}

// -----------------------------------------------------------------------
// Music style definitions — 8 presets mapped to Lyria 3 prompts
// -----------------------------------------------------------------------
export const MUSIC_STYLES = {
  none: {
    id: 'none',
    label: 'No Music',
    description: 'Silent — no intro or outro music',
    prompt: '',
  },
  ambient: {
    id: 'ambient',
    label: 'Calm Ambient',
    description: 'Relaxed, atmospheric background',
    prompt:
      'Instrumental ambient podcast background music, soft synthesizer pads, gentle piano, ' +
      'calm and soothing, no vocals, no percussion, 30 seconds, professional quality.',
  },
  news: {
    id: 'news',
    label: 'News Broadcast',
    description: 'Professional news-style underscore',
    prompt:
      'Professional news broadcast background music, orchestral strings and piano, ' +
      'authoritative and informative, moderate tempo 110bpm, no vocals, 30 seconds.',
  },
  upbeat: {
    id: 'upbeat',
    label: 'Upbeat Electronic',
    description: 'Energetic, modern production feel',
    prompt:
      'Upbeat electronic podcast intro music, modern synth bass, punchy percussion, ' +
      'energetic and dynamic, 128bpm, no vocals, 30 seconds, professional podcast quality.',
  },
  cinematic: {
    id: 'cinematic',
    label: 'Cinematic',
    description: 'Epic orchestral, big and dramatic',
    prompt:
      'Cinematic orchestral podcast intro, full orchestra with brass and strings, ' +
      'epic and dramatic, building energy, no vocals, 30 seconds.',
  },
  jazz: {
    id: 'jazz',
    label: 'Smooth Jazz',
    description: 'Mellow jazz, sophisticated feel',
    prompt:
      'Smooth jazz podcast background, acoustic bass, jazz piano, light brushed drums, ' +
      'mellow and sophisticated, 95bpm, no vocals, 30 seconds.',
  },
  acoustic: {
    id: 'acoustic',
    label: 'Acoustic Folk',
    description: 'Warm acoustic guitar, friendly tone',
    prompt:
      'Warm acoustic folk podcast intro, fingerpicked acoustic guitar, light percussion, ' +
      'friendly and welcoming, 100bpm, no vocals, 30 seconds.',
  },
  inspiring: {
    id: 'inspiring',
    label: 'Inspiring',
    description: 'Uplifting, motivational feel',
    prompt:
      'Inspiring motivational podcast intro, bright piano melody, gentle strings, ' +
      'uplifting and hopeful, 105bpm, no vocals, 30 seconds.',
  },
} as const;

export type MusicStyleId = keyof typeof MUSIC_STYLES;

// -----------------------------------------------------------------------
// Optional generation context — enriches the Lyria 3 prompt
// -----------------------------------------------------------------------
export interface MusicContext {
  topic?: string;
  template?: string;
  mood?: string;
}

/**
 * Build a context-enriched prompt from a base style + optional context.
 * The additions are appended to the base prompt so the core style is preserved.
 * Caching is keyed on the full resulting prompt, so different contexts
 * for the same style produce distinct (and cached) clips.
 */
function buildContextualPrompt(styleId: MusicStyleId, context?: MusicContext): string {
  const style = MUSIC_STYLES[styleId];
  if (!style || styleId === 'none') return '';
  const base = style.prompt;
  if (!context) return base;

  const additions: string[] = [];

  // Template nuance
  switch (context.template) {
    case 'news':      additions.push('factual and informative broadcast tone'); break;
    case 'stories':   additions.push('narrative storytelling atmosphere'); break;
    case 'teachme':   additions.push('focused educational energy'); break;
    case 'sports':    additions.push('dynamic high-energy sports feel'); break;
    case 'medical':   additions.push('calm reassuring medical tone'); break;
    case 'documents': additions.push('professional corporate underscore'); break;
    case 'events':    additions.push('exciting live-event energy'); break;
  }

  // Mood nuance
  switch (context.mood) {
    case 'uplifting':   additions.push('uplifting positive energy'); break;
    case 'serious':     additions.push('serious authoritative undertone'); break;
    case 'humorous':    additions.push('light playful feel'); break;
    case 'energetic':   additions.push('high energy vibrant drive'); break;
    case 'mysterious':  additions.push('mysterious intriguing atmosphere'); break;
  }

  // Topic hint — strip to first 8 meaningful words to keep the prompt tight
  if (context.topic) {
    const topicWords = context.topic
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 8)
      .join(' ');
    if (topicWords.length > 0) additions.push(`thematically suited for a podcast about ${topicWords}`);
  }

  if (additions.length === 0) return base;
  return `${base} ${additions.join(', ')}.`;
}

// -----------------------------------------------------------------------
// Auto-select music style based on template category
// -----------------------------------------------------------------------
export function defaultMusicStyleForTemplate(template: string): MusicStyleId {
  const map: Record<string, MusicStyleId> = {
    news: 'news',
    sports: 'upbeat',
    stories: 'cinematic',
    teachme: 'inspiring',
    events: 'upbeat',
    medical: 'ambient',
    documents: 'ambient',
    custom: 'ambient',
  };
  return map[template] ?? 'ambient';
}

// -----------------------------------------------------------------------
// LRU in-memory cache (prompt hash → MP3 buffer)
// -----------------------------------------------------------------------
interface CacheEntry {
  buffer: Buffer;
  ts: number;
}

const LRU_MAX = 100;
const LRU_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const lruCache = new Map<string, CacheEntry>();

function promptHash(prompt: string): string {
  return crypto.createHash('sha256').update('lyria3|' + prompt).digest('hex');
}

function lruGet(hash: string): Buffer | null {
  const entry = lruCache.get(hash);
  if (!entry) return null;
  if (Date.now() - entry.ts > LRU_TTL_MS) {
    lruCache.delete(hash);
    return null;
  }
  lruCache.delete(hash);
  lruCache.set(hash, entry); // promote to most-recent
  return entry.buffer;
}

function lruSet(hash: string, buffer: Buffer): void {
  if (lruCache.size >= LRU_MAX) {
    const oldest = lruCache.keys().next().value;
    if (oldest) lruCache.delete(oldest);
  }
  lruCache.set(hash, { buffer, ts: Date.now() });
}

// -----------------------------------------------------------------------
// Object-storage cache helpers
// -----------------------------------------------------------------------
const MUSIC_STORAGE_PREFIX = 'music_cache';

async function loadFromStorage(hash: string): Promise<Buffer | null> {
  try {
    const objectStorage = new ObjectStorageService();
    const path = `${MUSIC_STORAGE_PREFIX}/${hash}.mp3`;
    const exists = await objectStorage.checkObjectExists(path);
    if (!exists) return null;
    const buf = await objectStorage.downloadPublicObjectAsBuffer(path);
    if (buf && buf.length > 0) {
      console.log(`[LyriaMusic] Loaded from object storage: ${hash.slice(0, 12)}...`);
      return buf;
    }
  } catch (err) {
    console.warn('[LyriaMusic] Object storage load failed:', err);
  }
  return null;
}

async function saveToStorage(hash: string, buffer: Buffer): Promise<void> {
  try {
    const objectStorage = new ObjectStorageService();
    const path = `${MUSIC_STORAGE_PREFIX}/${hash}.mp3`;
    await objectStorage.uploadPublicObject(path, buffer, 'audio/mpeg');
    console.log(`[LyriaMusic] Saved to object storage: ${hash.slice(0, 12)}...`);
  } catch (err) {
    console.warn('[LyriaMusic] Object storage save failed:', err);
  }
}

// -----------------------------------------------------------------------
// Public API — generate (or retrieve cached) music clip
// -----------------------------------------------------------------------
export async function generateMusicClip(
  styleId: MusicStyleId,
  context?: MusicContext
): Promise<Buffer | null> {
  if (!isMusicEnabled()) {
    console.log('[LyriaMusic] Music disabled via LYRIA_MUSIC_ENABLED=false');
    return null;
  }

  const style = MUSIC_STYLES[styleId];
  if (!style || styleId === 'none' || !style.prompt) {
    return null;
  }

  // Build context-enriched prompt — cache key is derived from the full prompt
  // so different context combinations produce distinct cached clips.
  const prompt = buildContextualPrompt(styleId, context);
  const hash = promptHash(prompt);

  // 1. Check in-memory LRU cache
  const cached = lruGet(hash);
  if (cached) {
    console.log(`[LyriaMusic] LRU cache hit: ${styleId}`);
    return cached;
  }

  // 2. Check object storage cache
  const stored = await loadFromStorage(hash);
  if (stored) {
    lruSet(hash, stored);
    return stored;
  }

  // 3. Generate via Lyria 3 API
  console.log(`[LyriaMusic] Generating clip — style: ${styleId}, template: ${context?.template ?? '—'}, mood: ${context?.mood ?? '—'}`);
  try {
    // Validate the response carefully before using it
    const response = await (async () => {
      const r = await (new GoogleGenAI({ apiKey: process.env.GOOGLE_CLOUD_API_KEY! })).models.generateContent({
        model: 'lyria-3-clip-preview',
        contents: prompt,
      });
      return r;
    })();

    // Check for safety blocks
    const candidate = response.candidates?.[0];
    if (!candidate) {
      console.warn('[LyriaMusic] No candidates in Lyria 3 response — skipping music');
      return null;
    }
    if (candidate.finishReason && candidate.finishReason !== 'STOP' && candidate.finishReason !== 'MAX_TOKENS') {
      console.warn(`[LyriaMusic] Lyria 3 blocked (finishReason: ${candidate.finishReason}) — skipping music`);
      return null;
    }

    const parts = candidate.content?.parts ?? [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        const buf = Buffer.from(part.inlineData.data, 'base64');
        if (buf.length > 1000) {
          console.log(`[LyriaMusic] Received audio: ${buf.length} bytes`);
          lruSet(hash, buf);
          saveToStorage(hash, buf).catch(() => {}); // fire-and-forget
          console.log(`[LyriaMusic] Generated new clip for style: ${styleId}`);
          return buf;
        }
        console.warn('[LyriaMusic] inlineData too small — likely empty audio');
      }
    }

    console.warn('[LyriaMusic] No valid audio data in Lyria 3 response — skipping music');
    return null;
  } catch (err) {
    console.error(`[LyriaMusic] Generation failed for style ${styleId}:`, err);
    return null; // Non-fatal — caller proceeds without music
  }
}
