/**
 * GeminiTTSv2 - Clean TTS Module using Natural Language Prompting
 * 
 * CRITICAL FIX: Gemini TTS uses natural-language prompting, NOT SSML.
 * This module replaces the legacy SSML-based approach that caused
 * audio distortion at ~4 minutes by speaking SSML tags aloud.
 * 
 * CORRECT: "Say it with excitement: Hello everyone!"
 * WRONG:   "<prosody rate='110%'>Hello everyone!</prosody>"
 * 
 * @see https://cloud.google.com/text-to-speech/docs/gemini-tts#prompting_tips
 */

import { GoogleGenAI } from '@google/genai';
import * as crypto from 'crypto';
import { concatenateAudioBuffers, convertMp3ToWav, readWavHeader, resampleWavToTarget } from '../audioUtils';
import { db } from '../db';
import { voices as voicesTable } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { ObjectStorageService } from '../objectStorage';

// Expected audio format from Gemini TTS
const EXPECTED_SAMPLE_RATE = 24000;
const EXPECTED_CHANNELS = 1;
const EXPECTED_BIT_DEPTH = 16;

// ========================================
// 1. EMOTION/SPEED/ACCENT TAG REGISTRIES
// ========================================

/**
 * Complete list of all Gemini 2.5 Flash TTS supported emotion tags
 * Based on official Google documentation (December 2025 update)
 */
export const GEMINI_EMOTION_TAGS = [
  // Basic emotions
  'excited', 'happy', 'sad', 'angry', 'fearful', 'surprised', 'disgusted', 'neutral',
  // Happiness variants
  'joyful', 'cheerful', 'playful', 'enthusiastic', 'elated', 'hopeful',
  // Sadness variants
  'melancholic', 'disappointed', 'grieving', 'wistful', 'nostalgic', 'heartbroken',
  // Anger variants
  'furious', 'frustrated', 'annoyed', 'irritated', 'outraged',
  // Fear variants
  'nervous', 'anxious', 'terrified', 'worried', 'panicked', 'uneasy',
  // Surprise variants
  'shocked', 'amazed', 'confused', 'bewildered', 'astonished', 'startled',
  // Calm variants
  'calm', 'relaxed', 'soothing', 'peaceful', 'serene', 'tranquil', 'meditative',
  // Confidence spectrum
  'confident', 'proud', 'determined', 'assertive', 'bold', 'commanding',
  // Sarcasm/humor
  'sarcastic', 'mocking', 'teasing', 'hysterical', 'witty', 'dry-humor',
  // Delivery styles
  'serious', 'friendly', 'dramatic', 'professional', 'curious', 'spooky',
  'warm', 'empathetic', 'scornful', 'intimate', 'mysterious', 'conspiratorial',
  'theatrical', 'matter-of-fact', 'deadpan',
  // Energy states
  'tired', 'exhausted', 'sleepy', 'bored', 'dreamy', 'breathless', 'energized',
  // Vocal effects (Core)
  'laugh', 'chuckle', 'sigh', 'gasp', 'breath', 'whisper', 'giggle',
  'hearty-laugh', 'nervous-laugh', 'crying', 'coughing', 'uhm', 'ah',
  // Vocal effects (Extended - December 2025)
  'yawn', 'sniff', 'sob', 'grunt', 'hum', 'stammer', 'stutter',
  'clear-throat', 'sharp-inhale', 'relieved-sigh', 'shaky-voice',
  'trembling', 'choked-up', 'breaking-voice', 'quivering',
] as const;

/**
 * Speed control tags based on Google's Gemini TTS documentation
 */
export const GEMINI_SPEED_TAGS = [
  'extremely slow', 'very slow', 'slow', 'medium', 'fast', 'very fast', 'extremely fast',
] as const;

/**
 * Accent/dialect modifiers for natural language steering
 */
export const GEMINI_ACCENT_TAGS = [
  'british', 'australian', 'indian', 'american', 'southern-american', 
  'new-york', 'irish', 'scottish', 'french', 'german', 'spanish',
  'italian', 'japanese', 'korean', 'chinese', 'russian',
] as const;

/**
 * Podcast context types for enhanced scene-setting prompts
 */
export const PODCAST_CONTEXT_TYPES = [
  'host', 'co-host', 'interviewer', 'guest', 'narrator', 'storyteller',
  'news-anchor', 'educator', 'expert', 'commentator',
] as const;

export type GeminiEmotionTag = typeof GEMINI_EMOTION_TAGS[number];
export type GeminiSpeedTag = typeof GEMINI_SPEED_TAGS[number];
export type GeminiAccentTag = typeof GEMINI_ACCENT_TAGS[number];
export type PodcastContextType = typeof PODCAST_CONTEXT_TYPES[number];

// ========================================
// 2. GEMINI CLIENT INITIALIZATION (DUAL API KEY SUPPORT)
// ========================================

interface GeminiClientState {
  primary: GoogleGenAI | null;
  secondary: GoogleGenAI | null;
  tertiary: GoogleGenAI | null;
  quaternary: GoogleGenAI | null;
  activeKey: 'primary' | 'secondary' | 'tertiary' | 'quaternary';
  primaryExhausted: boolean;
  primaryExhaustedAt: number | null;
  secondaryExhausted: boolean;
  secondaryExhaustedAt: number | null;
  tertiaryExhausted: boolean;
  tertiaryExhaustedAt: number | null;
}

const clientState: GeminiClientState = {
  primary: null,
  secondary: null,
  tertiary: null,
  quaternary: null,
  activeKey: 'primary',
  primaryExhausted: false,
  primaryExhaustedAt: null,
  secondaryExhausted: false,
  secondaryExhaustedAt: null,
  tertiaryExhausted: false,
  tertiaryExhaustedAt: null,
};

function initializePrimaryClient(): GoogleGenAI | null {
  if (!clientState.primary) {
    const apiKey = process.env.GOOGLE_CLOUD_API_KEY;
    if (apiKey) {
      clientState.primary = new GoogleGenAI({ apiKey });
      console.log('[GeminiTTSv2] Primary client initialized');
    }
  }
  return clientState.primary;
}

function initializeSecondaryClient(): GoogleGenAI | null {
  if (!clientState.secondary) {
    const apiKey = process.env.GOOGLE_CLOUD_API_KEY_SECONDARY;
    if (apiKey) {
      clientState.secondary = new GoogleGenAI({ apiKey });
      console.log('[GeminiTTSv2] Secondary (fallback) client initialized');
    }
  }
  return clientState.secondary;
}

function initializeTertiaryClient(): GoogleGenAI | null {
  if (!clientState.tertiary) {
    const apiKey = process.env.GOOGLE_CLOUD_API_KEY_TERTIARY;
    if (apiKey) {
      clientState.tertiary = new GoogleGenAI({ apiKey });
      console.log('[GeminiTTSv2] Tertiary (backup) client initialized');
    }
  }
  return clientState.tertiary;
}

function initializeQuaternaryClient(): GoogleGenAI | null {
  if (!clientState.quaternary) {
    const apiKey = process.env.GOOGLE_CLOUD_API_KEY_QUATERNARY;
    if (apiKey) {
      clientState.quaternary = new GoogleGenAI({ apiKey });
      console.log('[GeminiTTSv2] Quaternary (4th backup) client initialized');
    }
  }
  return clientState.quaternary;
}

function getGeminiClient(): GoogleGenAI {
  // Check if keys were exhausted more than 24 hours ago - reset if so
  if (clientState.primaryExhausted && clientState.primaryExhaustedAt) {
    const hoursSinceExhaustion = (Date.now() - clientState.primaryExhaustedAt) / (1000 * 60 * 60);
    if (hoursSinceExhaustion >= 24) {
      console.log('[GeminiTTSv2] Primary key exhaustion expired (24h), resetting');
      clientState.primaryExhausted = false;
      clientState.primaryExhaustedAt = null;
    }
  }
  if (clientState.secondaryExhausted && clientState.secondaryExhaustedAt) {
    const hoursSinceExhaustion = (Date.now() - clientState.secondaryExhaustedAt) / (1000 * 60 * 60);
    if (hoursSinceExhaustion >= 24) {
      console.log('[GeminiTTSv2] Secondary key exhaustion expired (24h), resetting');
      clientState.secondaryExhausted = false;
      clientState.secondaryExhaustedAt = null;
    }
  }
  if (clientState.tertiaryExhausted && clientState.tertiaryExhaustedAt) {
    const hoursSinceExhaustion = (Date.now() - clientState.tertiaryExhaustedAt) / (1000 * 60 * 60);
    if (hoursSinceExhaustion >= 24) {
      console.log('[GeminiTTSv2] Tertiary key exhaustion expired (24h), resetting');
      clientState.tertiaryExhausted = false;
      clientState.tertiaryExhaustedAt = null;
    }
  }

  // Try primary first (if not exhausted)
  if (!clientState.primaryExhausted) {
    const primary = initializePrimaryClient();
    if (primary) {
      clientState.activeKey = 'primary';
      return primary;
    }
  }

  // Try secondary (if not exhausted)
  if (!clientState.secondaryExhausted) {
    const secondary = initializeSecondaryClient();
    if (secondary) {
      clientState.activeKey = 'secondary';
      return secondary;
    }
  }

  // Try tertiary (if not exhausted)
  if (!clientState.tertiaryExhausted) {
    const tertiary = initializeTertiaryClient();
    if (tertiary) {
      clientState.activeKey = 'tertiary';
      return tertiary;
    }
  }

  // Try quaternary (4th backup)
  const quaternary = initializeQuaternaryClient();
  if (quaternary) {
    clientState.activeKey = 'quaternary';
    return quaternary;
  }

  throw new Error('All API keys exhausted or not configured. Set GOOGLE_CLOUD_API_KEY, GOOGLE_CLOUD_API_KEY_SECONDARY, GOOGLE_CLOUD_API_KEY_TERTIARY, or GOOGLE_CLOUD_API_KEY_QUATERNARY.');
}

function markCurrentKeyExhausted(): GoogleGenAI | null {
  if (clientState.activeKey === 'primary') {
    clientState.primaryExhausted = true;
    clientState.primaryExhaustedAt = Date.now();
    console.log('[GeminiTTSv2] ⚠️ Primary API key quota exhausted, trying secondary...');
    
    const secondary = initializeSecondaryClient();
    if (secondary) {
      clientState.activeKey = 'secondary';
      return secondary;
    }
    
    const tertiary = initializeTertiaryClient();
    if (tertiary) {
      clientState.activeKey = 'tertiary';
      return tertiary;
    }
    
    const quaternary = initializeQuaternaryClient();
    if (quaternary) {
      clientState.activeKey = 'quaternary';
      return quaternary;
    }
  } else if (clientState.activeKey === 'secondary') {
    clientState.secondaryExhausted = true;
    clientState.secondaryExhaustedAt = Date.now();
    console.log('[GeminiTTSv2] ⚠️ Secondary API key quota exhausted, trying tertiary...');
    
    const tertiary = initializeTertiaryClient();
    if (tertiary) {
      clientState.activeKey = 'tertiary';
      return tertiary;
    }
    
    const quaternary = initializeQuaternaryClient();
    if (quaternary) {
      clientState.activeKey = 'quaternary';
      return quaternary;
    }
  } else if (clientState.activeKey === 'tertiary') {
    clientState.tertiaryExhausted = true;
    clientState.tertiaryExhaustedAt = Date.now();
    console.log('[GeminiTTSv2] ⚠️ Tertiary API key quota exhausted, trying quaternary...');
    
    const quaternary = initializeQuaternaryClient();
    if (quaternary) {
      clientState.activeKey = 'quaternary';
      return quaternary;
    }
  }
  
  // Quaternary exhausted or no more keys
  console.error('[GeminiTTSv2] ❌ All 4 API keys exhausted!');
  return null;
}

// Keep old function name for backward compatibility
function markPrimaryExhausted(): GoogleGenAI | null {
  return markCurrentKeyExhausted();
}

function getActiveKeyName(): string {
  switch (clientState.activeKey) {
    case 'primary': return 'Primary';
    case 'secondary': return 'Secondary';
    case 'tertiary': return 'Tertiary';
    case 'quaternary': return 'Quaternary';
    default: return 'Unknown';
  }
}

export function getApiKeyStatus() {
  return {
    activeKey: clientState.activeKey,
    primaryExhausted: clientState.primaryExhausted,
    primaryExhaustedAt: clientState.primaryExhaustedAt,
    secondaryExhausted: clientState.secondaryExhausted,
    secondaryExhaustedAt: clientState.secondaryExhaustedAt,
    tertiaryExhausted: clientState.tertiaryExhausted,
    tertiaryExhaustedAt: clientState.tertiaryExhaustedAt,
    hasSecondary: !!process.env.GOOGLE_CLOUD_API_KEY_SECONDARY,
    hasTertiary: !!process.env.GOOGLE_CLOUD_API_KEY_TERTIARY,
    hasQuaternary: !!process.env.GOOGLE_CLOUD_API_KEY_QUATERNARY,
  };
}

// ========================================
// 3. CACHING SYSTEM
// ========================================

interface CacheEntry {
  audio: Buffer;
  timestamp: number;
  textLength: number;
}

const synthesisCache = new Map<string, CacheEntry>();
const MAX_CACHE_SIZE = 500;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getCacheKey(text: string, voiceName: string, stylePrompt: string): string {
  return crypto
    .createHash('sha256')
    .update(`v2|${text}|${voiceName}|${stylePrompt}`)
    .digest('hex');
}

function getCachedAudio(text: string, voiceName: string, stylePrompt: string): Buffer | null {
  const key = getCacheKey(text, voiceName, stylePrompt);
  const entry = synthesisCache.get(key);
  
  if (entry) {
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      synthesisCache.delete(key);
      console.log(`[TTSv2 Cache] Expired cache entry for voice: ${voiceName}`);
      return null;
    }
    console.log(`[TTSv2 Cache] HIT: voice=${voiceName}, textLen=${entry.textLength}`);
    return entry.audio;
  }
  return null;
}

function setCachedAudio(text: string, voiceName: string, stylePrompt: string, audio: Buffer): void {
  if (synthesisCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = Array.from(synthesisCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0];
    synthesisCache.delete(oldestKey);
    console.log(`[TTSv2 Cache] Evicted oldest entry (cache size: ${MAX_CACHE_SIZE})`);
  }
  
  const key = getCacheKey(text, voiceName, stylePrompt);
  synthesisCache.set(key, {
    audio,
    timestamp: Date.now(),
    textLength: text.length,
  });
  console.log(`[TTSv2 Cache] STORED: voice=${voiceName}, textLen=${text.length}, cacheSize=${synthesisCache.size}/${MAX_CACHE_SIZE}`);
}

// ========================================
// 4. QUOTA TRACKING
// ========================================

interface QuotaStats {
  date: string;
  requestCount: number;
  cachedHits: number;
  lastResetTime: number;
}

let dailyQuotaStats: QuotaStats = {
  date: '',
  requestCount: 0,
  cachedHits: 0,
  lastResetTime: Date.now()
};

const TIER_LIMITS = {
  tier1: { rpm: 10, rpd: 100 },
  tier2: { rpm: 60, rpd: 1000 },
  tier3: { rpm: 300, rpd: 5000 }
};

const CURRENT_TIER = (process.env.GEMINI_TTS_TIER as 'tier1' | 'tier2' | 'tier3') || 'tier1';
const QUOTA_WARNING_THRESHOLD = 0.8;

function getPacificDate(): string {
  return new Date().toLocaleDateString('en-CA', { 
    timeZone: 'America/Los_Angeles' 
  });
}

function checkAndResetDailyQuota(): void {
  const today = getPacificDate();
  if (dailyQuotaStats.date !== today) {
    console.log(`[Quota V2] 📅 New day detected. Resetting quota.`);
    dailyQuotaStats = {
      date: today,
      requestCount: 0,
      cachedHits: 0,
      lastResetTime: Date.now()
    };
  }
}

function trackTTSRequest(): { allowed: boolean; warning?: string } {
  checkAndResetDailyQuota();
  
  const limit = TIER_LIMITS[CURRENT_TIER].rpd;
  dailyQuotaStats.requestCount++;
  
  const usagePercent = dailyQuotaStats.requestCount / limit;
  
  if (dailyQuotaStats.requestCount > limit) {
    console.error(`[Quota V2] ❌ DAILY QUOTA EXHAUSTED: ${dailyQuotaStats.requestCount}/${limit}`);
    return { 
      allowed: false, 
      warning: `Daily TTS quota exhausted (${limit} requests). Quota resets at midnight Pacific Time.`
    };
  }
  
  if (usagePercent >= QUOTA_WARNING_THRESHOLD && usagePercent < 1) {
    const remaining = limit - dailyQuotaStats.requestCount;
    console.warn(`[Quota V2] ⚠️ HIGH USAGE: ${dailyQuotaStats.requestCount}/${limit} - ${remaining} remaining`);
    return { 
      allowed: true, 
      warning: `TTS quota ${(usagePercent * 100).toFixed(0)}% used. ${remaining} requests remaining.`
    };
  }
  
  return { allowed: true };
}

function trackCacheHit(): void {
  checkAndResetDailyQuota();
  dailyQuotaStats.cachedHits++;
}

export function getQuotaStatsV2() {
  checkAndResetDailyQuota();
  const limit = TIER_LIMITS[CURRENT_TIER].rpd;
  const remaining = Math.max(0, limit - dailyQuotaStats.requestCount);
  const usagePercent = (dailyQuotaStats.requestCount / limit) * 100;
  
  let status: 'ok' | 'warning' | 'exhausted' = 'ok';
  if (dailyQuotaStats.requestCount >= limit) status = 'exhausted';
  else if (usagePercent >= QUOTA_WARNING_THRESHOLD * 100) status = 'warning';
  
  return {
    tier: CURRENT_TIER,
    today: dailyQuotaStats.date,
    requests: dailyQuotaStats.requestCount,
    cacheHits: dailyQuotaStats.cachedHits,
    limit,
    remaining,
    usagePercent: Math.round(usagePercent * 10) / 10,
    status
  };
}

// ========================================
// 5. REQUEST QUEUE WITH RATE LIMITING
// ========================================

interface QueuedRequest {
  fn: () => Promise<Buffer>;
  resolve: (value: Buffer) => void;
  reject: (error: any) => void;
  priority?: number;
}

const MAX_CONCURRENT = 5;
const MIN_STAGGER_MS = 400;
const requestQueue: QueuedRequest[] = [];
let activeCount = 0;
let lastRequestTime = 0;

async function processNextRequest(): Promise<void> {
  if (activeCount >= MAX_CONCURRENT || requestQueue.length === 0) {
    return;
  }
  
  const now = Date.now();
  const timeSinceLast = now - lastRequestTime;
  if (timeSinceLast < MIN_STAGGER_MS && lastRequestTime > 0) {
    setTimeout(() => processNextRequest(), MIN_STAGGER_MS - timeSinceLast);
    return;
  }
  
  const request = requestQueue.shift();
  if (!request) return;
  
  activeCount++;
  lastRequestTime = Date.now();
  
  console.log(`[TTSv2 Queue] Starting request (active: ${activeCount}/${MAX_CONCURRENT}, pending: ${requestQueue.length})`);
  
  try {
    const result = await request.fn();
    request.resolve(result);
  } catch (error) {
    request.reject(error);
  } finally {
    activeCount--;
    processNextRequest();
  }
}

function queueTTSRequest(fn: () => Promise<Buffer>, priority: number = 10): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const request: QueuedRequest = { fn, resolve, reject, priority };
    
    const insertIndex = requestQueue.findIndex(r => (r.priority || 10) > priority);
    if (insertIndex === -1) {
      requestQueue.push(request);
    } else {
      requestQueue.splice(insertIndex, 0, request);
    }
    
    processNextRequest();
    setTimeout(() => processNextRequest(), MIN_STAGGER_MS);
    setTimeout(() => processNextRequest(), MIN_STAGGER_MS * 2);
  });
}

// ========================================
// 6. SCRIPT PREPARATION - cleanTextForTTS()
// ========================================

export interface CleanedTextResult {
  cleanText: string;
  emotions: string[];
  speeds: string[];
  accents: string[];
}

/**
 * Clean text for TTS by stripping ALL bracket tags
 * Returns the clean text plus extracted emotions, speeds, and accents
 * 
 * CRITICAL: This prevents Gemini TTS from speaking tags aloud
 */
export function cleanTextForTTS(text: string): CleanedTextResult {
  const emotionTagsPattern = GEMINI_EMOTION_TAGS.join('|');
  const speedTagsPattern = GEMINI_SPEED_TAGS.join('|');
  const accentTagsPattern = GEMINI_ACCENT_TAGS.join('|');
  
  const emotionPattern = new RegExp(`\\[(${emotionTagsPattern})\\]`, 'gi');
  const speedPattern = new RegExp(`\\[(${speedTagsPattern})\\]`, 'gi');
  const accentPattern = new RegExp(`\\[(${accentTagsPattern})\\]`, 'gi');
  
  const emotions: string[] = [];
  const speeds: string[] = [];
  const accents: string[] = [];
  
  let cleanText = text.replace(emotionPattern, (match, emotion) => {
    emotions.push(emotion.toLowerCase());
    return '';
  });
  
  cleanText = cleanText.replace(speedPattern, (match, speed) => {
    speeds.push(speed.toLowerCase());
    return '';
  });
  
  cleanText = cleanText.replace(accentPattern, (match, accent) => {
    accents.push(accent.toLowerCase());
    return '';
  });
  
  // Catch ANY remaining bracket tags (legacy markers like [PAUSE], [LAUGH], etc.)
  const unknownBracketPattern = /\[[A-Za-z_-]+\]/g;
  cleanText = cleanText
    .replace(unknownBracketPattern, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  return { cleanText, emotions, speeds, accents };
}

// ========================================
// 7. BUILD STYLE PROMPT
// ========================================

export interface StylePromptOptions {
  podcastContext?: PodcastContextType;
  templateCategory?: string;
  voiceAccent?: string;
  applyNativeAccent?: boolean;
}

/**
 * Comprehensive map of emotions/effects to natural language instructions
 * Optimized for Gemini 2.5 Flash with natural language control
 */
const EMOTION_STYLE_MAP: Record<string, string> = {
  // Basic emotions
  'excited': 'Say it in an excited, energetic tone with rising pitch and enthusiasm.',
  'happy': 'Say it in a cheerful, upbeat manner with a warm smile in your voice.',
  'sad': 'Say it in a somber, melancholic tone with slower pace and gentle delivery.',
  'angry': 'Say it in a firm, intense voice with emphasis and controlled frustration.',
  'fearful': 'Say it in a nervous, hesitant manner with slight trembling.',
  'surprised': 'Say it with a surprised, astonished tone and widened vocal expression.',
  'disgusted': 'Say it with a disapproving, slightly repulsed tone.',
  'neutral': 'Say it in a calm, neutral voice with even delivery.',
  
  // Happiness variants
  'joyful': 'Say it with pure joy and delight, voice bright and lifted.',
  'cheerful': 'Say it in a bright, optimistic and cheerful manner.',
  'playful': 'Say it with a playful, teasing quality and light-hearted tone.',
  'enthusiastic': 'Say it with genuine enthusiasm, energy, and passion.',
  'elated': 'Say it with overwhelming happiness and exhilaration.',
  'hopeful': 'Say it with optimism and hopeful anticipation.',
  
  // Sadness variants
  'melancholic': 'Say it with a deep, reflective sadness and wistful quality.',
  'disappointed': 'Say it with a tone of disappointment and let-down feeling.',
  'grieving': 'Say it with profound sorrow and emotional weight.',
  'wistful': 'Say it with a gentle, longing sadness and nostalgia.',
  'nostalgic': 'Say it with warm, bittersweet remembrance.',
  'heartbroken': 'Say it with deep emotional pain and heartache.',
  
  // Anger variants
  'furious': 'Say it with barely contained rage and intense emphasis.',
  'frustrated': 'Say it with clear frustration and exasperation.',
  'annoyed': 'Say it with mild irritation and impatience.',
  'irritated': 'Say it with slight annoyance and displeasure.',
  'outraged': 'Say it with righteous indignation and moral anger.',
  
  // Fear variants
  'nervous': 'Say it with nervous energy and slight uncertainty.',
  'anxious': 'Say it with underlying anxiety and worried undertone.',
  'terrified': 'Say it with genuine terror and fear in the voice.',
  'worried': 'Say it with a concerned, worried quality.',
  'panicked': 'Say it with urgent panic and rapid, breathless delivery.',
  'uneasy': 'Say it with subtle discomfort and apprehension.',
  
  // Surprise variants
  'shocked': 'Say it with complete shock and disbelief.',
  'amazed': 'Say it with wonder and amazement.',
  'confused': 'Say it with a puzzled, questioning tone.',
  'bewildered': 'Say it with complete confusion and disorientation.',
  'astonished': 'Say it with utter astonishment and disbelief.',
  'startled': 'Say it with a sudden, startled reaction.',
  
  // Calm variants
  'calm': 'Say it in a calm, relaxed manner with measured pace.',
  'relaxed': 'Say it in a laid-back, easy-going tone.',
  'soothing': 'Say it in a gentle, soothing voice that calms.',
  'peaceful': 'Say it with serene, peaceful delivery.',
  'serene': 'Say it with tranquil, undisturbed calmness.',
  'tranquil': 'Say it with deep inner peace and stillness.',
  'meditative': 'Say it with contemplative, centered mindfulness.',
  
  // Confidence spectrum
  'confident': 'Say it with self-assured confidence and authority.',
  'proud': 'Say it with pride and satisfaction in the voice.',
  'determined': 'Say it with determination and resolve.',
  'assertive': 'Say it with assertive, direct delivery.',
  'bold': 'Say it with bold, fearless conviction.',
  'commanding': 'Say it with authoritative, commanding presence.',
  
  // Sarcasm/humor
  'sarcastic': 'Say it with dry sarcasm and ironic undertone.',
  'mocking': 'Say it with a mocking, slightly teasing quality.',
  'teasing': 'Say it with playful teasing and humor.',
  'hysterical': 'Say it with uncontrollable laughter and hilarity.',
  'witty': 'Say it with clever, quick-witted delivery.',
  'dry-humor': 'Say it with subtle, deadpan comedic timing.',
  
  // Delivery styles
  'serious': 'Say it in a serious, professional tone with weight.',
  'friendly': 'Say it in a warm, friendly manner that builds rapport.',
  'dramatic': 'Say it with theatrical, dramatic flair.',
  'professional': 'Say it in a polished, professional delivery.',
  'curious': 'Say it with genuine curiosity and interest.',
  'spooky': 'Say it with an eerie, mysterious quality.',
  'warm': 'Say it with warmth and genuine care.',
  'empathetic': 'Say it with deep empathy and understanding.',
  'scornful': 'Say it with disdain and contempt.',
  'intimate': 'Say it in a close, personal, intimate whisper.',
  'mysterious': 'Say it with enigmatic, intriguing mystery.',
  'conspiratorial': 'Say it like sharing a secret, hushed and knowing.',
  'theatrical': 'Say it with grand, theatrical performance.',
  'matter-of-fact': 'Say it plainly and directly without emotion.',
  'deadpan': 'Say it with completely flat, emotionless delivery.',
  
  // Energy states
  'tired': 'Say it with fatigue and low energy in the voice.',
  'exhausted': 'Say it with complete exhaustion and weariness.',
  'sleepy': 'Say it with drowsy, sleepy delivery.',
  'bored': 'Say it with disinterest and monotone boredom.',
  'dreamy': 'Say it with soft, distant, dreamlike quality.',
  'breathless': 'Say it while catching your breath, with excited breathlessness.',
  'energized': 'Say it with high energy and vibrant enthusiasm.',
  
  // Vocal effects
  'laugh': 'Include natural laughter.',
  'chuckle': 'Include a subtle, knowing chuckle.',
  'sigh': 'Include a thoughtful sigh.',
  'gasp': 'Include a surprised gasp.',
  'breath': 'Include natural, audible breathing.',
  'whisper': 'Say it in a confidential whisper.',
  'giggle': 'Include playful giggling.',
  'hearty-laugh': 'Include hearty, warm belly laughter.',
  'nervous-laugh': 'Include a nervous, uncertain laugh.',
  'crying': 'Say it with tears and emotional crying.',
  'coughing': 'Include a natural cough.',
  'uhm': 'Include a natural "uhm" hesitation.',
  'ah': 'Include a natural "ah" vocalization.',
  'yawn': 'Include a natural yawn.',
  'sniff': 'Include a sniff or sniffle.',
  'sob': 'Include a sob or soft crying.',
  'grunt': 'Include a natural grunt.',
  'hum': 'Include a thoughtful hum.',
  'stammer': 'Say it with a slight stammer or hesitation.',
  'stutter': 'Say it with a noticeable stutter.',
  'clear-throat': 'Include a throat-clearing sound.',
  'sharp-inhale': 'Include a sharp, sudden inhale.',
  'relieved-sigh': 'Include a relieved, exhaling sigh.',
  'shaky-voice': 'Say it with a shaky, trembling voice.',
  'trembling': 'Say it with trembling emotion in the voice.',
  'choked-up': 'Say it while choked up with emotion.',
  'breaking-voice': 'Say it with voice breaking from emotion.',
  'quivering': 'Say it with a quivering, unsteady voice.',
};

const SPEED_STYLE_MAP: Record<string, string> = {
  'extremely slow': 'at an extremely slow, deliberate pace with long pauses',
  'very slow': 'at a very slow, measured pace',
  'slow': 'at a slow, unhurried pace',
  'medium': 'at a normal, conversational pace',
  'fast': 'at a brisk, energetic pace',
  'very fast': 'at a very fast, rapid pace',
  'extremely fast': 'at an extremely fast pace like reading disclaimers',
};

const ACCENT_STYLE_MAP: Record<string, string> = {
  'british': 'with a British English accent',
  'australian': 'with an Australian English accent',
  'indian': 'with an Indian English accent',
  'american': 'with an American English accent',
  'southern-american': 'with a Southern American accent',
  'new-york': 'with a New York accent',
  'irish': 'with an Irish accent',
  'scottish': 'with a Scottish accent',
  'french': 'with a French accent',
  'german': 'with a German accent',
  'spanish': 'with a Spanish accent',
  'italian': 'with an Italian accent',
  'japanese': 'with a Japanese accent',
  'korean': 'with a Korean accent',
  'chinese': 'with a Chinese accent',
  'russian': 'with a Russian accent',
};

const PODCAST_CONTEXT_PROMPTS: Record<PodcastContextType, string> = {
  'host': 'You are a podcast host speaking to your audience.',
  'co-host': 'You are a podcast co-host having a friendly conversation with your co-host.',
  'interviewer': 'You are an interviewer asking thoughtful questions.',
  'guest': 'You are a guest on a podcast sharing your expertise.',
  'narrator': 'You are a narrator telling an engaging story.',
  'storyteller': 'You are a storyteller bringing characters and scenes to life.',
  'news-anchor': 'You are a news anchor delivering important information clearly.',
  'educator': 'You are an educator explaining concepts in an accessible way.',
  'expert': 'You are an expert sharing deep knowledge on a subject.',
  'commentator': 'You are a commentator providing insightful analysis.',
};

const TEMPLATE_CONTEXT_PROMPTS: Record<string, string> = {
  'news': 'You are a professional news anchor.',
  'stories': 'You are an expressive storyteller.',
  'teachme': 'You are a patient and engaging educator.',
  'medical': 'You are a knowledgeable healthcare professional.',
  'sports': 'You are an energetic sports commentator.',
  'events': 'You are an enthusiastic event announcer.',
  'custom': 'You are a friendly podcast host.',
  'documents': 'You are clearly presenting information.',
};

/**
 * Build a natural language style prompt from extracted tags
 * This creates the instruction prefix for Gemini TTS
 */
export function buildStylePrompt(
  emotions: string[],
  speeds: string[],
  accents: string[],
  options?: StylePromptOptions
): string {
  const promptParts: string[] = [];
  
  // Add podcast context
  if (options?.podcastContext && PODCAST_CONTEXT_PROMPTS[options.podcastContext]) {
    promptParts.push(PODCAST_CONTEXT_PROMPTS[options.podcastContext]);
  }
  
  // Add template context (if no podcast context)
  if (!options?.podcastContext && options?.templateCategory && TEMPLATE_CONTEXT_PROMPTS[options.templateCategory]) {
    promptParts.push(TEMPLATE_CONTEXT_PROMPTS[options.templateCategory]);
  }
  
  // Add accent from extracted tags
  if (accents.length > 0 && ACCENT_STYLE_MAP[accents[0]]) {
    promptParts.push(`Speak ${ACCENT_STYLE_MAP[accents[0]]}.`);
  }
  
  // Add accent from voice catalog (native accent)
  if (options?.applyNativeAccent && options?.voiceAccent && !accents.length) {
    const accentKey = options.voiceAccent.toLowerCase();
    if (ACCENT_STYLE_MAP[accentKey]) {
      promptParts.push(`Speak ${ACCENT_STYLE_MAP[accentKey]}.`);
    }
  }
  
  // Add speed instruction
  if (speeds.length > 0 && SPEED_STYLE_MAP[speeds[0]]) {
    promptParts.push(`Speak ${SPEED_STYLE_MAP[speeds[0]]}.`);
  }
  
  // Add emotion instruction
  if (emotions.length > 0 && EMOTION_STYLE_MAP[emotions[0]]) {
    promptParts.push(EMOTION_STYLE_MAP[emotions[0]]);
  }
  
  // CRITICAL: Add pacing anchor to prevent Gemini context-aware pacing drift
  // This maintains consistent tempo while allowing emotion/tone to vary naturally
  // Research: Gemini TTS dynamically adjusts speed based on emotion/context, causing drift
  // Use conditional wording: if speed was specified, maintain THAT pace; otherwise steady pace
  if (speeds.length > 0) {
    promptParts.push('Maintain this pace consistently throughout without speeding up or slowing down.');
  } else {
    promptParts.push('Maintain a steady, consistent speaking tempo throughout without speeding up or slowing down.');
  }
  
  return promptParts.join(' ');
}

// ========================================
// 8. CHUNK PLANNER
// ========================================

export interface TextChunk {
  text: string;
  index: number;
  speakerLabel?: string;
}

/**
 * Split text into chunks at sentence boundaries
 * Target ~4 minutes per chunk (3000 chars at ~750 chars/min)
 * Matches simple test approach for reliable audio generation
 */
export function splitIntoChunks(text: string, chunkSize: number = 3000): TextChunk[] {
  if (text.length <= chunkSize) {
    return [{ text, index: 0 }];
  }
  
  // Split at sentence boundaries
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const chunks: TextChunk[] = [];
  let currentChunk = '';
  let currentIndex = 0;
  
  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > chunkSize && currentChunk.length > 0) {
      chunks.push({ text: currentChunk.trim(), index: currentIndex });
      currentIndex++;
      currentChunk = sentence;
    } else {
      currentChunk += sentence;
    }
  }
  
  if (currentChunk.length > 0) {
    chunks.push({ text: currentChunk.trim(), index: currentIndex });
  }
  
  console.log(`[ChunkPlanner] Split ${text.length} chars into ${chunks.length} chunks (target: ${chunkSize} chars/chunk)`);
  
  return chunks;
}

// ========================================
// 9. WAV UTILITIES
// ========================================

function createWavBuffer(
  pcmData: Buffer,
  channels: number = 1,
  rate: number = 24000,
  sampleWidth: number = 2
): Buffer {
  const byteRate = rate * channels * sampleWidth;
  const blockAlign = channels * sampleWidth;
  const dataSize = pcmData.length;

  const header = Buffer.alloc(44);
  let offset = 0;

  header.write('RIFF', offset); offset += 4;
  header.writeUInt32LE(dataSize + 36, offset); offset += 4;
  header.write('WAVE', offset); offset += 4;

  header.write('fmt ', offset); offset += 4;
  header.writeUInt32LE(16, offset); offset += 4;
  header.writeUInt16LE(1, offset); offset += 2;
  header.writeUInt16LE(channels, offset); offset += 2;
  header.writeUInt32LE(rate, offset); offset += 4;
  header.writeUInt32LE(byteRate, offset); offset += 4;
  header.writeUInt16LE(blockAlign, offset); offset += 2;
  header.writeUInt16LE(sampleWidth * 8, offset); offset += 2;

  header.write('data', offset); offset += 4;
  header.writeUInt32LE(dataSize, offset);

  return Buffer.concat([header, pcmData]);
}

/**
 * Validate and normalize WAV audio returned from Gemini TTS
 * 
 * Strategy: Check header first. If valid and correct format, return as-is.
 * Otherwise, use FFmpeg for normalization (same reliable approach as MP3 conversion).
 * 
 * @param wavBuffer - Audio buffer from Gemini TTS
 * @param context - Description for logging (e.g., "single-speaker" or "multi-speaker")
 * @returns Validated WAV buffer with correct 24kHz/mono/16-bit format
 */
async function validateAndNormalizeWav(wavBuffer: Buffer, context: string = ''): Promise<Buffer> {
  // Step 1: Check if the buffer is already valid and in the correct format
  const header = readWavHeader(wavBuffer);
  
  if (header.valid) {
    const formatOk = header.sampleRate === EXPECTED_SAMPLE_RATE && 
                     header.channels === EXPECTED_CHANNELS && 
                     header.bitDepth === EXPECTED_BIT_DEPTH;
    const headerOk = header.dataOffset === 44 && !header.extraChunks;
    
    if (formatOk && headerOk) {
      // Already correct format with clean header - return as-is
      console.log(`[TTSv2] ${context} WAV already valid (${wavBuffer.length} bytes, ${(header.dataSize / 48000).toFixed(2)}s)`);
      return wavBuffer;
    }
    
    // Valid header but wrong format or has extra chunks - use ffmpeg to normalize
    console.log(`[TTSv2] ${context} Normalizing via ffmpeg (format=${formatOk}, header=${headerOk})`);
    const normalized = await resampleWavToTarget(wavBuffer);
    
    const verifyHeader = readWavHeader(normalized);
    if (!verifyHeader.valid || 
        verifyHeader.sampleRate !== EXPECTED_SAMPLE_RATE || 
        verifyHeader.channels !== EXPECTED_CHANNELS || 
        verifyHeader.bitDepth !== EXPECTED_BIT_DEPTH) {
      console.error(`[TTSv2] ${context} FFmpeg normalization failed! Output: ${JSON.stringify(verifyHeader)}`);
      throw new Error('Audio normalization via ffmpeg produced invalid output');
    }
    
    console.log(`[TTSv2] ${context} ✓ Normalized ${wavBuffer.length} → ${normalized.length} bytes`);
    return normalized;
  }
  
  // Step 2: Invalid header - try ffmpeg first (it can often recover malformed WAVs)
  console.log(`[TTSv2] ${context} Invalid WAV header, attempting ffmpeg recovery...`);
  try {
    const recovered = await resampleWavToTarget(wavBuffer);
    const verifyHeader = readWavHeader(recovered);
    
    if (verifyHeader.valid && 
        verifyHeader.sampleRate === EXPECTED_SAMPLE_RATE && 
        verifyHeader.channels === EXPECTED_CHANNELS && 
        verifyHeader.bitDepth === EXPECTED_BIT_DEPTH &&
        verifyHeader.dataSize >= 4800) { // At least 0.1s of audio
      console.log(`[TTSv2] ${context} ✓ FFmpeg recovery successful: ${recovered.length} bytes`);
      return recovered;
    }
    throw new Error('FFmpeg output validation failed');
  } catch (ffmpegError) {
    // Step 3: FFmpeg failed - treat as raw PCM and wrap with header
    console.warn(`[TTSv2] ${context} FFmpeg recovery failed, treating as raw PCM...`);
    
    // Check if there's a partial RIFF header we need to skip
    let pcmData: Buffer;
    const hasRiffMarker = wavBuffer.length >= 4 && wavBuffer.slice(0, 4).toString('utf-8') === 'RIFF';
    
    if (hasRiffMarker && wavBuffer.length > 44) {
      // Has partial header - skip it
      pcmData = wavBuffer.slice(44);
    } else if (!hasRiffMarker) {
      // Pure raw PCM
      pcmData = wavBuffer;
    } else {
      throw new Error('Audio buffer too small to recover');
    }
    
    // Ensure even length for 16-bit samples
    if (pcmData.length % 2 !== 0) {
      pcmData = pcmData.slice(0, pcmData.length - 1);
    }
    
    // Check minimum size (0.1s at 24kHz/16-bit/mono = 4800 bytes)
    if (pcmData.length < 4800) {
      throw new Error(`PCM data too short: ${pcmData.length} bytes`);
    }
    
    // Wrap PCM with proper WAV header
    const recovered = createWavBuffer(pcmData, 1, 24000, 2);
    console.log(`[TTSv2] ${context} ✓ Raw PCM recovery successful: ${recovered.length} bytes`);
    return recovered;
  }
}

/**
 * Validate audio quality by checking for common corruption indicators
 * 
 * @param wavBuffer - WAV buffer to validate
 * @param source - Description for logging
 * @returns true if audio appears valid, false if potentially corrupted
 */
function validateAudioQuality(wavBuffer: Buffer, source: string): boolean {
  const header = readWavHeader(wavBuffer);
  if (!header.valid) {
    console.error(`[Audio Quality ${source}] Invalid WAV header`);
    return false;
  }
  
  const pcmData = wavBuffer.slice(header.dataOffset, header.dataOffset + header.dataSize);
  
  // Check 1: Minimum audio length (at least 0.1 seconds at 24kHz = 4800 bytes for 16-bit mono)
  const minBytes = Math.floor(header.sampleRate * 0.1 * header.channels * (header.bitDepth / 8));
  if (pcmData.length < minBytes) {
    console.warn(`[Audio Quality ${source}] ⚠️ Audio too short: ${pcmData.length} bytes (min ${minBytes})`);
    return false;
  }
  
  // Check 2: Not all zeros (silence detection)
  let nonZeroCount = 0;
  const sampleSize = header.bitDepth / 8;
  const numSamples = Math.min(pcmData.length / sampleSize, 1000); // Check first 1000 samples
  for (let i = 0; i < numSamples * sampleSize; i += sampleSize) {
    const sample = sampleSize === 2 ? pcmData.readInt16LE(i) : pcmData.readInt8(i);
    if (Math.abs(sample) > 10) {
      nonZeroCount++;
    }
  }
  const silenceRatio = 1 - (nonZeroCount / numSamples);
  if (silenceRatio > 0.99) {
    console.warn(`[Audio Quality ${source}] ⚠️ Audio appears to be mostly silence (${(silenceRatio * 100).toFixed(1)}% silent)`);
    // Don't fail - some segments might legitimately be quiet
  }
  
  // Check 3: Detect potential clipping (too many samples at max amplitude)
  let clippedCount = 0;
  const maxAmplitude = sampleSize === 2 ? 32767 : 127;
  for (let i = 0; i < Math.min(pcmData.length, 10000); i += sampleSize) {
    const sample = sampleSize === 2 ? Math.abs(pcmData.readInt16LE(i)) : Math.abs(pcmData.readInt8(i));
    if (sample >= maxAmplitude - 1) {
      clippedCount++;
    }
  }
  const clippingRatio = clippedCount / (Math.min(pcmData.length, 10000) / sampleSize);
  if (clippingRatio > 0.1) {
    console.warn(`[Audio Quality ${source}] ⚠️ Potential audio clipping detected (${(clippingRatio * 100).toFixed(1)}% clipped samples)`);
    // Don't fail - just warn
  }
  
  // Check 4: Reasonable bytes-per-character ratio (detect truncated audio)
  // This is logged elsewhere, but we can validate here too
  
  console.log(`[Audio Quality ${source}] ✓ Audio quality checks passed (silence: ${(silenceRatio * 100).toFixed(1)}%, clipping: ${(clippingRatio * 100).toFixed(1)}%)`);
  return true;
}

function generateSilence(durationSeconds: number = 1, sampleRate: number = 24000): Buffer {
  const channels = 1;
  const sampleWidth = 2;
  const numSamples = sampleRate * durationSeconds;
  const dataSize = numSamples * sampleWidth;
  
  const header = Buffer.alloc(44);
  let offset = 0;

  header.write('RIFF', offset); offset += 4;
  header.writeUInt32LE(dataSize + 36, offset); offset += 4;
  header.write('WAVE', offset); offset += 4;

  header.write('fmt ', offset); offset += 4;
  header.writeUInt32LE(16, offset); offset += 4;
  header.writeUInt16LE(1, offset); offset += 2;
  header.writeUInt16LE(channels, offset); offset += 2;
  header.writeUInt32LE(sampleRate, offset); offset += 4;
  header.writeUInt32LE(sampleRate * channels * sampleWidth, offset); offset += 4;
  header.writeUInt16LE(channels * sampleWidth, offset); offset += 2;
  header.writeUInt16LE(sampleWidth * 8, offset); offset += 2;

  header.write('data', offset); offset += 4;
  header.writeUInt32LE(dataSize, offset);

  const silence = Buffer.alloc(dataSize);
  return Buffer.concat([header, silence]);
}

// ========================================
// 10. TTS MODEL TYPES
// ========================================

export type GeminiTTSModel = 
  | 'gemini-2.5-flash-preview-tts'
  | 'gemini-2.5-pro-preview-tts'
  | 'gemini-2.5-flash-lite-preview-tts';

export interface SynthesisOptionsV2 {
  podcastContext?: PodcastContextType;
  templateCategory?: string;
  voiceAccent?: string;
  applyNativeAccent?: boolean;
}

// ========================================
// 11. SINGLE SPEAKER SYNTHESIS V2
// ========================================

/**
 * Synthesize single speaker audio using natural language prompting
 * NO SSML, NO prosody tags - uses style instructions instead
 */
export async function synthesizeSingleSpeakerV2(
  text: string,
  voiceName: string,
  model: GeminiTTSModel = 'gemini-2.5-flash-preview-tts',
  options?: SynthesisOptionsV2
): Promise<Buffer> {
  // Step 1: Clean text and extract style tags
  const { cleanText, emotions, speeds, accents } = cleanTextForTTS(text);
  
  // Step 2: Build natural language style prompt
  const stylePrompt = buildStylePrompt(emotions, speeds, accents, options);
  
  // Step 3: Check cache
  const cachedAudio = getCachedAudio(cleanText, voiceName, stylePrompt);
  if (cachedAudio) {
    trackCacheHit();
    return cachedAudio;
  }
  
  // Step 4: Queue the TTS request with retry logic
  const audioBuffer = await queueTTSRequest(async () => {
    const quotaCheck = trackTTSRequest();
    if (!quotaCheck.allowed) {
      throw new Error(quotaCheck.warning || 'TTS quota exhausted');
    }
    if (quotaCheck.warning) {
      console.warn(`[TTSv2] ${quotaCheck.warning}`);
    }
    
    const MAX_RETRIES = 3;
    let lastError: any;
    
    // Build final prompt: "[Style instructions] Say the following: [clean text]"
    // Declared outside try block so it's accessible in catch for fallback retry
    const finalPrompt = stylePrompt 
      ? `${stylePrompt} Say the following: ${cleanText}`
      : cleanText;
    
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const client = getGeminiClient();
        
        console.log(`[TTSv2] Synthesizing: model=${model}, voice=${voiceName}, textLen=${cleanText.length}, hasStyle=${!!stylePrompt}, key=${getActiveKeyName()}${attempt > 0 ? `, attempt ${attempt + 1}/${MAX_RETRIES}` : ''}`);
        
        // Timeout based on text length
        const baseTimeout = 90000;
        const perCharTimeout = Math.ceil(cleanText.length / 500) * 30000;
        const timeoutMs = Math.min(baseTimeout + perCharTimeout, 300000);
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);
        
        let response;
        try {
          response = await client.models.generateContent({
            model,
            contents: [{ parts: [{ text: finalPrompt }] }],
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName,
                  },
                },
              },
            },
          });
        } finally {
          clearTimeout(timeoutId);
        }

        const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        
        if (!audioData) {
          console.error('[TTSv2] No audio data in response:', JSON.stringify(response, null, 2));
          throw new Error('No audio data received from Gemini TTS');
        }

        const audioBuffer = Buffer.from(audioData, 'base64');
        const header = audioBuffer.slice(0, 4).toString('utf-8');
        console.log(`[TTSv2] Received ${audioBuffer.length} bytes, format: "${header}"`);
        
        let wavBuffer: Buffer;
        
        // Convert PCM to WAV if needed
        if (header !== 'RIFF') {
          console.log('[TTSv2] Converting LINEAR16 PCM to WAV');
          wavBuffer = createWavBuffer(audioBuffer, 1, 24000, 2);
        } else {
          // Use Gemini WAV output directly (simple approach works best)
          wavBuffer = audioBuffer;
        }
        
        return wavBuffer;
        
      } catch (error: any) {
        lastError = error;
        const isTimeout = error?.name === 'AbortError' || error?.message?.includes('timeout');
        const isQuota = error?.message?.includes('quota') || error?.message?.includes('429');
        const isNoAudioData = error?.message?.includes('No audio data');
        const isTransient = error?.message?.includes('500') || error?.message?.includes('503') || isTimeout || isNoAudioData;
        
        if (isQuota) {
          console.error(`[TTSv2] QUOTA ERROR on ${getActiveKeyName()}: ${error.message}`);
          
          // Try to switch to secondary key and retry
          const fallbackClient = markPrimaryExhausted();
          if (fallbackClient && clientState.activeKey === 'secondary') {
            console.log(`[TTSv2] 🔄 Retrying with secondary API key...`);
            
            try {
              const retryResponse = await fallbackClient.models.generateContent({
                model,
                contents: [{ parts: [{ text: finalPrompt }] }],
                config: {
                  responseModalities: ['AUDIO'],
                  speechConfig: {
                    voiceConfig: {
                      prebuiltVoiceConfig: {
                        voiceName,
                      },
                    },
                  },
                },
              });
              
              const retryAudioData = retryResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
              if (retryAudioData) {
                console.log(`[TTSv2] ✅ Secondary key succeeded!`);
                const retryBuffer = Buffer.from(retryAudioData, 'base64');
                const retryHeader = retryBuffer.slice(0, 4).toString('utf-8');
                
                let retryWavBuffer: Buffer;
                if (retryHeader !== 'RIFF') {
                  retryWavBuffer = createWavBuffer(retryBuffer, 1, 24000, 2);
                } else {
                  // Use Gemini WAV output directly
                  retryWavBuffer = retryBuffer;
                }
                return retryWavBuffer;
              }
            } catch (retryError: any) {
              console.error(`[TTSv2] Secondary key also failed: ${retryError.message}`);
              throw new Error(`Both API keys exhausted. Primary and secondary quota exceeded.`);
            }
          }
          
          throw error;
        }
        
        if (isTransient && attempt < MAX_RETRIES - 1) {
          const backoffMs = Math.pow(2, attempt) * 1000 + Math.random() * 500;
          console.warn(`[TTSv2] Transient error (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${Math.round(backoffMs)}ms: ${error.message}`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          continue;
        }
        
        console.error(`[TTSv2] API Error: ${error.message}`);
      }
    }
    
    throw lastError || new Error('Gemini TTS synthesis failed after retries');
  });
  
  // Step 5: Cache the result
  setCachedAudio(cleanText, voiceName, stylePrompt, audioBuffer);
  
  return audioBuffer;
}

// ========================================
// 12. MULTI-SPEAKER SYNTHESIS V2
// ========================================

export interface SpeakerConfig {
  name: string;
  voiceName: string;
}

/**
 * Synthesize multi-speaker audio using natural language prompting
 * Supports up to 2 speakers
 */
export async function synthesizeMultiSpeakerV2(
  text: string,
  speakers: SpeakerConfig[],
  model: GeminiTTSModel = 'gemini-2.5-flash-preview-tts',
  options?: { templateCategory?: string }
): Promise<Buffer> {
  if (speakers.length > 2) {
    throw new Error('Gemini TTS supports maximum 2 speakers.');
  }
  
  // Clean text of all bracket tags
  const { cleanText } = cleanTextForTTS(text);
  console.log(`[TTSv2 Multi] Cleaned text: ${text.length} → ${cleanText.length} chars`);
  
  // Build context prefix for conversation style
  let contextPrefix = '';
  if (options?.templateCategory && TEMPLATE_CONTEXT_PROMPTS[options.templateCategory]) {
    const templateContexts: Record<string, string> = {
      'news': 'This is a professional news discussion between anchors. Speak in a clear, authoritative tone.',
      'stories': 'This is an engaging storytelling dialogue with expressive narration. Speak with warmth and emotion.',
      'teachme': 'This is an educational conversation between an instructor and curious learner. Speak clearly and patiently.',
      'custom': 'This is a friendly podcast conversation between hosts. Speak naturally and conversationally.',
      'sports': 'This is an energetic sports commentary discussion. Speak with enthusiasm and energy.',
      'events': 'This is an enthusiastic event coverage dialogue. Speak with excitement and engagement.',
      'medical': 'This is an educational medical discussion. Speak clearly and professionally.',
      'documents': 'This is a document summary discussion. Speak clearly and informatively.',
    };
    contextPrefix = templateContexts[options.templateCategory] 
      ? `${templateContexts[options.templateCategory]}\n\n` 
      : '';
  }
  
  const prompt = `${contextPrefix}TTS the following conversation:\n${cleanText}`;
  
  const quotaCheck = trackTTSRequest();
  if (!quotaCheck.allowed) {
    throw new Error(quotaCheck.warning || 'TTS quota exhausted');
  }
  
  const MAX_RETRIES = 3;
  let lastError: any;
  
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const client = getGeminiClient();
      
      console.log(`[TTSv2 Multi] Attempt ${attempt + 1}/${MAX_RETRIES}: speakers=${speakers.map(s => s.name).join(', ')}`);
      
      const response = await client.models.generateContent({
        model,
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            multiSpeakerVoiceConfig: {
              speakerVoiceConfigs: speakers.map(speaker => ({
                speaker: speaker.name,
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: speaker.voiceName,
                  },
                },
              })),
            },
          },
        },
      });
      
      const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      
      if (!audioData) {
        throw new Error('No audio data received from Gemini TTS');
      }

      const audioBuffer = Buffer.from(audioData, 'base64');
      const header = audioBuffer.slice(0, 4).toString('utf-8');
      console.log(`[TTSv2 Multi] Received ${audioBuffer.length} bytes, format: "${header}"`);
      
      let wavBuffer: Buffer;
      
      if (header !== 'RIFF') {
        console.log('[TTSv2 Multi] Converting LINEAR16 PCM to WAV');
        wavBuffer = createWavBuffer(audioBuffer, 1, 24000, 2);
      } else {
        // Use Gemini WAV output directly (simple approach works best)
        wavBuffer = audioBuffer;
      }
      
      return wavBuffer;
      
    } catch (error: any) {
      lastError = error;
      const isQuota = error?.message?.includes('quota') || error?.message?.includes('429');
      const isTransient = error?.message?.includes('500') || error?.message?.includes('503') || error?.message?.includes('No audio data');
      
      if (isQuota) {
        console.error(`[TTSv2 Multi] QUOTA ERROR on ${getActiveKeyName()}: ${error.message}`);
        
        // Try to switch to secondary key and retry
        const fallbackClient = markPrimaryExhausted();
        if (fallbackClient && clientState.activeKey === 'secondary') {
          console.log(`[TTSv2 Multi] 🔄 Retrying with secondary API key...`);
          
          try {
            const retryResponse = await fallbackClient.models.generateContent({
              model,
              contents: [{ parts: [{ text: prompt }] }],
              config: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                  multiSpeakerVoiceConfig: {
                    speakerVoiceConfigs: speakers.map(speaker => ({
                      speaker: speaker.name,
                      voiceConfig: {
                        prebuiltVoiceConfig: {
                          voiceName: speaker.voiceName,
                        },
                      },
                    })),
                  },
                },
              },
            });
            
            const retryAudioData = retryResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (retryAudioData) {
              console.log(`[TTSv2 Multi] ✅ Secondary key succeeded!`);
              const retryBuffer = Buffer.from(retryAudioData, 'base64');
              const retryHeader = retryBuffer.slice(0, 4).toString('utf-8');
              
              let retryWavBuffer: Buffer;
              if (retryHeader !== 'RIFF') {
                retryWavBuffer = createWavBuffer(retryBuffer, 1, 24000, 2);
              } else {
                // Use Gemini WAV output directly
                retryWavBuffer = retryBuffer;
              }
              return retryWavBuffer;
            }
          } catch (retryError: any) {
            console.error(`[TTSv2 Multi] Secondary key also failed: ${retryError.message}`);
            throw new Error(`Both API keys exhausted. Primary and secondary quota exceeded.`);
          }
        }
        
        throw error;
      }
      
      if (isTransient && attempt < MAX_RETRIES - 1) {
        const backoffMs = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        console.warn(`[TTSv2 Multi] Transient error, retrying in ${Math.round(backoffMs)}ms`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        continue;
      }
    }
  }
  
  throw lastError || new Error('Gemini TTS multi-speaker synthesis failed after retries');
}

// ========================================
// 13. LONG-FORM SYNTHESIS V2
// ========================================

/**
 * Synthesize long-form content by splitting into chunks
 * Returns array of WAV buffers (caller concatenates)
 * Target: 4500 chars per chunk (~6 minutes of audio)
 */
export async function synthesizeLongFormV2(
  text: string,
  voiceName: string,
  chunkSize: number = 4500,
  model: GeminiTTSModel = 'gemini-2.5-flash-preview-tts',
  options?: SynthesisOptionsV2
): Promise<Buffer[]> {
  const chunks = splitIntoChunks(text, chunkSize);
  
  console.log(`[TTSv2 LongForm] Synthesizing ${chunks.length} chunks for voice: ${voiceName}`);
  
  // Parallel synthesis with rate limit queuing
  const synthesisPromises = chunks.map((chunk, index) => {
    return (async () => {
      console.log(`[TTSv2 LongForm] Queuing chunk ${index + 1}/${chunks.length}`);
      const audioBuffer = await synthesizeSingleSpeakerV2(chunk.text, voiceName, model, options);
      console.log(`[TTSv2 LongForm] Completed chunk ${index + 1}/${chunks.length}`);
      return audioBuffer;
    })();
  });
  
  const audioBuffers = await Promise.all(synthesisPromises);
  
  console.log(`[TTSv2 LongForm] All ${chunks.length} chunks synthesized successfully`);
  
  return audioBuffers;
}

/**
 * Convenience function to synthesize and concatenate long-form content
 */
export async function synthesizeLongFormConcatenatedV2(
  text: string,
  voiceName: string,
  chunkSize: number = 4500,
  model: GeminiTTSModel = 'gemini-2.5-flash-preview-tts',
  options?: SynthesisOptionsV2
): Promise<Buffer> {
  const buffers = await synthesizeLongFormV2(text, voiceName, chunkSize, model, options);
  return concatenateAudioBuffers(buffers);
}

// ========================================
// 14. WATERMARK GENERATION V2
// ========================================

interface WatermarkEntry {
  intro: Buffer;
  outro: Buffer;
}

const watermarkCacheV2 = new Map<string, WatermarkEntry>();

/**
 * Generate watermark audio (intro/outro) for branding
 * Uses natural language prompting (no SSML)
 */
export async function generateWatermarksV2(voiceName: string): Promise<{ intro: Buffer; outro: Buffer }> {
  console.log(`[Watermarks V2] Generating for voice: ${voiceName}`);
  
  const introSilence = generateSilence(1);
  
  const [introSpeech, outro] = await Promise.all([
    synthesizeSingleSpeakerV2(
      "It's brew time!",
      voiceName,
      'gemini-2.5-flash-preview-tts',
      { podcastContext: 'host' }
    ),
    synthesizeSingleSpeakerV2(
      "You've been listening to a PodBrew creation.",
      voiceName,
      'gemini-2.5-flash-preview-tts',
      { podcastContext: 'host' }
    ),
  ]);
  
  const intro = await concatenateAudioBuffers([introSilence, introSpeech]);
  console.log(`[Watermarks V2] Intro generated: ${intro.length} bytes`);
  console.log(`[Watermarks V2] Outro generated: ${outro.length} bytes`);
  
  return { intro, outro };
}

/**
 * Get cached watermarks or generate new ones
 */
export async function getWatermarksV2(voiceName: string): Promise<{ intro: Buffer; outro: Buffer }> {
  if (watermarkCacheV2.has(voiceName)) {
    console.log(`[Watermarks V2] Cache HIT for: ${voiceName}`);
    return watermarkCacheV2.get(voiceName)!;
  }
  
  // Check database for pre-generated watermarks
  try {
    const voice = await db.select().from(voicesTable).where(eq(voicesTable.googleVoiceName, voiceName)).limit(1);
    
    if (voice.length > 0 && voice[0].watermarkIntroUrl && voice[0].watermarkOutroUrl) {
      console.log(`[Watermarks V2] Found pre-generated in DB for: ${voiceName}`);
      
      const objectStorage = new ObjectStorageService();
      const introMp3 = await objectStorage.downloadPublicObjectAsBuffer(voice[0].watermarkIntroUrl);
      const outroMp3 = await objectStorage.downloadPublicObjectAsBuffer(voice[0].watermarkOutroUrl);
      
      if (introMp3 && outroMp3) {
        const intro = await convertMp3ToWav(introMp3);
        const outro = await convertMp3ToWav(outroMp3);
        const watermarks = { intro, outro };
        watermarkCacheV2.set(voiceName, watermarks);
        return watermarks;
      }
    }
  } catch (error) {
    console.warn(`[Watermarks V2] DB/storage lookup failed, generating fresh:`, error);
  }
  
  // Generate new watermarks
  const watermarks = await generateWatermarksV2(voiceName);
  watermarkCacheV2.set(voiceName, watermarks);
  return watermarks;
}

// ========================================
// 15. EXPORTS
// ========================================

export {
  EMOTION_STYLE_MAP,
  SPEED_STYLE_MAP,
  ACCENT_STYLE_MAP,
  PODCAST_CONTEXT_PROMPTS,
  TEMPLATE_CONTEXT_PROMPTS,
};
