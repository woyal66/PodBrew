/**
 * TTS Adapter - Gemini TTS wrapper with parallel synthesis
 * 
 * Implementation:
 * - 4500 char chunks (~5 min each for fewer API calls)
 * - Parallel synthesis (4 chunks at a time for speed)
 * - Proportional timeouts to prevent hanging on slow responses
 * - Direct WAV output from Gemini (no normalization)
 * - Multi-key fallback on quota errors (429)
 * - Natural pause insertion using sentence boundary detection
 */

import { GoogleGenAI } from '@google/genai';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { getLanguageName } from './languageUtils';
const require = createRequire(import.meta.url);
const sbd = require('sbd');

// Smaller chunks limit progressive speed drift accumulation in Gemini TTS
// SSML rate control helps but doesn't fully prevent drift - chunk size is key
// 1500 chars (~1.5 min) keeps drift imperceptible; 2000+ causes audible drift
const CHUNK_SIZE = 1500; // ~1.5 minutes per chunk - optimal for drift prevention
const CHUNK_SIZE_MULTISPEAKER = 2100; // ~2 min per chunk — larger chunks cause voice clipping on Gemini 2.5
const TARGET_SAMPLE_RATE = 24000; // Standard sample rate for Gemini TTS
const PARALLEL_LIMIT = 6; // Increased to compensate for more chunks from smaller size
const TTS_MODEL = 'gemini-2.5-flash-preview-tts';

/**
 * Per-template TTS sampling temperature.
 *
 * Why this exists: Gemini TTS defaults to a high temperature (~1.0). Sampling each
 * chunk independently with high randomness causes the same voice to deliver
 * consecutive chunks of one podcast with audibly different tone/pace/personality —
 * the "voice drifts between chunks" problem.
 *
 * Lower = more consistent (good for news/medical/teach/documents).
 * Higher = more expressive (good for stories/conversational).
 *
 * Override the entire resolver via the `GEMINI_TTS_TEMPERATURE` env var (0..2).
 */
const TEMPERATURE_BY_TEMPLATE: Record<string, number> = {
  news: 0.5,
  medical: 0.5,
  teachme: 0.5,
  documents: 0.5,
  stories: 0.7,
  conversational: 0.7,
};
const TEMPERATURE_DEFAULT = 0.6;

export function getTemperatureForTemplate(template?: string | null): number {
  const envOverride = process.env.GEMINI_TTS_TEMPERATURE;
  if (envOverride) {
    const parsed = Number(envOverride);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 2) {
      return parsed;
    }
  }
  if (template && TEMPERATURE_BY_TEMPLATE[template] !== undefined) {
    return TEMPERATURE_BY_TEMPLATE[template];
  }
  return TEMPERATURE_DEFAULT;
}

/**
 * Generate a fixed seed for one podcast synthesis run.
 * The same seed is reused for every chunk of the podcast so the model
 * re-initializes the same prosody trajectory each call, further reducing
 * chunk-to-chunk drift on top of the lower temperature.
 */
function generatePodcastSeed(): number {
  return Math.floor(Math.random() * 2_000_000_000);
}

/**
 * Deterministically derive a Gemini TTS seed from a stable string identifier
 * (e.g. a resumable job ID). Using the same ID always yields the same seed,
 * which is critical for resumable / batched podcast generation where
 * `synthesizeText` is invoked separately for each batch but all batches must
 * share the same prosody trajectory to avoid voice drift.
 */
export function deriveSeedFromId(id: string): number {
  // Simple FNV-1a 32-bit hash → coerced into Gemini's accepted seed range.
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Force unsigned and clamp under 2^31 (Gemini accepts positive 32-bit ints).
  return (hash >>> 0) % 2_000_000_000;
}

// Timeout configuration: proportional to text length
const BASE_TIMEOUT_MS = 90000; // 90 seconds base
const PER_500_CHARS_MS = 30000; // +30 seconds per 500 chars
const MAX_TIMEOUT_MS = 300000; // 5 minute maximum

/**
 * Calculate proportional timeout based on text length
 */
function calculateTimeout(textLength: number): number {
  const perCharTimeout = Math.ceil(textLength / 500) * PER_500_CHARS_MS;
  return Math.min(BASE_TIMEOUT_MS + perCharTimeout, MAX_TIMEOUT_MS);
}

/**
 * Create a timeout wrapper that can be cleared
 * Returns { promise, clear } - call clear() when done to prevent leaks
 */
function createTimeoutController(ms: number, chunkIndex: number): { promise: Promise<never>; clear: () => void } {
  let timeoutId: NodeJS.Timeout | null = null;
  const promise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`TTS chunk ${chunkIndex + 1} timed out after ${(ms / 1000).toFixed(0)}s`));
    }, ms);
  });
  return {
    promise,
    clear: () => {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };
}

// Accent mapping for natural language prompting
const ACCENT_PROMPTS: Record<string, string> = {
  'american': 'Speak with an American English accent.',
  'british': 'Speak with a British English accent.',
  'australian': 'Speak with an Australian English accent.',
  'indian': 'Speak with an Indian English accent.',
  'irish': 'Speak with an Irish accent.',
  'scottish': 'Speak with a Scottish accent.',
  'southern-american': 'Speak with a Southern American accent.',
  'new-york': 'Speak with a New York accent.',
  'canadian': 'Speak with a Canadian English accent.',
  'french': 'Speak with a French accent.',
  'german': 'Speak with a German accent.',
  'spanish': 'Speak with a Spanish accent.',
  'italian': 'Speak with an Italian accent.',
  'us': 'Speak with an American English accent.',
  'uk': 'Speak with a British English accent.',
  'au': 'Speak with an Australian English accent.',
  'in': 'Speak with an Indian English accent.',
};

/**
 * Vocal-effect tags that need a phonetic form injected INTO the spoken text.
 * Gemini 2.5 TTS only produces audible vocalizations (laughter, sighing, etc.)
 * when the phonetic representation appears in the actual text — a standalone
 * instruction ("Include natural laughter.") only changes tone, not the sound.
 * Emotional delivery tags (excited, sad, happy…) do NOT need phonetics; they
 * work correctly via instruction-only tonal changes.
 */
const VOCAL_PHONETICS: Record<string, string> = {
  'laugh':          '(laughs)',
  'laughter':       '(laughs)',
  'laughing':       '(laughs)',
  'chuckle':        '(chuckles)',
  'chuckling':      '(chuckles)',
  'sigh':           '(sighs)',
  'sighing':        '(sighs)',
  'gasp':           '(gasps)',
  'gasping':        '(gasps)',
  'breath':         '(breathes)',
  'breathing':      '(breathes)',
  'giggle':         '(giggles)',
  'giggling':       '(giggles)',
  'hearty-laugh':   '(laughs heartily)',
  'nervous-laugh':  '(laughs nervously)',
  'crying':         '(crying)',
  'coughing':       '(coughs)',
  'cough':          '(coughs)',
  'uhm':            'Uhm...',
  'ah':             'Ah...',
  'yawn':           '(yawns)',
  'yawning':        '(yawns)',
  'sniff':          '(sniffs)',
  'sniffing':       '(sniffs)',
  'sob':            '(sobs)',
  'sobbing':        '(sobs)',
  'grunt':          '(grunts)',
  'grunting':       '(grunts)',
  'hum':            '(hums)',
  'humming':        '(hums)',
  'clear-throat':   '(clears throat)',
  'clearing throat':'(clears throat)',
  'sharp-inhale':   '(sharp inhale)',
  'relieved-sigh':  '(sighs with relief)',
};

/**
 * Emotion/vocalization tag mapping to natural language instructions
 * Gemini TTS requires natural language instructions to produce actual vocalizations
 * (e.g., [laugh] must be converted to "Include natural laughter" for audible laughing)
 */
const EMOTION_STYLES: Record<string, string> = {
  // === VOCAL EFFECTS (Core) - These produce audible sounds ===
  'laugh': 'Include natural laughter.',
  'laughter': 'Include natural laughter.',
  'laughing': 'Include natural laughter.',
  'chuckle': 'Include a subtle, knowing chuckle.',
  'chuckling': 'Include a subtle, knowing chuckle.',
  'sigh': 'Include a thoughtful sigh.',
  'sighing': 'Include a thoughtful sigh.',
  'gasp': 'Include a surprised gasp.',
  'gasping': 'Include a surprised gasp.',
  'breath': 'Include natural, audible breathing.',
  'breathing': 'Include natural, audible breathing.',
  'whisper': 'Say it in a confidential whisper.',
  'whispering': 'Say it in a confidential whisper.',
  'giggle': 'Include playful giggling.',
  'giggling': 'Include playful giggling.',
  'hearty-laugh': 'Include hearty, warm belly laughter.',
  'nervous-laugh': 'Include a nervous, uncertain laugh.',
  'crying': 'Say it with tears and emotional crying.',
  'coughing': 'Include a natural cough.',
  'cough': 'Include a natural cough.',
  'uhm': 'Include a natural "uhm" hesitation.',
  'ah': 'Include a natural "ah" vocalization.',
  'yawn': 'Include a natural yawn.',
  'yawning': 'Include a natural yawn.',
  'sniff': 'Include a sniff or sniffle.',
  'sniffing': 'Include a sniff or sniffle.',
  'sob': 'Include a sob or soft crying.',
  'sobbing': 'Include a sob or soft crying.',
  'grunt': 'Include a natural grunt.',
  'grunting': 'Include a natural grunt.',
  'hum': 'Include a thoughtful hum.',
  'humming': 'Include a thoughtful hum.',
  'clear-throat': 'Include a throat-clearing sound.',
  'clearing throat': 'Include a throat-clearing sound.',
  'sharp-inhale': 'Include a sharp, sudden inhale.',
  'relieved-sigh': 'Include a relieved, exhaling sigh.',
  
  // === EMOTIONAL DELIVERY STYLES ===
  'excited': 'Say it in an excited, energetic tone with rising pitch and enthusiasm.',
  'happy': 'Say it in a cheerful, upbeat manner with a warm smile in your voice.',
  'sad': 'Say it in a somber, melancholic tone with slower pace and gentle delivery.',
  'angry': 'Say it in a firm, intense voice with emphasis and controlled frustration.',
  'fearful': 'Say it in a nervous, hesitant manner with slight trembling.',
  'surprised': 'Say it with a surprised, astonished tone and widened vocal expression.',
  'neutral': 'Say it in a calm, neutral voice with even delivery.',
  'frustrated': 'Say it with clear frustration and exasperation.',
  'irritated': 'Say it with slight annoyance and displeasure.',
  'mocking': 'Say it with a mocking, slightly teasing quality.',
  'sarcastic': 'Say it with dry sarcasm and ironic undertone.',
  'witty': 'Say it with clever, quick-witted delivery.',
  'cheerful': 'Say it in a bright, optimistic and cheerful manner.',
  'nervous': 'Say it with nervous energy and slight uncertainty.',
  'calm': 'Say it in a relaxed, peaceful manner.',
  'dramatic': 'Say it with theatrical, dramatic flair.',
  'serious': 'Say it in a serious, professional tone with weight.',
  'playful': 'Say it with a playful, teasing quality and light-hearted tone.',
  'warm': 'Say it with warmth and genuine care.',
  'confident': 'Say it with pride and satisfaction in the voice.',
  
  // === VOICE QUALITY EFFECTS ===
  'shaky-voice': 'Say it with a shaky, trembling voice.',
  'trembling': 'Say it with trembling emotion in the voice.',
  'choked-up': 'Say it while choked up with emotion.',
  'breaking-voice': 'Say it with voice breaking from emotion.',
  'quivering': 'Say it with a quivering, unsteady voice.',
  'breathless': 'Say it while catching your breath, with excited breathlessness.',
  'stammer': 'Say it with a slight stammer or hesitation.',
  'stutter': 'Say it with a noticeable stutter.',
};

/**
 * Extract and convert emotion/vocalization tags.
 *
 * For vocal-effect tags (laugh, sigh, gasp…) the phonetic form from
 * VOCAL_PHONETICS is KEPT in the spoken text so Gemini actually vocalizes it.
 * The instruction is also added so the model understands the intent.
 *
 * For emotional-delivery tags (excited, sad, happy…) the tag is removed
 * from the spoken text (instruction-only approach works fine for tonal changes).
 *
 * Returns cleanText (with phonetics where appropriate) and emotionPrompt.
 */
export function processEmotionTags(text: string): { cleanText: string; emotionPrompt: string } {
  const emotionInstructions: string[] = [];
  
  // Pattern to match all bracketed tags
  let cleanText = text.replace(/\[([^\]]+)\]/g, (match, tagContent) => {
    const normalized = tagContent.toLowerCase().trim();
    
    // Check if this is a known emotion/vocalization tag
    if (EMOTION_STYLES[normalized]) {
      emotionInstructions.push(EMOTION_STYLES[normalized]);
      // Vocal-effect tags: keep phonetic in spoken text for audible vocalization
      const phonetic = VOCAL_PHONETICS[normalized];
      return phonetic ? ` ${phonetic} ` : '';
    }
    
    // Check for partial matches (e.g., "laugh softly" should match "laugh")
    for (const [key, instruction] of Object.entries(EMOTION_STYLES)) {
      if (normalized.startsWith(key) || normalized.includes(key)) {
        emotionInstructions.push(instruction);
        const phonetic = VOCAL_PHONETICS[key];
        return phonetic ? ` ${phonetic} ` : '';
      }
    }
    
    // Not a recognized emotion tag — remove to avoid TTS reading "[something]"
    return '';
  });
  
  // Clean up extra whitespace
  cleanText = cleanText.replace(/\s+/g, ' ').trim();
  
  // Combine unique emotion instructions (use Array.from for compatibility)
  const uniqueSet = new Set(emotionInstructions);
  const uniqueInstructions = Array.from(uniqueSet);
  const emotionPrompt = uniqueInstructions.join(' ');
  
  return { cleanText, emotionPrompt };
}

// API key management with fallback support
interface ApiKeyConfig {
  name: string;
  key: string;
  client: GoogleGenAI;
}

let apiKeyConfigs: ApiKeyConfig[] = [];

function initializeClients(): ApiKeyConfig[] {
  if (apiKeyConfigs.length > 0) {
    return apiKeyConfigs;
  }

  const keyEnvVars = [
    { name: 'Primary', env: 'GOOGLE_CLOUD_API_KEY' },
    { name: 'Secondary', env: 'GOOGLE_CLOUD_API_KEY_SECONDARY' },
    { name: 'Tertiary', env: 'GOOGLE_CLOUD_API_KEY_TERTIARY' },
    { name: 'Quaternary', env: 'GOOGLE_CLOUD_API_KEY_QUATERNARY' },
  ];

  for (const { name, env } of keyEnvVars) {
    const key = process.env[env];
    if (key) {
      apiKeyConfigs.push({
        name,
        key,
        client: new GoogleGenAI({ apiKey: key }),
      });
      console.log(`[TTS] ${name} API key configured (${env})`);
    }
  }

  if (apiKeyConfigs.length === 0) {
    throw new Error('No Gemini API keys configured. Set GOOGLE_CLOUD_API_KEY, GOOGLE_CLOUD_API_KEY_SECONDARY, GOOGLE_CLOUD_API_KEY_TERTIARY, or GOOGLE_CLOUD_API_KEY_QUATERNARY.');
  }

  console.log(`[TTS] ${apiKeyConfigs.length} API key(s) available for fallback`);
  return apiKeyConfigs;
}

// Each chunk gets its own key index to avoid race conditions in parallel processing
function getClientByIndex(keyIndex: number): GoogleGenAI {
  const configs = initializeClients();
  return configs[Math.min(keyIndex, configs.length - 1)].client;
}

function getKeyNameByIndex(keyIndex: number): string {
  const configs = initializeClients();
  return configs[Math.min(keyIndex, configs.length - 1)].name;
}

function hasMoreKeys(keyIndex: number): boolean {
  const configs = initializeClients();
  return keyIndex < configs.length - 1;
}

function getTotalKeyCount(): number {
  return initializeClients().length;
}

function isQuotaError(error: any): boolean {
  const message = error?.message || '';
  const status = error?.status || error?.code;
  return (
    status === 429 ||
    status === 'RESOURCE_EXHAUSTED' ||
    message.includes('429') ||
    message.includes('quota') ||
    message.includes('RESOURCE_EXHAUSTED') ||
    message.includes('rate limit')
  );
}

/**
 * Create WAV buffer from PCM data
 * @param pcmData - Raw PCM audio data
 * @param sampleRate - Sample rate from Gemini response (default 24000 for Gemini TTS)
 */
function createWavFromPcm(pcmData: Buffer, sampleRate: number = 24000): Buffer {
  const channels = 1;
  const bitDepth = 16;
  const byteRate = sampleRate * channels * (bitDepth / 8);
  const blockAlign = channels * (bitDepth / 8);
  const dataSize = pcmData.length;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(dataSize + 36, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  console.log(`[TTS] Created WAV header: ${sampleRate}Hz, ${channels}ch, ${bitDepth}bit`);
  return Buffer.concat([header, pcmData]);
}

/**
 * Process PCM audio through ffmpeg to create WAV with proper headers
 * Falls back to direct WAV creation if ffmpeg fails
 * 
 * @param pcmData - Raw PCM audio data (16-bit signed little-endian)
 * @param sampleRate - Sample rate for the audio
 * @returns Promise<Buffer> - WAV buffer
 */
async function processAudioToWav(pcmData: Buffer, sampleRate: number): Promise<Buffer> {
  try {
    return await new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const ffmpeg = spawn('ffmpeg', [
        '-f', 's16le',           // Input format: signed 16-bit little-endian PCM
        '-ar', sampleRate.toString(),
        '-ac', '1',              // Mono
        '-i', 'pipe:0',          // Read from stdin
        '-ar', TARGET_SAMPLE_RATE.toString(),  // Output at target rate
        '-acodec', 'pcm_s16le',  // Output codec
        '-f', 'wav',             // Output format
        'pipe:1'                 // Write to stdout
      ]);

      const chunks: Buffer[] = [];
      let stderr = '';

      ffmpeg.stdout.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      ffmpeg.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        
        if (code === 0) {
          const wavBuffer = Buffer.concat(chunks);
          console.log(`[TTS-ffmpeg] ${pcmData.length} bytes PCM → ${wavBuffer.length} bytes WAV @ ${TARGET_SAMPLE_RATE}Hz in ${elapsed}s`);
          resolve(wavBuffer);
        } else {
          console.error(`[TTS-ffmpeg] error (code ${code}):`, stderr.slice(-500));
          reject(new Error(`ffmpeg failed with code ${code}`));
        }
      });

      ffmpeg.on('error', (err) => {
        console.error('[TTS-ffmpeg] spawn error:', err.message);
        reject(err);
      });

      ffmpeg.stdin.write(pcmData);
      ffmpeg.stdin.end();
    });
  } catch (error) {
    // Fallback to direct WAV creation if ffmpeg fails
    console.warn(`[TTS-ffmpeg] Fallback to direct WAV creation: ${(error as Error).message}`);
    return createWavFromPcm(pcmData, sampleRate);
  }
}

/**
 * Extract sample rate from Gemini response mime type
 * Gemini returns audio/L16;rate=XXXX for PCM data
 */
function extractSampleRate(mimeType?: string): number {
  if (!mimeType) return 24000;
  
  // Parse "audio/L16;rate=24000" format
  const rateMatch = mimeType.match(/rate=(\d+)/);
  if (rateMatch) {
    const rate = parseInt(rateMatch[1], 10);
    console.log(`[TTS] Extracted sample rate from mime type: ${rate}Hz`);
    return rate;
  }
  
  return 24000; // Default for Gemini TTS
}

/**
 * Sanitize speaker alias to be alphanumeric only (Gemini requirement)
 * Removes hyphens, spaces, and special characters
 */
function sanitizeSpeakerAlias(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '');
}

/**
 * Split text into chunks at sentence boundaries
 */
function splitIntoChunks(text: string): string[] {
  if (text.length <= CHUNK_SIZE) {
    return [text];
  }

  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const chunks: string[] = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > CHUNK_SIZE && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk += sentence;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.trim());
  }

  console.log(`[TTS] Split ${text.length} chars into ${chunks.length} chunks (max ${CHUNK_SIZE} chars each)`);
  return chunks;
}

/**
 * Build accent prompt for natural language steering.
 * When the target language is not English the "English" qualifier is removed
 * from the accent instruction so Gemini TTS does not switch to English.
 * e.g. Polish + Australian → "Speak in Polish with an Australian-accented delivery."
 *      English + Australian → "Speak with an Australian English accent."
 */
function getAccentPrompt(accent?: string | null, language: string = 'en'): string {
  if (!accent) return '';
  const normalized = accent.toLowerCase().replace(/\s+/g, '-');
  const englishPrompt = ACCENT_PROMPTS[normalized];
  if (!englishPrompt) return '';

  if (language === 'en') return englishPrompt;

  // For non-English: use just the accent name without the "English" qualifier
  // so we don't tell Gemini to switch to English.
  const accentLabel = normalized
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase()); // e.g. "Australian", "British"
  const article = /^[aeiou]/i.test(accentLabel) ? 'an' : 'a';
  const langName = getLanguageName(language);
  return `Speak in ${langName} with ${article} ${accentLabel} accent.`;
}

/**
 * SSML Rate Control for Drift Prevention
 * 
 * Gemini 2.5 TTS supports SSML prosody tags for rate control.
 * Wrapping text in <prosody rate="100%"> locks the speaking pace,
 * preventing progressive speed drift in single-speaker synthesis.
 * 
 * Research source: https://dev.to/abdalrohman/deep-dive-i-tested-googles-new-gemini-25-pro-tts-with-emotion-ssml-tags-5d3i
 * - <prosody rate="..."> works with values: "slow", "medium", "fast", "100%", "120%", etc.
 * - Natural language pace instructions also work: "Speak at a steady pace"
 * - Tags like [speaking slowly] work inline
 * 
 * For drift prevention, we use:
 * 1. Natural language instruction: "Speak at a consistent, steady pace"
 * 2. SSML wrapper: <prosody rate="100%">content</prosody>
 * 
 * For naturalness, we also:
 * 1. Insert SSML <break> tags at natural pause points (sentences, paragraphs)
 * 2. Use expressive delivery instruction
 */

// Enhanced instruction for natural, expressive delivery with consistent pace
const PACE_INSTRUCTION = 'Speak naturally with warm, engaging expression. Use natural pauses for emphasis. Vary your intonation to keep the listener engaged. Maintain a consistent, steady speaking pace throughout.';

/**
 * Insert natural SSML pauses at sentence boundaries using proper NLP tokenization
 * 
 * Uses the 'sbd' (Sentence Boundary Detection) library which handles:
 * - Abbreviations (Dr., Mr., Gov., Sept., U.S., etc.)
 * - Quoted text and dialogue
 * - Numerals and decimals
 * - URLs and emails
 * 
 * Pause durations:
 * - Sentence boundaries: 400ms (natural breathing room)
 * - Paragraph breaks: 600ms (topic transitions)
 * - Ellipsis: 500ms (dramatic pause, detected separately)
 */
function insertNaturalPauses(text: string): string {
  // Handle paragraph breaks first (double newlines → 600ms)
  // Mark them with a unique placeholder to preserve through tokenization
  const PARA_MARKER = '[[PARAGRAPH_BREAK]]';
  let processedText = text.replace(/\n\s*\n/g, ` ${PARA_MARKER} `);
  
  // Handle ellipsis separately for 500ms dramatic pauses
  const ELLIPSIS_MARKER = '[[ELLIPSIS_PAUSE]]';
  processedText = processedText.replace(/\.\.\./g, `...${ELLIPSIS_MARKER}`);
  
  // Use sbd to tokenize into sentences
  const sentences = sbd.sentences(processedText, {
    newline_boundaries: false,
    preserve_whitespace: false
  });
  
  // Join sentences with 400ms breaks between them
  let result = (sentences as string[]).map((sentence: string, index: number) => {
    // Don't add break after the last sentence
    if (index === sentences.length - 1) {
      return sentence;
    }
    return `${sentence} <break time="400ms"/>`;
  }).join(' ');
  
  // Replace paragraph markers with 600ms breaks
  result = result.replace(new RegExp(PARA_MARKER, 'g'), '<break time="600ms"/>');
  
  // Replace ellipsis markers with 500ms breaks
  result = result.replace(new RegExp(ELLIPSIS_MARKER, 'g'), ' <break time="500ms"/>');
  
  // Clean up any double breaks (keep the longer one)
  result = result.replace(/<break[^>]+>\s*<break[^>]+>/g, (match: string) => {
    const times = match.match(/time="(\d+)ms"/g) || [];
    const maxTime = Math.max(...times.map((t: string) => parseInt(t.match(/\d+/)?.[0] || '0')));
    return `<break time="${maxTime}ms"/>`;
  });
  
  // Normalize whitespace
  result = result.replace(/\s+/g, ' ').trim();
  
  return result;
}

/**
 * Apply SSML rate control to prevent progressive speed drift
 * Uses <prosody rate="100%"> to lock speaking pace at normal speed
 * Also inserts natural pauses for more human-like delivery
 */
function applyRateControl(text: string): string {
  // First, insert natural pauses at sentence/paragraph boundaries
  const textWithPauses = insertNaturalPauses(text);
  
  // Wrap content in SSML prosody tag for explicit rate control
  // rate="100%" = normal speed, locked to prevent drift
  return `<prosody rate="100%">${textWithPauses}</prosody>`;
}

/**
 * Apply accent and emotion processing to text using natural language prompting
 * Uses "Say the following:" separator to prevent instructions from being spoken
 * This pattern is consistent with geminiTTS.ts implementation
 * 
 * Enhanced with:
 * - SSML rate control to prevent speed drift in single-speaker synthesis
 * - Emotion tag conversion to natural language instructions (e.g., [laugh] → "Include natural laughter")
 */
function applyAccentToText(text: string, accent?: string | null, language: string = 'en'): string {
  // First, process emotion/vocalization tags into natural language instructions
  const { cleanText, emotionPrompt } = processEmotionTags(text);
  
  const accentPrompt = getAccentPrompt(accent, language);
  
  // Apply SSML rate control to lock pace and prevent drift
  const rateControlledText = applyRateControl(cleanText);
  
  // Build instruction prompt: pace instruction + emotion instructions + optional accent
  const instructions = [PACE_INSTRUCTION];
  if (emotionPrompt) {
    instructions.push(emotionPrompt);
  }
  if (accentPrompt) {
    instructions.push(accentPrompt);
  }
  
  // Log if emotion processing was applied
  if (emotionPrompt) {
    console.log(`[TTS] Emotion prompt: ${emotionPrompt}`);
  }
  
  // Use "Say the following:" separator to keep instruction out of spoken text
  // This matches the pattern used in geminiTTS.ts for style instructions
  return `${instructions.join(' ')} Say the following: ${rateControlledText}`;
}

/**
 * Synthesize a single chunk of text with API key fallback and timeout protection
 * Each chunk maintains its own key index to avoid race conditions in parallel processing
 */
async function synthesizeChunk(
  text: string,
  voiceName: string,
  chunkIndex: number,
  totalChunks: number,
  accent?: string | null,
  language: string = 'en',
  temperature: number = TEMPERATURE_DEFAULT,
  seed?: number
): Promise<Buffer> {
  const maxRetries = 3;
  let lastError: Error | null = null;
  const timeoutMs = calculateTimeout(text.length);
  
  // Each chunk gets its own local key index - no shared state!
  let localKeyIndex = 0;
  const totalKeys = getTotalKeyCount();

  // Try with each key in sequence until success or all exhausted
  while (localKeyIndex < totalKeys) {
    const client = getClientByIndex(localKeyIndex);
    const keyName = getKeyNameByIndex(localKeyIndex);
    let rotatedKey = false; // tracks whether the inner loop exited due to key rotation

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const chunkStartTime = Date.now();
      try {
        // Apply accent and SSML rate control via natural language prompting
        const textWithAccent = applyAccentToText(text, accent, language);
        const accentLog = accent ? `, accent=${accent}` : '';
        const langLog = language !== 'en' ? `, lang=${language}` : '';
        console.log(`[TTS] Chunk ${chunkIndex + 1}/${totalChunks}: ${text.length} chars, voice=${voiceName}${accentLog}${langLog}, key=${keyName}, rateControl=ON, timeout=${(timeoutMs / 1000).toFixed(0)}s${attempt > 1 ? `, attempt ${attempt}` : ''}`);

        // Race between API call and timeout (with proper cleanup)
        const timeout = createTimeoutController(timeoutMs, chunkIndex);
        const apiPromise = client.models.generateContent({
          model: TTS_MODEL,
          contents: [{ parts: [{ text: textWithAccent }] }],
          config: {
            responseModalities: ['AUDIO'],
            temperature,
            ...(seed !== undefined ? { seed } : {}),
            candidateCount: 1,
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
              },
            },
          },
        });

        let response;
        try {
          response = await Promise.race([apiPromise, timeout.promise]);
        } finally {
          timeout.clear(); // Always clear timeout to prevent memory leaks
        }

        const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        const audioData = inlineData?.data;
        const mimeType = inlineData?.mimeType;
        
        if (!audioData) {
          throw new Error('No audio data in Gemini response');
        }

        const audioBuffer = Buffer.from(audioData, 'base64');
        const header = audioBuffer.slice(0, 4).toString('utf-8');
        const elapsed = ((Date.now() - chunkStartTime) / 1000).toFixed(1);

        // Convert PCM to WAV with resampling to fix potential sample rate drift
        // This normalizes Gemini's output to exactly TARGET_SAMPLE_RATE (24000Hz)
        if (header === 'RIFF') {
          // Already WAV - but still resample to normalize any drift
          // WAV header claims 24kHz but actual audio may drift in long chunks
          console.log(`[TTS] Chunk ${chunkIndex + 1}: ${audioBuffer.length} bytes (WAV) in ${elapsed}s - resampling to normalize`);
          // Extract PCM from WAV (skip 44-byte header) and resample
          const pcmFromWav = audioBuffer.slice(44);
          const declaredRate = audioBuffer.readUInt32LE(24); // Sample rate at byte 24 in WAV header
          const resampledWav = await processAudioToWav(pcmFromWav, declaredRate);
          return resampledWav;
        } else {
          // Raw PCM - extract declared sample rate and resample to normalize
          const declaredSampleRate = extractSampleRate(mimeType);
          console.log(`[TTS] Chunk ${chunkIndex + 1}: ${audioBuffer.length} bytes PCM @ ${declaredSampleRate}Hz in ${elapsed}s - resampling to ${TARGET_SAMPLE_RATE}Hz`);
          const resampledWav = await processAudioToWav(audioBuffer, declaredSampleRate);
          return resampledWav;
        }

      } catch (error: any) {
        lastError = error;
        const elapsed = ((Date.now() - chunkStartTime) / 1000).toFixed(1);
        const isTimeout = error.message?.includes('timed out');
        console.error(`[TTS] Chunk ${chunkIndex + 1} ${isTimeout ? 'TIMEOUT' : 'error'} (${keyName}, attempt ${attempt}, ${elapsed}s):`, error.message);

        // Quota error: rotate to next key immediately
        if (isQuotaError(error)) {
          console.warn(`[TTS] Chunk ${chunkIndex + 1}: Quota exceeded on ${keyName} API key`);
          if (localKeyIndex < totalKeys - 1) {
            localKeyIndex++;
            console.log(`[TTS] Chunk ${chunkIndex + 1}: Switching to ${getKeyNameByIndex(localKeyIndex)} API key (index ${localKeyIndex})`);
            rotatedKey = true;
            break; // Break inner loop to retry with new key
          } else {
            console.error(`[TTS] Chunk ${chunkIndex + 1}: All ${totalKeys} API keys exhausted`);
            throw new Error('All Gemini API keys quota exhausted. Please try again later.');
          }
        }

        // Timeout: also rotate to next key immediately — don't re-hammer the same slow endpoint
        if (isTimeout && localKeyIndex < totalKeys - 1) {
          localKeyIndex++;
          console.warn(`[TTS] Chunk ${chunkIndex + 1}: Timeout on ${keyName}, rotating immediately to ${getKeyNameByIndex(localKeyIndex)} API key`);
          rotatedKey = true;
          break; // Break inner loop to retry with new key
        }

        // Other errors (and timeout when no more keys are available): retry with exponential backoff
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          console.log(`[TTS] Retrying chunk ${chunkIndex + 1} in ${delay / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // rotatedKey=true means the inner loop broke early to switch keys → continue outer loop
    // rotatedKey=false means all retries were used up on this key without rotation → give up
    if (!rotatedKey) {
      break;
    }
  }

  throw lastError || new Error('TTS synthesis failed');
}

/**
 * Synthesize full text to array of WAV buffers
 * Parallel processing with concurrency limit for speed
 * @param accent - Optional accent to apply (e.g., 'british', 'american', 'australian')
 */
export async function synthesizeText(text: string, voiceName: string, accent?: string | null, language: string = 'en', template?: string | null, seedOverride?: number): Promise<Buffer[]> {
  const chunks = splitIntoChunks(text);
  const wavBuffers: Buffer[] = new Array(chunks.length);

  const temperature = getTemperatureForTemplate(template);
  const seed = seedOverride !== undefined ? seedOverride : generatePodcastSeed();
  const accentLog = accent ? `, accent=${accent}` : '';
  const langLog = language !== 'en' ? `, lang=${language}` : '';
  const tplLog = template ? `, template=${template}` : '';
  console.log(`[TTS] Starting parallel synthesis: ${text.length} chars, ${chunks.length} chunks, voice=${voiceName}${accentLog}${langLog}${tplLog}, temperature=${temperature}, seed=${seed}, parallelLimit=${PARALLEL_LIMIT}`);

  // Process chunks in parallel batches of PARALLEL_LIMIT (4)
  for (let batchStart = 0; batchStart < chunks.length; batchStart += PARALLEL_LIMIT) {
    const batchEnd = Math.min(batchStart + PARALLEL_LIMIT, chunks.length);
    const batchChunks = chunks.slice(batchStart, batchEnd);
    
    console.log(`[TTS] Processing batch ${Math.floor(batchStart / PARALLEL_LIMIT) + 1}: chunks ${batchStart + 1}-${batchEnd} of ${chunks.length}`);
    
    const batchPromises = batchChunks.map((chunk, j) => 
      synthesizeChunk(chunk, voiceName, batchStart + j, chunks.length, accent, language, temperature, seed)
    );
    
    const batchResults = await Promise.all(batchPromises);
    
    // Store results in correct positions to maintain order
    batchResults.forEach((buffer, j) => {
      wavBuffers[batchStart + j] = buffer;
    });
  }

  console.log(`[TTS] Parallel synthesis complete: ${wavBuffers.length} WAV buffers`);
  return wavBuffers;
}

/**
 * Synthesize multi-speaker dialogue
 * Each segment is synthesized separately then concatenated
 */
export interface DialogueSegment {
  speaker: string;
  voice: string;
  text: string;
  accent?: string | null;
}

/**
 * Options for dialogue synthesis
 */
export interface DialogueOptions {
  /** Map of voice name to accent (e.g., { 'Kore': 'british', 'Charon': 'american' }) */
  voiceAccents?: Record<string, string | null>;
}

export async function synthesizeDialogue(segments: DialogueSegment[], options?: DialogueOptions): Promise<Buffer[]> {
  const wavBuffers: Buffer[] = [];

  console.log(`[TTS] Starting dialogue synthesis: ${segments.length} segments`);
  if (options?.voiceAccents) {
    console.log(`[TTS] Voice accents:`, JSON.stringify(options.voiceAccents));
  }

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    // Get accent from segment, or from options by voice name
    const accent = segment.accent || options?.voiceAccents?.[segment.voice] || null;
    const accentLog = accent ? ` with ${accent} accent` : '';
    console.log(`[TTS] Segment ${i + 1}/${segments.length}: ${segment.speaker} (${segment.text.length} chars)${accentLog}`);
    
    // Each segment may produce multiple chunks
    const segmentBuffers = await synthesizeText(segment.text, segment.voice, accent);
    wavBuffers.push(...segmentBuffers);
  }

  console.log(`[TTS] Dialogue synthesis complete: ${wavBuffers.length} total WAV buffers`);
  return wavBuffers;
}

/**
 * Multi-speaker TTS configuration for 2-host podcasts
 * Uses Gemini's multiSpeakerVoiceConfig to synthesize entire dialogue in ONE API call
 */
export interface MultiSpeakerConfig {
  hostName: string;
  hostVoice: string;
  coHostName: string;
  coHostVoice: string;
  /** ISO 639-1 language code — used to steer Gemini TTS to speak the correct language */
  language?: string;
  /** Podcast template (e.g. 'news', 'stories') — drives sampling temperature for voice consistency */
  template?: string | null;
}

/**
 * Synthesize multi-speaker dialogue using Gemini's native multi-speaker support
 * This makes ONE API call for the entire dialogue (up to ~8 min), drastically reducing API calls
 * Each chunk maintains its own key index to avoid race conditions in parallel processing
 * 
 * Format expected by Gemini:
 * "Speaker Joe: How's it going today Jane?
 *  Speaker Jane: Not too bad, how about you?"
 */
async function synthesizeMultiSpeakerChunk(
  dialogueText: string,
  config: MultiSpeakerConfig,
  chunkIndex: number,
  totalChunks: number,
  temperature: number = TEMPERATURE_DEFAULT,
  seed?: number
): Promise<Buffer> {
  const maxRetries = 3;
  let lastError: Error | null = null;
  const timeoutMs = calculateTimeout(dialogueText.length);
  
  // Sanitize speaker names to alphanumeric only (Gemini requirement)
  const sanitizedHostName = sanitizeSpeakerAlias(config.hostName);
  const sanitizedCoHostName = sanitizeSpeakerAlias(config.coHostName);
  
  // Each chunk gets its own local key index - no shared state!
  let localKeyIndex = 0;
  const totalKeys = getTotalKeyCount();

  // Try with each key in sequence until success or all exhausted
  while (localKeyIndex < totalKeys) {
    const client = getClientByIndex(localKeyIndex);
    const keyName = getKeyNameByIndex(localKeyIndex);
    let rotatedKey = false; // tracks whether the inner loop exited due to key rotation

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const chunkStartTime = Date.now();
      try {
        console.log(`[TTS-MultiSpeaker] Chunk ${chunkIndex + 1}/${totalChunks}: ${dialogueText.length} chars, hosts=${sanitizedHostName}(${config.hostVoice})+${sanitizedCoHostName}(${config.coHostVoice}), key=${keyName}, timeout=${(timeoutMs / 1000).toFixed(0)}s${attempt > 1 ? `, attempt ${attempt}` : ''}`);

        const timeout = createTimeoutController(timeoutMs, chunkIndex);
        const langName = config.language && config.language !== 'en'
          ? getLanguageName(config.language)
          : null;
        const ttsPrompt = langName
          ? `TTS the following conversation in ${langName}:\n${dialogueText}`
          : `TTS the following conversation:\n${dialogueText}`;
        const apiPromise = client.models.generateContent({
          model: TTS_MODEL,
          contents: [{ parts: [{ text: ttsPrompt }] }],
          config: {
            responseModalities: ['AUDIO'],
            temperature,
            ...(seed !== undefined ? { seed } : {}),
            candidateCount: 1,
            speechConfig: {
              multiSpeakerVoiceConfig: {
                speakerVoiceConfigs: [
                  {
                    speaker: sanitizedHostName,
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: config.hostVoice } }
                  },
                  {
                    speaker: sanitizedCoHostName,
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: config.coHostVoice } }
                  }
                ]
              }
            }
          }
        });

        let response;
        try {
          response = await Promise.race([apiPromise, timeout.promise]);
        } finally {
          timeout.clear();
        }

        const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        const audioData = inlineData?.data;
        const mimeType = inlineData?.mimeType;
        
        if (!audioData) {
          throw new Error('No audio data in Gemini multi-speaker response');
        }

        const audioBuffer = Buffer.from(audioData, 'base64');
        const header = audioBuffer.slice(0, 4).toString('utf-8');
        const elapsed = ((Date.now() - chunkStartTime) / 1000).toFixed(1);

        // Convert to WAV with resampling to normalize sample rate
        // Multi-speaker typically doesn't drift due to speaker turn resets, but resample for consistency
        if (header === 'RIFF') {
          console.log(`[TTS-MultiSpeaker] Chunk ${chunkIndex + 1}: ${audioBuffer.length} bytes (WAV) in ${elapsed}s - resampling for consistency`);
          const pcmFromWav = audioBuffer.slice(44);
          const declaredRate = audioBuffer.readUInt32LE(24);
          const resampledWav = await processAudioToWav(pcmFromWav, declaredRate);
          return resampledWav;
        } else {
          // Raw PCM - extract declared sample rate and resample
          const declaredSampleRate = extractSampleRate(mimeType);
          console.log(`[TTS-MultiSpeaker] Chunk ${chunkIndex + 1}: ${audioBuffer.length} bytes PCM @ ${declaredSampleRate}Hz in ${elapsed}s - resampling to ${TARGET_SAMPLE_RATE}Hz`);
          const resampledWav = await processAudioToWav(audioBuffer, declaredSampleRate);
          return resampledWav;
        }

      } catch (error: any) {
        lastError = error;
        const elapsed = ((Date.now() - chunkStartTime) / 1000).toFixed(1);
        const isTimeout = error.message?.includes('timed out');
        console.error(`[TTS-MultiSpeaker] Chunk ${chunkIndex + 1} ${isTimeout ? 'TIMEOUT' : 'error'} (${keyName}, attempt ${attempt}, ${elapsed}s):`, error.message);

        // Quota error: rotate to next key immediately
        if (isQuotaError(error)) {
          console.warn(`[TTS-MultiSpeaker] Chunk ${chunkIndex + 1}: Quota exceeded on ${keyName} API key`);
          if (localKeyIndex < totalKeys - 1) {
            localKeyIndex++;
            console.log(`[TTS-MultiSpeaker] Chunk ${chunkIndex + 1}: Switching to ${getKeyNameByIndex(localKeyIndex)} API key (index ${localKeyIndex})`);
            rotatedKey = true;
            break;
          } else {
            console.error(`[TTS-MultiSpeaker] Chunk ${chunkIndex + 1}: All ${totalKeys} API keys exhausted`);
            throw new Error('All Gemini API keys quota exhausted. Please try again later.');
          }
        }

        // Timeout: also rotate to next key immediately — don't re-hammer the same slow endpoint
        if (isTimeout && localKeyIndex < totalKeys - 1) {
          localKeyIndex++;
          console.warn(`[TTS-MultiSpeaker] Chunk ${chunkIndex + 1}: Timeout on ${keyName}, rotating immediately to ${getKeyNameByIndex(localKeyIndex)} API key`);
          rotatedKey = true;
          break;
        }

        // Other errors (and timeout when no more keys are available): retry with exponential backoff
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          console.log(`[TTS-MultiSpeaker] Retrying chunk ${chunkIndex + 1} in ${delay / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // rotatedKey=true means the inner loop broke early to switch keys → continue outer loop
    // rotatedKey=false means all retries were used up on this key without rotation → give up
    if (!rotatedKey) {
      break;
    }
  }

  throw lastError || new Error('Multi-speaker TTS synthesis failed');
}

/**
 * Format dialogue segments for Gemini multi-speaker TTS
 * Converts segments to: "SpeakerName: Text content" (alphanumeric alias, no whitespace)
 * Sanitizes speaker names to remove hyphens and special characters
 */
function formatDialogueForMultiSpeaker(segments: DialogueSegment[]): string {
  return segments.map(seg => `${sanitizeSpeakerAlias(seg.speaker)}: ${seg.text}`).join('\n');
}

/**
 * Split dialogue segments into chunks that fit within the character limit
 * Keeps dialogue together when possible, splits at segment boundaries
 */
function splitDialogueIntoChunks(segments: DialogueSegment[], maxChars: number = CHUNK_SIZE_MULTISPEAKER): DialogueSegment[][] {
  const chunks: DialogueSegment[][] = [];
  let currentChunk: DialogueSegment[] = [];
  let currentLength = 0;

  for (const segment of segments) {
    // Use sanitized speaker name for accurate length calculation
    const segmentText = `${sanitizeSpeakerAlias(segment.speaker)}: ${segment.text}\n`;
    const segmentLength = segmentText.length;

    // If single segment exceeds limit, it goes in its own chunk
    if (segmentLength > maxChars) {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentLength = 0;
      }
      chunks.push([segment]);
      continue;
    }

    // If adding segment exceeds limit, start new chunk
    if (currentLength + segmentLength > maxChars && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [segment];
      currentLength = segmentLength;
    } else {
      currentChunk.push(segment);
      currentLength += segmentLength;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * Synthesize 2-host podcast dialogue using Gemini multi-speaker TTS
 * Makes dramatically fewer API calls by combining entire dialogue chunks
 * 
 * @param segments - Dialogue segments with speaker names and text
 * @param config - Multi-speaker voice configuration
 * @returns Array of WAV buffers (one per API call/chunk)
 */
export async function synthesizeMultiSpeakerDialogue(
  segments: DialogueSegment[],
  config: MultiSpeakerConfig
): Promise<Buffer[]> {
  const wavBuffers: Buffer[] = [];

  // Split dialogue into chunks that fit within API limits
  // Multi-speaker uses larger chunks since speaker turns naturally limit drift
  const dialogueChunks = splitDialogueIntoChunks(segments, CHUNK_SIZE_MULTISPEAKER);
  
  const totalSegments = segments.length;
  const segmentsPerChunk = (totalSegments / dialogueChunks.length).toFixed(1);
  
  const temperature = getTemperatureForTemplate(config.template);
  const seed = generatePodcastSeed();

  console.log(`[TTS-MultiSpeaker] Starting multi-speaker synthesis: ${totalSegments} segments → ${dialogueChunks.length} API calls (~${segmentsPerChunk} segs/call)`);
  console.log(`[TTS-MultiSpeaker] Hosts: ${config.hostName}(${config.hostVoice}), ${config.coHostName}(${config.coHostVoice}), template=${config.template ?? 'default'}, temperature=${temperature}, seed=${seed}`);

  for (let i = 0; i < dialogueChunks.length; i++) {
    const chunkSegments = dialogueChunks[i];
    // Inject phonetics for vocal-effect tags into each segment's spoken text.
    // Multi-speaker has no separate instruction channel, so the phonetic form
    // in the text is the only way the model can produce audible vocalizations.
    const processedSegments = chunkSegments.map(seg => ({
      ...seg,
      text: processEmotionTags(seg.text).cleanText,
    }));
    const dialogueText = formatDialogueForMultiSpeaker(processedSegments);
    
    console.log(`[TTS-MultiSpeaker] Chunk ${i + 1}/${dialogueChunks.length}: ${chunkSegments.length} segments, ${dialogueText.length} chars`);
    
    const wavBuffer = await synthesizeMultiSpeakerChunk(dialogueText, config, i, dialogueChunks.length, temperature, seed);
    wavBuffers.push(wavBuffer);
  }

  console.log(`[TTS-MultiSpeaker] Multi-speaker synthesis complete: ${wavBuffers.length} WAV buffers from ${totalSegments} segments`);
  return wavBuffers;
}
