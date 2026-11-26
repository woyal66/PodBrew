import { GoogleGenAI } from '@google/genai';
import * as wav from 'wav';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { concatenateAudioBuffers, convertMp3ToWav } from './audioUtils';
import { db } from './db';
import { voices as voicesTable } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { ObjectStorageService } from './objectStorage';

// Initialize Gemini AI client using Google Cloud API key
// CRITICAL: Uses GOOGLE_CLOUD_API_KEY (Google Cloud project key) instead of free tier key
let geminiClient: GoogleGenAI | null = null;

/**
 * TTS Synthesis Cache (Option C: Optimization)
 * Reduces API calls by caching synthesized segments
 * Cache key: hash(text + voice + emotion)
 * Max size: 500 segments (~200MB RAM)
 */
interface CacheEntry {
  audio: Buffer;
  timestamp: number;
  textLength: number;
}

const synthesisCache = new Map<string, CacheEntry>();
const MAX_CACHE_SIZE = 500;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Global Watermark Cache (Tier 1 Optimization)
 * Caches intro/outro watermarks per voice to avoid duplicate TTS requests
 * Watermarks are generated once per voice and reused for all podcasts
 */
interface WatermarkEntry {
  intro: Buffer;
  outro: Buffer;
}

const watermarkCache = new Map<string, WatermarkEntry>();

/**
 * Daily Quota Tracking (Tier 1 Protection)
 * Tracks TTS API requests per day to warn before hitting quota limits
 * 
 * Tier 1 limits (Gemini 2.5 Flash TTS):
 * - 10 RPM (Requests Per Minute)
 * - 100 RPD (Requests Per Day)
 * 
 * Tier 2 limits (requires $250 spend + 30 days):
 * - 60 RPM
 * - 1000 RPD
 */
interface QuotaStats {
  date: string;           // YYYY-MM-DD format
  requestCount: number;   // Total requests today
  cachedHits: number;     // Requests served from cache (no API call)
  lastResetTime: number;  // Timestamp of last reset
}

// In-memory quota tracking (resets on server restart, but provides session protection)
// Note: Initial date will be corrected to Pacific Time on first quota check
let dailyQuotaStats: QuotaStats = {
  date: '', // Will be set on first checkAndResetDailyQuota() call
  requestCount: 0,
  cachedHits: 0,
  lastResetTime: Date.now()
};

// Tier limits (configurable based on your Google Cloud tier)
const TIER_LIMITS = {
  tier1: { rpm: 10, rpd: 100 },
  tier2: { rpm: 60, rpd: 1000 },
  tier3: { rpm: 300, rpd: 5000 }
};

// Current tier (can be overridden via env var)
const CURRENT_TIER = (process.env.GEMINI_TTS_TIER as 'tier1' | 'tier2' | 'tier3') || 'tier1';
const QUOTA_WARNING_THRESHOLD = 0.8; // Warn at 80% usage

/**
 * Get current date in Pacific Time (Google Cloud quota reset time)
 * Handles both PST (UTC-8) and PDT (UTC-7) automatically
 */
function getPacificDate(): string {
  return new Date().toLocaleDateString('en-CA', { 
    timeZone: 'America/Los_Angeles' 
  }); // Returns YYYY-MM-DD format
}

/**
 * Check and reset daily quota if date has changed (Pacific Time)
 */
function checkAndResetDailyQuota(): void {
  const today = getPacificDate();
  if (dailyQuotaStats.date !== today) {
    console.log(`[Quota] 📅 New day detected (Pacific Time). Resetting daily quota. Previous: ${dailyQuotaStats.requestCount}/${TIER_LIMITS[CURRENT_TIER].rpd} requests`);
    dailyQuotaStats = {
      date: today,
      requestCount: 0,
      cachedHits: 0,
      lastResetTime: Date.now()
    };
  }
}

/**
 * Increment request count and check for quota warnings
 * @returns true if request is allowed, false if quota exhausted
 */
function trackTTSRequest(): { allowed: boolean; warning?: string } {
  checkAndResetDailyQuota();
  
  const limit = TIER_LIMITS[CURRENT_TIER].rpd;
  dailyQuotaStats.requestCount++;
  
  const usagePercent = dailyQuotaStats.requestCount / limit;
  
  // Check if quota exhausted
  if (dailyQuotaStats.requestCount > limit) {
    console.error(`[Quota] ❌ DAILY QUOTA EXHAUSTED: ${dailyQuotaStats.requestCount}/${limit} (${CURRENT_TIER})`);
    console.error(`[Quota] Consider upgrading to Tier 2: Spend $250 on Google Cloud + wait 30 days`);
    return { 
      allowed: false, 
      warning: `Daily TTS quota exhausted (${limit} requests). Quota resets at midnight Pacific Time. Consider upgrading to Tier 2.`
    };
  }
  
  // Warning at 80% usage
  if (usagePercent >= QUOTA_WARNING_THRESHOLD && usagePercent < 1) {
    const remaining = limit - dailyQuotaStats.requestCount;
    console.warn(`[Quota] ⚠️ HIGH USAGE: ${dailyQuotaStats.requestCount}/${limit} requests (${(usagePercent * 100).toFixed(0)}%) - ${remaining} remaining`);
    return { 
      allowed: true, 
      warning: `TTS quota ${(usagePercent * 100).toFixed(0)}% used. ${remaining} requests remaining today.`
    };
  }
  
  // Log at 50% usage
  if (usagePercent >= 0.5 && Math.floor(usagePercent * 10) !== Math.floor((usagePercent - 1/limit) * 10)) {
    console.log(`[Quota] 📊 Usage: ${dailyQuotaStats.requestCount}/${limit} requests (${(usagePercent * 100).toFixed(0)}%)`);
  }
  
  return { allowed: true };
}

/**
 * Track a cache hit (no API call needed)
 */
function trackCacheHit(): void {
  checkAndResetDailyQuota();
  dailyQuotaStats.cachedHits++;
}

/**
 * Get current quota stats (for API endpoint)
 */
export function getQuotaStats(): {
  tier: string;
  today: string;
  requests: number;
  cacheHits: number;
  limit: number;
  remaining: number;
  usagePercent: number;
  status: 'ok' | 'warning' | 'exhausted';
} {
  checkAndResetDailyQuota();
  
  const limit = TIER_LIMITS[CURRENT_TIER].rpd;
  const remaining = Math.max(0, limit - dailyQuotaStats.requestCount);
  const usagePercent = (dailyQuotaStats.requestCount / limit) * 100;
  
  let status: 'ok' | 'warning' | 'exhausted' = 'ok';
  if (dailyQuotaStats.requestCount >= limit) {
    status = 'exhausted';
  } else if (usagePercent >= QUOTA_WARNING_THRESHOLD * 100) {
    status = 'warning';
  }
  
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

function getCacheKey(text: string, voiceName: string): string {
  return crypto
    .createHash('sha256')
    .update(`${text}|${voiceName}`)
    .digest('hex');
}

function getCachedAudio(text: string, voiceName: string): Buffer | null {
  const key = getCacheKey(text, voiceName);
  const entry = synthesisCache.get(key);
  
  if (entry) {
    // Check if cache entry expired
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      synthesisCache.delete(key);
      console.log(`[TTS Cache] Expired cache entry for voice: ${voiceName}`);
      return null;
    }
    
    console.log(`[TTS Cache] HIT: voice=${voiceName}, textLen=${entry.textLength}`);
    return entry.audio;
  }
  
  return null;
}

function setCachedAudio(text: string, voiceName: string, audio: Buffer): void {
  // Implement LRU eviction: remove oldest entry if cache full
  if (synthesisCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = Array.from(synthesisCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0];
    synthesisCache.delete(oldestKey);
    console.log(`[TTS Cache] Evicted oldest entry (cache size: ${MAX_CACHE_SIZE})`);
  }
  
  const key = getCacheKey(text, voiceName);
  synthesisCache.set(key, {
    audio,
    timestamp: Date.now(),
    textLength: text.length,
  });
  
  console.log(`[TTS Cache] STORED: voice=${voiceName}, textLen=${text.length}, cacheSize=${synthesisCache.size}/${MAX_CACHE_SIZE}`);
}

/**
 * Concurrent TTS Queue with Semaphore-based Rate Limiting
 * 
 * OPTIMIZATION: Allows 2-3 concurrent TTS requests instead of sequential processing
 * This cuts 30-min podcast generation from ~15 min to ~6 min (60% faster!)
 * 
 * Rate limit safety:
 * - Gemini 2.5 Flash TTS: 10 requests/min default quota
 * - With maxConcurrent=2: max 2 in-flight requests, 1s stagger = ~8 RPM (safe)
 * - With maxConcurrent=3: max 3 in-flight requests, 1.5s stagger = ~7 RPM (safe)
 */
interface QueuedRequest {
  fn: () => Promise<Buffer>;
  resolve: (value: Buffer) => void;
  reject: (error: any) => void;
  priority?: number; // Lower = higher priority (for watermarks)
}

// Semaphore-based concurrent queue configuration
// OPTIMIZATION: Increased to 5 concurrent for Google Cloud API key (higher quotas than free tier)
// With 400ms stagger: ~7.5 RPM burst, well under Google Cloud limits
const MAX_CONCURRENT = 5; // 5 concurrent requests (safe for Google Cloud quotas)
const MIN_STAGGER_MS = 400; // 400ms stagger between starting new requests
const requestQueue: QueuedRequest[] = [];
let activeCount = 0;
let lastRequestTime = 0;

async function processNextRequest(): Promise<void> {
  // Check if we can start a new request
  if (activeCount >= MAX_CONCURRENT || requestQueue.length === 0) {
    return;
  }
  
  // Rate limit: ensure minimum time between request starts
  const now = Date.now();
  const timeSinceLast = now - lastRequestTime;
  if (timeSinceLast < MIN_STAGGER_MS && lastRequestTime > 0) {
    // Schedule retry after stagger period
    setTimeout(() => processNextRequest(), MIN_STAGGER_MS - timeSinceLast);
    return;
  }
  
  // Get next request from queue
  const request = requestQueue.shift();
  if (!request) return;
  
  // Update state
  activeCount++;
  lastRequestTime = Date.now();
  
  const queueDepth = requestQueue.length;
  console.log(`[TTS Queue] Starting request (active: ${activeCount}/${MAX_CONCURRENT}, pending: ${queueDepth})`);
  
  try {
    const result = await request.fn();
    request.resolve(result);
  } catch (error) {
    request.reject(error);
  } finally {
    activeCount--;
    console.log(`[TTS Queue] Request complete (active: ${activeCount}/${MAX_CONCURRENT}, pending: ${requestQueue.length})`);
    // Try to start next request(s)
    processNextRequest();
  }
}

function queueTTSRequest(fn: () => Promise<Buffer>, priority: number = 10): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const request: QueuedRequest = { fn, resolve, reject, priority };
    
    // Insert based on priority (lower = higher priority)
    const insertIndex = requestQueue.findIndex(r => (r.priority || 10) > priority);
    if (insertIndex === -1) {
      requestQueue.push(request);
    } else {
      requestQueue.splice(insertIndex, 0, request);
    }
    
    // Trigger processing - try to fill all available slots immediately
    processNextRequest();
    setTimeout(() => processNextRequest(), MIN_STAGGER_MS);
    setTimeout(() => processNextRequest(), MIN_STAGGER_MS * 2);
  });
}

function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) {
    // Use Google Cloud API key instead of free tier
    // GOOGLE_CLOUD_API_KEY = Your paid Google Cloud project API key (much higher quota)
    // This replaces the free tier GOOGLE_GENAI_API_KEY
    const apiKey = process.env.GOOGLE_CLOUD_API_KEY;
    
    if (!apiKey) {
      throw new Error('GOOGLE_CLOUD_API_KEY environment variable is not set. Please add your Google Cloud project API key to secrets.');
    }
    
    geminiClient = new GoogleGenAI({ apiKey });
    console.log('[Gemini TTS] Client initialized with Google Cloud API key (paid tier)');
  }
  
  return geminiClient;
}

/**
 * Available Gemini TTS voices (30 total)
 */
export const GEMINI_VOICES = [
  { name: 'Kore', description: 'Firm and confident, neutral professional voice', gender: 'MALE' },
  { name: 'Puck', description: 'Upbeat and energetic, conversational and friendly', gender: 'FEMALE' },
  { name: 'Charon', description: 'Deep authoritative voice, informative and clear', gender: 'MALE' },
  { name: 'Fenrir', description: 'Warm and approachable, excitable and dynamic', gender: 'MALE' },
  { name: 'Aoede', description: 'Melodic and expressive voice', gender: 'FEMALE' },
  { name: 'Achernar', description: 'Soft and gentle voice', gender: 'FEMALE' },
  { name: 'Achird', description: 'Friendly and approachable', gender: 'NEUTRAL' },
  { name: 'Algenib', description: 'Gravelly texture voice', gender: 'MALE' },
  { name: 'Algieba', description: 'Smooth and pleasant', gender: 'FEMALE' },
  { name: 'Alnilam', description: 'Firm and strong', gender: 'MALE' },
  { name: 'Autonoe', description: 'Bright and optimistic', gender: 'FEMALE' },
  { name: 'Callirhoe', description: 'Easy-going and relaxed', gender: 'FEMALE' },
  { name: 'Despina', description: 'Smooth and flowing', gender: 'FEMALE' },
  { name: 'Enceladus', description: 'Breathy and soft', gender: 'MALE' },
  { name: 'Erinome', description: 'Clear and precise', gender: 'FEMALE' },
  { name: 'Gacrux', description: 'Mature and experienced', gender: 'MALE' },
  { name: 'Iapetus', description: 'Clear and articulate', gender: 'MALE' },
  { name: 'Laomedeia', description: 'Upbeat and lively', gender: 'FEMALE' },
  { name: 'Leda', description: 'Youthful and energetic', gender: 'FEMALE' },
  { name: 'Orus', description: 'Firm and decisive', gender: 'MALE' },
  { name: 'Pulcherrima', description: 'Forward and expressive', gender: 'FEMALE' },
  { name: 'Rasalgethi', description: 'Informative and professional', gender: 'MALE' },
  { name: 'Sadachbia', description: 'Lively and animated', gender: 'FEMALE' },
  { name: 'Sadaltager', description: 'Knowledgeable and authoritative', gender: 'MALE' },
  { name: 'Schedar', description: 'Professional and composed', gender: 'FEMALE' },
  { name: 'Sulafat', description: 'Warm and welcoming', gender: 'FEMALE' },
  { name: 'Umbriel', description: 'Calm and measured', gender: 'MALE' },
  { name: 'Vindemiatrix', description: 'Gentle and kind', gender: 'FEMALE' },
  { name: 'Zephyr', description: 'Bright and cheerful', gender: 'FEMALE' },
  { name: 'Zubenelgenubi', description: 'Steady and reliable', gender: 'MALE' },
] as const;

/**
 * Complete list of all Gemini 2.5 Flash TTS supported emotion tags
 * Based on official Google documentation and testing (December 2025 update)
 * @see https://ai.google.dev/gemini-api/docs/speech-generation
 * @see https://cloud.google.com/text-to-speech/docs/gemini-tts#prompting_tips
 */
export const GEMINI_EMOTION_TAGS = [
  // === BASIC EMOTIONS ===
  'excited', 'happy', 'sad', 'angry', 'fearful', 'surprised', 'disgusted', 'neutral',
  
  // === HAPPINESS VARIANTS ===
  'joyful', 'cheerful', 'playful', 'enthusiastic', 'elated', 'hopeful',
  
  // === SADNESS VARIANTS ===
  'melancholic', 'disappointed', 'grieving', 'wistful', 'nostalgic', 'heartbroken',
  
  // === ANGER VARIANTS ===
  'furious', 'frustrated', 'annoyed', 'irritated', 'outraged',
  
  // === FEAR VARIANTS ===
  'nervous', 'anxious', 'terrified', 'worried', 'panicked', 'uneasy',
  
  // === SURPRISE VARIANTS ===
  'shocked', 'amazed', 'confused', 'bewildered', 'astonished', 'startled',
  
  // === CALM VARIANTS ===
  'calm', 'relaxed', 'soothing', 'peaceful', 'serene', 'tranquil', 'meditative',
  
  // === CONFIDENCE SPECTRUM ===
  'confident', 'proud', 'determined', 'assertive', 'bold', 'commanding',
  
  // === SARCASM/HUMOR ===
  'sarcastic', 'mocking', 'teasing', 'hysterical', 'witty', 'dry-humor',
  
  // === DELIVERY STYLES ===
  'serious', 'friendly', 'dramatic', 'professional', 'curious', 'spooky',
  'warm', 'empathetic', 'scornful', 'intimate', 'mysterious', 'conspiratorial',
  'theatrical', 'matter-of-fact', 'deadpan',
  
  // === ENERGY STATES ===
  'tired', 'exhausted', 'sleepy', 'bored', 'dreamy', 'breathless', 'energized',
  
  // === VOCAL EFFECTS (Core) ===
  'laugh', 'chuckle', 'sigh', 'gasp', 'breath', 'whisper', 'giggle',
  'hearty-laugh', 'nervous-laugh', 'crying', 'coughing', 'uhm', 'ah',
  
  // === VOCAL EFFECTS (Extended - December 2025) ===
  'yawn', 'sniff', 'sob', 'grunt', 'hum', 'stammer', 'stutter',
  'clear-throat', 'sharp-inhale', 'relieved-sigh', 'shaky-voice',
  'trembling', 'choked-up', 'breaking-voice', 'quivering',
] as const;

/**
 * Speed control tags based on Google's Gemini TTS documentation
 * These can be used inline: "[extremely fast] This text will be spoken quickly"
 * @see https://cloud.google.com/text-to-speech/docs/gemini-tts#prompting_tips
 */
export const GEMINI_SPEED_TAGS = [
  'extremely slow', 'very slow', 'slow', 'medium', 'fast', 'very fast', 'extremely fast',
] as const;

/**
 * Accent/dialect modifiers for natural language steering
 * These allow accent control: "[british] Hello there!"
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

/**
 * Options for enhanced TTS synthesis with Google best practices
 */
export interface TTSPromptOptions {
  /** Podcast context type for scene-setting prompts */
  podcastContext?: PodcastContextType;
  /** Template category for context-appropriate delivery */
  templateCategory?: string;
  /** Whether this is a multi-speaker conversation */
  isConversation?: boolean;
}

/**
 * Convert emotion, speed, and accent markers to natural language style prompts for Gemini TTS
 * Enhanced based on Google's Gemini TTS prompting tips:
 * @see https://cloud.google.com/text-to-speech/docs/gemini-tts#prompting_tips
 * 
 * Supports:
 * - Emotion markers: [excited], [sad], [laugh], etc.
 * - Speed tags: [slow], [fast], [extremely fast] (Google's inline speed control)
 * - Accent modifiers: [british], [australian], [indian], etc.
 * - Contextual scene-setting for podcast-quality delivery
 * 
 * @param text - Text with markers like [excited], [extremely fast], [british], etc.
 * @param options - Optional context for enhanced prompting
 * @returns Natural language prompt for Gemini TTS and cleaned text
 */
export function emotionToNaturalLanguage(text: string, options?: TTSPromptOptions): { prompt: string; cleanText: string } {
  // Build dynamic regex patterns for all tag types
  const emotionTagsPattern = GEMINI_EMOTION_TAGS.join('|');
  const speedTagsPattern = GEMINI_SPEED_TAGS.join('|');
  const accentTagsPattern = GEMINI_ACCENT_TAGS.join('|');
  
  // Combined pattern to extract all tags
  const emotionPattern = new RegExp(`\\[(${emotionTagsPattern})\\]`, 'gi');
  const speedPattern = new RegExp(`\\[(${speedTagsPattern})\\]`, 'gi');
  const accentPattern = new RegExp(`\\[(${accentTagsPattern})\\]`, 'gi');
  
  const emotions: string[] = [];
  const speeds: string[] = [];
  const accents: string[] = [];
  
  // Extract and remove emotion tags
  let cleanText = text.replace(emotionPattern, (match, emotion) => {
    emotions.push(emotion.toLowerCase());
    return '';
  });
  
  // Extract and remove speed tags
  cleanText = cleanText.replace(speedPattern, (match, speed) => {
    speeds.push(speed.toLowerCase());
    return '';
  });
  
  // Extract and remove accent tags
  cleanText = cleanText.replace(accentPattern, (match, accent) => {
    accents.push(accent.toLowerCase());
    return '';
  });
  
  cleanText = cleanText.trim();
  
  // Build comprehensive natural language style prompt
  const promptParts: string[] = [];
  
  // === PODCAST CONTEXT (Scene-Setting) ===
  // Based on Google's recommendation for contextual prompts
  if (options?.podcastContext) {
    const contextPrompts: Record<PodcastContextType, string> = {
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
    promptParts.push(contextPrompts[options.podcastContext]);
  }
  
  // === TEMPLATE-BASED CONTEXT ===
  if (options?.templateCategory && !options?.podcastContext) {
    const templateContexts: Record<string, string> = {
      'news': 'You are a professional news anchor.',
      'stories': 'You are an expressive storyteller.',
      'teachme': 'You are a patient and engaging educator.',
      'medical': 'You are a knowledgeable healthcare professional.',
      'sports': 'You are an energetic sports commentator.',
      'events': 'You are an enthusiastic event announcer.',
      'custom': 'You are a friendly podcast host.',
      'documents': 'You are clearly presenting information.',
    };
    if (templateContexts[options.templateCategory]) {
      promptParts.push(templateContexts[options.templateCategory]);
    }
  }
  
  // === ACCENT/DIALECT MODIFIERS ===
  if (accents.length > 0) {
    const primaryAccent = accents[0];
    const accentStyles: Record<string, string> = {
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
    if (accentStyles[primaryAccent]) {
      promptParts.push(`Speak ${accentStyles[primaryAccent]}.`);
    }
  }
  
  // === SPEED CONTROL ===
  // Google's inline speed control: [extremely fast], [slow], etc.
  if (speeds.length > 0) {
    const primarySpeed = speeds[0];
    const speedStyles: Record<string, string> = {
      'extremely slow': 'at an extremely slow, deliberate pace with long pauses',
      'very slow': 'at a very slow, measured pace',
      'slow': 'at a slow, unhurried pace',
      'medium': 'at a normal, conversational pace',
      'fast': 'at a brisk, energetic pace',
      'very fast': 'at a very fast, rapid pace',
      'extremely fast': 'at an extremely fast pace like reading disclaimers',
    };
    if (speedStyles[primarySpeed]) {
      promptParts.push(`Speak ${speedStyles[primarySpeed]}.`);
    }
  }
  
  // === EMOTION STYLES ===
  if (emotions.length > 0) {
    const primaryEmotion = emotions[0];
    
    // Comprehensive map of emotions/effects to natural language instructions for Gemini TTS
    // Optimized for Gemini 2.5 Flash with natural language control (December 2025 update)
    const emotionStyles: Record<string, string> = {
      // === BASIC EMOTIONS ===
      'excited': 'Say it in an excited, energetic tone with rising pitch and enthusiasm.',
      'happy': 'Say it in a cheerful, upbeat manner with a warm smile in your voice.',
      'sad': 'Say it in a somber, melancholic tone with slower pace and gentle delivery.',
      'angry': 'Say it in a firm, intense voice with emphasis and controlled frustration.',
      'fearful': 'Say it in a nervous, hesitant manner with slight trembling.',
      'surprised': 'Say it with a surprised, astonished tone and widened vocal expression.',
      'disgusted': 'Say it with a disapproving, slightly repulsed tone.',
      'neutral': 'Say it in a calm, neutral voice with even delivery.',
      
      // === HAPPINESS VARIANTS ===
      'joyful': 'Say it with pure joy and delight, voice bright and lifted.',
      'cheerful': 'Say it in a bright, optimistic and cheerful manner.',
      'playful': 'Say it with a playful, teasing quality and light-hearted tone.',
      'enthusiastic': 'Say it with genuine enthusiasm, energy, and passion.',
      'elated': 'Say it with overwhelming happiness and exhilaration.',
      'hopeful': 'Say it with optimism and hopeful anticipation.',
      
      // === SADNESS VARIANTS ===
      'melancholic': 'Say it with a deep, reflective sadness and wistful quality.',
      'disappointed': 'Say it with a tone of disappointment and let-down feeling.',
      'grieving': 'Say it with profound sorrow and emotional weight.',
      'wistful': 'Say it with a gentle, longing sadness and nostalgia.',
      'nostalgic': 'Say it with warm, bittersweet remembrance.',
      'heartbroken': 'Say it with deep emotional pain and heartache.',
      
      // === ANGER VARIANTS ===
      'furious': 'Say it with barely contained rage and intense emphasis.',
      'frustrated': 'Say it with clear frustration and exasperation.',
      'annoyed': 'Say it with mild irritation and impatience.',
      'irritated': 'Say it with slight annoyance and displeasure.',
      'outraged': 'Say it with righteous indignation and moral anger.',
      
      // === FEAR VARIANTS ===
      'nervous': 'Say it with nervous energy and slight uncertainty.',
      'anxious': 'Say it with underlying anxiety and worried undertone.',
      'terrified': 'Say it with genuine terror and fear in the voice.',
      'worried': 'Say it with a concerned, worried quality.',
      'panicked': 'Say it with urgent panic and rapid, breathless delivery.',
      'uneasy': 'Say it with subtle discomfort and apprehension.',
      
      // === SURPRISE VARIANTS ===
      'shocked': 'Say it with complete shock and disbelief.',
      'amazed': 'Say it with wonder and amazement.',
      'confused': 'Say it with a puzzled, questioning tone.',
      'bewildered': 'Say it with complete confusion and disorientation.',
      'astonished': 'Say it with utter astonishment and disbelief.',
      'startled': 'Say it with a sudden, startled reaction.',
      
      // === CALM VARIANTS ===
      'calm': 'Say it in a calm, relaxed manner with measured pace.',
      'relaxed': 'Say it in a laid-back, easy-going tone.',
      'soothing': 'Say it in a gentle, soothing voice that calms.',
      'peaceful': 'Say it with serene, peaceful delivery.',
      'serene': 'Say it with tranquil, undisturbed calmness.',
      'tranquil': 'Say it with deep inner peace and stillness.',
      'meditative': 'Say it with contemplative, centered mindfulness.',
      
      // === CONFIDENCE SPECTRUM ===
      'confident': 'Say it with self-assured confidence and authority.',
      'proud': 'Say it with pride and satisfaction in the voice.',
      'determined': 'Say it with determination and resolve.',
      'assertive': 'Say it with assertive, direct delivery.',
      'bold': 'Say it with bold, fearless conviction.',
      'commanding': 'Say it with authoritative, commanding presence.',
      
      // === SARCASM/HUMOR ===
      'sarcastic': 'Say it with dry sarcasm and ironic undertone.',
      'mocking': 'Say it with a mocking, slightly teasing quality.',
      'teasing': 'Say it with playful teasing and humor.',
      'hysterical': 'Say it with uncontrollable laughter and hilarity.',
      'witty': 'Say it with clever, quick-witted delivery.',
      'dry-humor': 'Say it with subtle, deadpan comedic timing.',
      
      // === DELIVERY STYLES ===
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
      
      // === ENERGY STATES ===
      'tired': 'Say it with fatigue and low energy in the voice.',
      'exhausted': 'Say it with complete exhaustion and weariness.',
      'sleepy': 'Say it with drowsy, sleepy delivery.',
      'bored': 'Say it with disinterest and monotone boredom.',
      'dreamy': 'Say it with soft, distant, dreamlike quality.',
      'breathless': 'Say it while catching your breath, with excited breathlessness.',
      'energized': 'Say it with high energy and vibrant enthusiasm.',
      
      // === VOCAL EFFECTS (Core) ===
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
      
      // === VOCAL EFFECTS (Extended - December 2025) ===
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
    
    if (emotionStyles[primaryEmotion]) {
      promptParts.push(emotionStyles[primaryEmotion]);
    }
  }
  
  // Build final prompt - join all parts with spaces
  const stylePrompt = promptParts.join(' ');
  
  return {
    prompt: stylePrompt,
    cleanText,
  };
}

/**
 * Legacy wrapper for backward compatibility
 * @deprecated Use emotionToNaturalLanguage with options instead
 */
export function emotionToNaturalLanguageLegacy(text: string): { prompt: string; cleanText: string } {
  return emotionToNaturalLanguage(text);
}

/**
 * Determine optimal temperature for Gemini TTS based on podcast mood (Phase 1 enhancement)
 * Lower temp (0.5) = neutral, higher temp (0.7) = more expressive
 */
export function getTemperatureForMood(mood: 'uplifting' | 'serious' | 'humorous' | 'mysterious' | 'balanced' | 'energetic' = 'balanced'): number {
  const moodTemperatures: Record<string, number> = {
    humorous: 0.7,      // More expressive for comedy
    energetic: 0.65,    // High energy
    uplifting: 0.65,    // Positive, optimistic
    balanced: 0.6,      // Natural, conversational
    serious: 0.5,       // Professional, controlled
    mysterious: 0.55,   // Measured, deliberate
  };
  return moodTemperatures[mood] || 0.6;
}

/**
 * Available Gemini TTS models based on Google Cloud documentation
 * @see https://cloud.google.com/text-to-speech/docs/gemini-tts
 * 
 * - gemini-2.5-flash-tts: Low latency, cost-efficient, single/multi-speaker
 * - gemini-2.5-pro-tts: High control for structured workflows like podcast generation, audiobooks
 * - gemini-2.5-flash-lite-preview-tts: Preview model for ultra-low latency (single-speaker only)
 */
export type GeminiTTSModel = 
  | 'gemini-2.5-flash-preview-tts'  // v1beta API requires preview versions
  | 'gemini-2.5-pro-preview-tts'    // v1beta API requires preview versions
  | 'gemini-2.5-flash-lite-preview-tts';

/**
 * Configuration for model selection
 */
export interface TTSModelConfig {
  /** User's subscription plan */
  plan?: 'free' | 'starter' | 'creator' | 'studio' | 'pro' | 'professional' | 'enterprise';
  /** Template category for the podcast */
  templateCategory?: string;
  /** Whether this is premium/high-quality content */
  isPremium?: boolean;
  /** Whether this is a story/audiobook template (benefits from Pro model) */
  isStoryContent?: boolean;
}

/**
 * Select the optimal Gemini TTS model based on content type and user tier
 * 
 * Google recommends:
 * - Flash: Everyday applications, cost-efficient
 * - Pro: "Optimized for podcast generation, audiobooks, customer support"
 * 
 * @param config - Configuration for model selection
 * @returns The appropriate Gemini TTS model ID
 */
export function selectTTSModel(config: TTSModelConfig = {}): GeminiTTSModel {
  const { plan, templateCategory, isPremium, isStoryContent } = config;
  
  // Pro model for premium content types (per Google's recommendation)
  const proEligibleTemplates = ['stories', 'medical', 'teachme'];
  // Include ALL paid plan tiers: creator, studio, pro, professional, enterprise
  const isPaidPlan = plan && ['creator', 'studio', 'pro', 'professional', 'enterprise'].includes(plan);
  
  // Use Pro model for:
  // 1. Story/audiobook content (Google explicitly recommends Pro for audiobooks)
  // 2. Premium users with story/medical/educational content
  // 3. Explicitly marked premium content
  if (
    isStoryContent || 
    (isPaidPlan && templateCategory && proEligibleTemplates.includes(templateCategory)) ||
    (isPremium && isPaidPlan)
  ) {
    console.log(`[TTS Model] Selected gemini-2.5-pro-preview-tts for ${templateCategory || 'premium'} content (plan=${plan})`);
    return 'gemini-2.5-pro-preview-tts';
  }
  
  // Default: Flash model for cost-efficiency
  return 'gemini-2.5-flash-preview-tts';
}

/**
 * Get the stable model name from any variant
 * Maps preview models to stable equivalents
 */
export function getStableModelName(model: GeminiTTSModel): GeminiTTSModel {
  // v1beta API requires preview models, no stable versions available yet
  // Return the model as-is since all supported models are preview versions
  return model;
}

/**
 * Save PCM audio data as WAV file with proper header
 */
function createWavBuffer(
  pcmData: Buffer,
  channels: number = 1,
  rate: number = 24000,
  sampleWidth: number = 2
): Buffer {
  const byteRate = rate * channels * sampleWidth;
  const blockAlign = channels * sampleWidth;
  const dataSize = pcmData.length;

  // Create WAV header (44 bytes)
  const header = Buffer.alloc(44);
  let offset = 0;

  // RIFF header
  header.write('RIFF', offset); offset += 4;
  header.writeUInt32LE(dataSize + 36, offset); offset += 4; // File size - 8
  header.write('WAVE', offset); offset += 4;

  // fmt sub-chunk
  header.write('fmt ', offset); offset += 4;
  header.writeUInt32LE(16, offset); offset += 4; // Subchunk1Size
  header.writeUInt16LE(1, offset); offset += 2; // AudioFormat (1 = PCM)
  header.writeUInt16LE(channels, offset); offset += 2;
  header.writeUInt32LE(rate, offset); offset += 4;
  header.writeUInt32LE(byteRate, offset); offset += 4;
  header.writeUInt16LE(blockAlign, offset); offset += 2;
  header.writeUInt16LE(sampleWidth * 8, offset); offset += 2; // BitsPerSample

  // data sub-chunk
  header.write('data', offset); offset += 4;
  header.writeUInt32LE(dataSize, offset);

  // Combine header and PCM data
  return Buffer.concat([header, pcmData]);
}

/**
 * Options for single-speaker synthesis
 */
export interface SynthesisOptions {
  /** Podcast context for scene-setting prompts */
  podcastContext?: PodcastContextType;
  /** Template category for context-appropriate delivery */
  templateCategory?: string;
  /** Voice's native accent from curatedVoices (e.g., 'American', 'British', 'Australian') */
  voiceAccent?: string;
  /** Whether to apply the voice's native accent automatically */
  applyNativeAccent?: boolean;
}

/**
 * Map voice accents from curatedVoices.ts to TTS accent prompts
 */
function getAccentPrompt(accent?: string): string {
  if (!accent || accent === 'Neutral') return '';
  
  const accentMap: Record<string, string> = {
    'American': 'with an American English accent',
    'British': 'with a British English accent',
    'Australian': 'with an Australian English accent',
    'Southern American': 'with a Southern American accent',
    'Irish': 'with an Irish accent',
    'Scottish': 'with a Scottish accent',
    'Canadian': 'with a Canadian English accent',
    'New Zealand': 'with a New Zealand English accent',
    'Indian': 'with an Indian English accent',
  };
  
  return accentMap[accent] || '';
}

/**
 * Generate single-speaker audio using Gemini TTS with retry logic
 * Uses cache + request queueing to optimize for scale
 * Includes exponential backoff for timeout/transient errors
 * 
 * Enhanced with Google's prompting best practices:
 * - Speed control tags: [slow], [fast], [extremely fast]
 * - Accent modifiers: [british], [australian], etc.
 * - Contextual scene-setting for podcast delivery
 * 
 * @see https://cloud.google.com/text-to-speech/docs/gemini-tts#prompting_tips
 */
export async function synthesizeSingleSpeaker(
  text: string,
  voiceName: string,
  model: GeminiTTSModel = 'gemini-2.5-flash-preview-tts',
  options?: SynthesisOptions
): Promise<Buffer> {
  // Use stable model name
  const stableModel = getStableModelName(model);

  // Build finalPrompt BEFORE cache check so the accent instruction is part of
  // the cache key. Previously getCachedAudio(text, voiceName) was called first,
  // which caused accent previews generated in the same process to collide:
  // the first accent synthesized for a given (text, voice) pair was returned
  // for every subsequent accent (e.g. Canadian previews contained Indian audio).
  const { prompt, cleanText } = emotionToNaturalLanguage(text, {
    podcastContext: options?.podcastContext,
    templateCategory: options?.templateCategory,
  });

  let accentPrompt = '';
  if (options?.applyNativeAccent && options?.voiceAccent) {
    accentPrompt = getAccentPrompt(options.voiceAccent);
  }

  // Build final prompt with style instructions
  // Format: "[Context] [Style instructions] [Accent] Say the following: [text]"
  const promptParts = [prompt, accentPrompt].filter(Boolean).join(' ');
  const finalPrompt = promptParts
    ? `${promptParts} Say the following: ${cleanText}`
    : cleanText;

  // Check cache using finalPrompt (includes accent) as the key (Option C optimization)
  const cachedAudio = getCachedAudio(finalPrompt, voiceName);
  if (cachedAudio) {
    trackCacheHit(); // Track cache hits for quota stats
    return cachedAudio;
  }
  
  // Queue the TTS request to respect rate limits with retry logic
  const audioBuffer = await queueTTSRequest(async () => {
    // Track this TTS request for quota monitoring
    const quotaCheck = trackTTSRequest();
    if (!quotaCheck.allowed) {
      throw new Error(quotaCheck.warning || 'TTS quota exhausted');
    }
    if (quotaCheck.warning) {
      console.warn(`[Gemini TTS] ${quotaCheck.warning}`);
    }
    
    const MAX_RETRIES = 3;
    let lastError: any;
    
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const client = getGeminiClient();
        
        console.log(`[Gemini TTS] Synthesizing single speaker: model=${stableModel}, voice=${voiceName}, textLen=${text.length}, prompt=${prompt ? 'enhanced' : 'simple'}${accentPrompt ? `, accent=${options?.voiceAccent}` : ''}${attempt > 0 ? `, attempt ${attempt + 1}/${MAX_RETRIES}` : ''}`);
        
        // Create AbortController with timeout for long TTS synthesis
        // Scale timeout based on text length: base 90s + 30s per 500 chars, max 5 min for very long segments
        const baseTimeout = 90000; // 1.5 min base
        const perCharTimeout = Math.ceil(text.length / 500) * 30000; // 30s per 500 chars
        const timeoutMs = Math.min(baseTimeout + perCharTimeout, 300000); // Cap at 5 min
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);
        
        let response;
        try {
          response = await client.models.generateContent({
            model: stableModel,
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
          console.error('[Gemini TTS] No audio data in response:', JSON.stringify(response, null, 2));
          throw new Error('No audio data received from Gemini TTS');
        }

        // Gemini TTS returns complete audio file in base64
        const audioBuffer = Buffer.from(audioData, 'base64');
        
        // Check audio format by inspecting first 12 bytes (magic numbers)
        const header = audioBuffer.slice(0, 12).toString('utf-8', 0, 4);
        console.log(`[Gemini TTS] Received ${audioBuffer.length} bytes, format header: "${header}"`);
        
        // Gemini returns LINEAR16 PCM, need to convert to WAV for browser playback
        if (header !== 'RIFF') {
          console.log('[Gemini TTS] Converting LINEAR16 PCM to WAV format for browser compatibility');
          try {
            const wavBuffer = createWavBuffer(audioBuffer, 1, 24000, 2);
            console.log(`[Gemini TTS] Converted to ${wavBuffer.length} bytes WAV file (header: 44 bytes + data: ${audioBuffer.length} bytes)`);
            return wavBuffer;
          } catch (error) {
            console.error('[Gemini TTS] Error converting PCM to WAV:', error);
            throw error;
          }
        }
        
        return audioBuffer;
        
      } catch (error: any) {
        lastError = error;
        const isTimeout = error?.name === 'AbortError' || error?.message?.includes('timeout') || error?.message?.includes('deadline');
        const isQuota = error?.message?.includes('quota') || error?.message?.includes('Quota') || error?.message?.includes('429');
        // Also retry "No audio data" errors - these happen when Gemini returns finishReason: "OTHER"
        const isNoAudioData = error?.message?.includes('No audio data');
        const isTransient = error?.message?.includes('500') || error?.message?.includes('503') || isTimeout || isNoAudioData;
        
        if (isQuota) {
          console.error(`[Gemini TTS] QUOTA ERROR: ${error.message}`);
          throw error; // Don't retry quota errors
        }
        
        if (isTransient && attempt < MAX_RETRIES - 1) {
          const backoffMs = Math.pow(2, attempt) * 1000 + Math.random() * 500; // 1-1.5s, 2-2.5s, 4-4.5s with jitter
          console.warn(`[Gemini TTS] Transient error (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${Math.round(backoffMs)}ms: ${error.message}`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          continue;
        }
        
        console.error(`[Gemini TTS] API Error: ${error.message}`);
      }
    }
    
    throw lastError || new Error('Gemini TTS synthesis failed after retries');
  });
  
  // Cache the result — use finalPrompt so accent-specific audio is keyed correctly
  setCachedAudio(finalPrompt, voiceName, audioBuffer);
  
  return audioBuffer;
}

/**
 * Strip all emotion/speed/accent bracket tags from text
 * Used to clean multi-speaker scripts before TTS synthesis
 * 
 * CRITICAL FIX: Prevents ~4-minute audio quality degradation cycles
 * caused by Gemini TTS speaking emotion tags aloud (e.g., "[excited]")
 * 
 * @param text - Text potentially containing [emotion], [speed], [accent] tags
 * @returns Clean text with all bracket tags removed
 */
export function stripAllBracketTags(text: string): string {
  // Build comprehensive pattern to match ALL known tag types
  const emotionTagsPattern = GEMINI_EMOTION_TAGS.join('|');
  const speedTagsPattern = GEMINI_SPEED_TAGS.join('|');
  const accentTagsPattern = GEMINI_ACCENT_TAGS.join('|');
  
  // Combined pattern: matches [emotion], [speed], and [accent] tags
  const allTagsPattern = new RegExp(
    `\\[(${emotionTagsPattern}|${speedTagsPattern}|${accentTagsPattern})\\]`,
    'gi'
  );
  
  // Also strip any remaining unknown bracket tags that might slip through
  // This catches legacy markers like [PAUSE], [LAUGH], etc.
  const unknownBracketPattern = /\[[A-Za-z_-]+\]/g;
  
  return text
    .replace(allTagsPattern, '')
    .replace(unknownBracketPattern, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generate multi-speaker audio using Gemini TTS
 * Supports up to 2 speakers
 * 
 * Enhanced with Google's prompting best practices for conversations
 * @see https://cloud.google.com/text-to-speech/docs/gemini-tts#prompting_tips
 * 
 * CRITICAL: All text is cleaned of emotion/speed/accent tags before synthesis
 * Style is communicated via context prefix, not inline tags
 */
export async function synthesizeMultiSpeaker(
  text: string,
  speakers: Array<{ name: string; voiceName: string }>,
  model: GeminiTTSModel = 'gemini-2.5-flash-preview-tts',
  options?: { templateCategory?: string }
): Promise<Buffer> {
  if (speakers.length > 2) {
    throw new Error('Gemini TTS supports maximum 2 speakers. Use single-speaker synthesis for 3+ hosts.');
  }
  
  // Use stable model name
  const stableModel = getStableModelName(model);
  
  const client = getGeminiClient();
  
  console.log(`[Gemini TTS] Synthesizing multi-speaker: model=${stableModel}, speakers=${speakers.map(s => `${s.name}=${s.voiceName}`).join(', ')}`);
  
  // CRITICAL FIX: Strip all bracket tags from text before synthesis
  // This prevents Gemini TTS from speaking emotion markers aloud
  // which causes the ~4-minute audio quality degradation cycles
  const cleanedText = stripAllBracketTags(text);
  console.log(`[Gemini TTS] Cleaned text: removed bracket tags (original=${text.length} chars, cleaned=${cleanedText.length} chars)`);
  
  // Build enhanced prompt with context for multi-speaker conversations
  // Per Google's recommendation: use style prompts instead of inline tags
  let contextPrefix = '';
  if (options?.templateCategory) {
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
  
  const prompt = `${contextPrefix}TTS the following conversation:\n${cleanedText}`;
  
  // Track this TTS request for quota monitoring
  const quotaCheck = trackTTSRequest();
  if (!quotaCheck.allowed) {
    throw new Error(quotaCheck.warning || 'TTS quota exhausted');
  }
  if (quotaCheck.warning) {
    console.warn(`[Gemini TTS Multi-speaker] ${quotaCheck.warning}`);
  }
  
  const MAX_RETRIES = 3;
  let lastError: any;
  
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      console.log(`[Gemini TTS Multi-speaker] Attempt ${attempt + 1}/${MAX_RETRIES}: model=${stableModel}`);
      
      const response = await client.models.generateContent({
        model: stableModel,
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
        console.error('[Gemini TTS Multi-speaker] No audio data in response:', JSON.stringify(response, null, 2));
        throw new Error('No audio data received from Gemini TTS');
      }

      // Gemini TTS returns audio data in base64
      const audioBuffer = Buffer.from(audioData, 'base64');
      
      // Check audio format by inspecting first 4 bytes (magic numbers)
      const header = audioBuffer.slice(0, 4).toString('utf-8');
      console.log(`[Gemini TTS Multi-speaker] Received ${audioBuffer.length} bytes, format header: "${header}"`);
      
      // Gemini returns LINEAR16 PCM, need to convert to WAV for browser playback
      if (header !== 'RIFF') {
        console.log('[Gemini TTS Multi-speaker] Converting LINEAR16 PCM to WAV format');
        try {
          const wavBuffer = createWavBuffer(audioBuffer, 1, 24000, 2);
          console.log(`[Gemini TTS Multi-speaker] Converted to ${wavBuffer.length} bytes WAV file`);
          return wavBuffer;
        } catch (error) {
          console.error('[Gemini TTS Multi-speaker] Error converting PCM to WAV:', error);
          throw error;
        }
      }
      
      return audioBuffer;
      
    } catch (error: any) {
      lastError = error;
      const isTimeout = error?.name === 'AbortError' || error?.message?.includes('timeout') || error?.message?.includes('deadline');
      const isQuota = error?.message?.includes('quota') || error?.message?.includes('Quota') || error?.message?.includes('429');
      const isNoAudioData = error?.message?.includes('No audio data');
      const isTransient = error?.message?.includes('500') || error?.message?.includes('503') || isTimeout || isNoAudioData;
      
      if (isQuota) {
        console.error(`[Gemini TTS Multi-speaker] QUOTA ERROR: ${error.message}`);
        console.error(`[Gemini TTS Multi-speaker] Model used: ${model} (stable version)`);
        console.error(`[Gemini TTS Multi-speaker] Check quota at: https://console.cloud.google.com/iam-admin/quotas`);
        throw new Error(`Gemini TTS quota exceeded. Model: ${model} (stable). Check Google Cloud Console quotas. Original error: ${error.message}`);
      }
      
      if (isTransient && attempt < MAX_RETRIES - 1) {
        const backoffMs = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        console.warn(`[Gemini TTS Multi-speaker] Transient error (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${Math.round(backoffMs)}ms: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        continue;
      }
      
      console.error(`[Gemini TTS Multi-speaker] API Error: ${error.message}`);
    }
  }
  
  throw lastError || new Error('Gemini TTS multi-speaker synthesis failed after retries');
}

/**
 * Get cached watermarks or generate new ones (Tier 1 Optimization)
 * ZERO-CREDIT SYSTEM: Checks persistent storage (database → object storage → generate)
 * - Layer 1: Memory cache (instant)
 * - Layer 2: Database URLs (from pre-generation)
 * - Layer 3: Object storage (from pre-generation)
 * - Layer 4: Generate only if absolutely necessary (should never happen)
 */
export async function getWatermarks(voiceName: string): Promise<{ intro: Buffer; outro: Buffer }> {
  // ===== LAYER 1: Check memory cache (fastest) =====
  if (watermarkCache.has(voiceName)) {
    console.log(`[Watermarks] 🔵 LAYER 1 (Memory) HIT for voice: ${voiceName}`);
    return watermarkCache.get(voiceName)!;
  }
  
  // ===== LAYER 2: Check database for persistent URLs (pre-generated) =====
  try {
    console.log(`[Watermarks] 🟢 Checking LAYER 2 (Database) for pre-generated watermarks: ${voiceName}`);
    const voice = await db.select().from(voicesTable).where(eq(voicesTable.googleVoiceName, voiceName)).limit(1);
    
    if (voice.length > 0 && voice[0].watermarkIntroUrl && voice[0].watermarkOutroUrl) {
      console.log(`[Watermarks] ✅ Found pre-generated watermarks in database for ${voiceName}`);
      console.log(`  • Intro: ${voice[0].watermarkIntroUrl}`);
      console.log(`  • Outro: ${voice[0].watermarkOutroUrl}`);
      
      // Load from object storage directly (not via HTTP fetch - fixes relative URL issue)
      try {
        const objectStorage = new ObjectStorageService();
        const introMp3 = await objectStorage.downloadPublicObjectAsBuffer(voice[0].watermarkIntroUrl);
        const outroMp3 = await objectStorage.downloadPublicObjectAsBuffer(voice[0].watermarkOutroUrl);
        
        if (introMp3 && outroMp3) {
          // Convert MP3 back to WAV for concatenation (stored as MP3, need WAV for audio merge)
          console.log(`[Watermarks] Converting MP3 watermarks to WAV for concatenation...`);
          const intro = await convertMp3ToWav(introMp3);
          const outro = await convertMp3ToWav(outroMp3);
          
          const watermarks = { intro, outro };
          watermarkCache.set(voiceName, watermarks);
          console.log(`[Watermarks] 🟢 LAYER 2 SUCCESS: Loaded from persistent storage (ZERO credits)`);
          return watermarks;
        } else {
          console.warn(`[Watermarks] One or both watermarks not found in object storage, will regenerate`);
        }
      } catch (storageError) {
        console.warn(`[Watermarks] Failed to load from object storage, will regenerate:`, storageError);
      }
    }
  } catch (dbError) {
    console.warn(`[Watermarks] Database lookup failed, continuing with generation:`, dbError);
  }
  
  // ===== LAYER 3: Generate new watermarks (should rarely happen if pre-generation complete) =====
  console.log(`[Watermarks] 🟠 LAYER 3: No pre-generated watermarks found, generating for ${voiceName}...`);
  
  try {
    const watermarks = await generateWatermarks(voiceName);
    
    // Store in memory cache
    watermarkCache.set(voiceName, watermarks);
    console.log(`[Watermarks] Cached in memory for ${voiceName}`);
    
    // NOTE: Should auto-persist to database via pre-generation script
    // If you see this log frequently, run: npx tsx server/scripts/preGenerateWatermarks.ts
    
    return watermarks;
  } catch (error) {
    // GRACEFUL FALLBACK: If watermark generation fails (quota, etc), return null
    // The caller should handle missing watermarks gracefully
    const errorMsg = error instanceof Error ? error.message : String(error);
    
    // Check if it's a quota error
    if (errorMsg.includes('429') || errorMsg.includes('quota') || errorMsg.includes('RESOURCE_EXHAUSTED')) {
      console.warn(`[Watermarks] ⚠️ QUOTA EXHAUSTED - Skipping watermarks for ${voiceName}`);
      console.warn(`[Watermarks] To prevent this, run: npx tsx server/scripts/preGenerateWatermarks.ts`);
      // Return null to signal caller should skip watermarks
      return null as any;
    }
    
    console.error(`[Watermarks] ❌ Failed to generate watermarks for ${voiceName}: ${errorMsg}`);
    throw error;
  }
}

/**
 * Synthesize speech in chunks to handle long text
 * Gemini TTS has context window limits, so we chunk long scripts
 * AUDIO QUALITY OPTIMIZED:
 * - Reduced chunk size to ~2250 chars (~3 minutes of audio)
 * - Smaller chunks prevent cumulative timing drift within each segment
 * - WAV-level concatenation before MP3 conversion ensures clean joins
 * - Parallel chunk synthesis within rate limit constraints
 */
export async function synthesizeSpeechInChunks(
  text: string,
  voiceName: string,
  chunkSize: number = 2250, // ~3 min chunks to prevent audio drift artifacts
  model: 'gemini-2.5-flash-preview-tts' | 'gemini-2.5-pro-preview-tts' = 'gemini-2.5-flash-preview-tts'
): Promise<Buffer> {
  // If text is short enough, synthesize directly
  if (text.length <= chunkSize) {
    return synthesizeSingleSpeaker(text, voiceName, model);
  }
  
  // Split into chunks at sentence boundaries
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const chunks: string[] = [];
  let currentChunk = '';
  
  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = sentence;
    } else {
      currentChunk += sentence;
    }
  }
  
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }
  
  console.log(`[Gemini TTS] Synthesizing ${chunks.length} chunks (chunkSize=${chunkSize})`);
  
  // OPTIMIZATION: Parallel synthesis with rate limit queuing
  // Create promises for all chunks - they queue and process with 100ms spacing
  // This parallelizes within rate limit constraints (~30-50% faster than sequential)
  const synthesisPromises = chunks.map((chunk, index) => {
    return (async () => {
      console.log(`[Gemini TTS] Queuing chunk ${index + 1}/${chunks.length} for synthesis`);
      const audioBuffer = await synthesizeSingleSpeaker(chunk, voiceName, model);
      console.log(`[Gemini TTS] Completed chunk ${index + 1}/${chunks.length}`);
      return audioBuffer;
    })();
  });
  
  // Wait for all chunks to synthesize in parallel (respects rate limit queue)
  const audioBuffers = await Promise.all(synthesisPromises);
  
  console.log(`[Gemini TTS] All ${chunks.length} chunks synthesized successfully`);
  
  // Concatenate all audio buffers (order preserved by Promise.all)
  return Buffer.concat(audioBuffers);
}

/**
 * Generate 1 second of silence at 24kHz, mono, 16-bit (for pause before intro)
 * Prevents audio clipping at the start of podcasts
 */
function generateSilence(durationSeconds: number = 1, sampleRate: number = 24000): Buffer {
  const channels = 1;
  const sampleWidth = 2; // 16-bit = 2 bytes
  const numSamples = sampleRate * durationSeconds;
  const byteRate = sampleRate * channels * sampleWidth;
  const blockAlign = channels * sampleWidth;
  const dataSize = numSamples * sampleWidth;

  // Create WAV header (44 bytes)
  const header = Buffer.alloc(44);
  let offset = 0;

  // RIFF header
  header.write('RIFF', offset); offset += 4;
  header.writeUInt32LE(dataSize + 36, offset); offset += 4; // File size - 8
  header.write('WAVE', offset); offset += 4;

  // fmt sub-chunk
  header.write('fmt ', offset); offset += 4;
  header.writeUInt32LE(16, offset); offset += 4; // Subchunk1Size
  header.writeUInt16LE(1, offset); offset += 2; // AudioFormat (1 = PCM)
  header.writeUInt16LE(channels, offset); offset += 2; // NumChannels
  header.writeUInt32LE(sampleRate, offset); offset += 4; // SampleRate
  header.writeUInt32LE(byteRate, offset); offset += 4; // ByteRate
  header.writeUInt16LE(blockAlign, offset); offset += 2; // BlockAlign
  header.writeUInt16LE(sampleWidth * 8, offset); offset += 2; // BitsPerSample

  // data sub-chunk
  header.write('data', offset); offset += 4;
  header.writeUInt32LE(dataSize, offset);

  // Create PCM silence (all zeros for 16-bit silence)
  const silence = Buffer.alloc(dataSize);
  
  // Combine header + silence PCM data
  return Buffer.concat([header, silence]);
}

/**
 * Generate watermark audio (intro/outro) for branding
 * 
 * CRITICAL OPTIMIZATION: These watermarks are cached globally per voice
 * They are generated ONCE and reused for ALL podcasts (Tier 1 optimization)
 * This saves significant TTS quota and time
 * 
 * Format: 24kHz, mono, 16-bit WAV (same as podcast audio for seamless merging)
 */
export async function generateWatermarks(voiceName: string): Promise<{ intro: Buffer; outro: Buffer }> {
  console.log(`[Watermarks] Generating cached watermarks for voice: ${voiceName}`);
  console.log('[Watermarks] Format: 24kHz, mono, 16-bit WAV (matches podcast audio)');
  
  // Generate intro with 1-second silence prefix to prevent clipping
  const introSilence = generateSilence(1); // 1 second of silence
  const introSpeech = await synthesizeSingleSpeaker(
    'It\'s brew time!',  // Clean text - no emotion tags (they cause audio distortion)
    voiceName,
    'gemini-2.5-flash-preview-tts'
  );
  
  // Concatenate silence + speech for intro (silence first prevents clipping)
  const intro = await concatenateAudioBuffers([introSilence, introSpeech]);
  console.log(`[Watermarks] Intro generated: ${intro.length} bytes (silence: ${introSilence.length} + speech: ${introSpeech.length})`);
  
  // Generate outro with professional tone
  const outro = await synthesizeSingleSpeaker(
    'You\'ve been listening to a PodBrew creation.',  // Clean text - no emotion tags
    voiceName,
    'gemini-2.5-flash-preview-tts'
  );
  console.log(`[Watermarks] Outro generated: ${outro.length} bytes`);
  
  return { intro, outro };
}
