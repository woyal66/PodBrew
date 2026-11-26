/**
 * Watermark Audio Cache System (Per-Voice)
 * 
 * Pre-generates and caches intro/outro watermark audio per voice in object storage.
 * Eliminates 2 TTS API calls per podcast by reusing cached WAV buffers.
 * 
 * Cache structure: watermarks/{voiceName}/intro.wav, watermarks/{voiceName}/outro.wav
 */

import { ObjectStorageService } from '../objectStorage';
import { synthesizeText } from './ttsAdapter';

const WATERMARK_INTRO_TEXT = "It's brew time!";
const WATERMARK_OUTRO_TEXT = "You've been listening to a PodBrew creation.";

const WATERMARK_STORAGE_PATH = 'watermarks';
const INTRO_FILENAME = 'intro.wav';
const OUTRO_FILENAME = 'outro.wav';

interface CachedWatermarks {
  intro: Buffer;
  outro: Buffer;
}

// In-memory cache keyed by voice name
const voiceWatermarkCache = new Map<string, CachedWatermarks>();

/**
 * Get cached watermark buffers for a specific voice (zero TTS calls if cached)
 * Generates and caches if not already available
 */
export async function getCachedWatermarks(voice: string): Promise<CachedWatermarks> {
  // Check in-memory cache first
  if (voiceWatermarkCache.has(voice)) {
    console.log(`[WatermarkCache] Using in-memory cache for voice=${voice} (0 API calls)`);
    return voiceWatermarkCache.get(voice)!;
  }
  
  const objectStorage = new ObjectStorageService();
  const introPath = `${WATERMARK_STORAGE_PATH}/${voice}/${INTRO_FILENAME}`;
  const outroPath = `${WATERMARK_STORAGE_PATH}/${voice}/${OUTRO_FILENAME}`;
  
  try {
    // Check object storage cache
    const introExists = await objectStorage.checkObjectExists(introPath);
    const outroExists = await objectStorage.checkObjectExists(outroPath);
    
    if (introExists && outroExists) {
      console.log(`[WatermarkCache] Loading from storage for voice=${voice}...`);
      const introBuffer = await objectStorage.downloadPublicObjectAsBuffer(introPath);
      const outroBuffer = await objectStorage.downloadPublicObjectAsBuffer(outroPath);
      
      if (introBuffer && outroBuffer) {
        const cached = { intro: introBuffer, outro: outroBuffer };
        voiceWatermarkCache.set(voice, cached);
        console.log(`[WatermarkCache] ✅ Loaded from storage for voice=${voice} (intro: ${introBuffer.length}b, outro: ${outroBuffer.length}b)`);
        return cached;
      }
    }
    
    // Generate and cache for this voice
    console.log(`[WatermarkCache] Cache miss for voice=${voice} - generating via TTS...`);
    return await generateAndCacheWatermarks(voice);
    
  } catch (error) {
    console.error(`[WatermarkCache] Error loading cache for voice=${voice}:`, error);
    // Fallback: generate on-the-fly without caching
    console.log(`[WatermarkCache] ⚠️ Fallback: generating watermarks on-the-fly for voice=${voice}`);
    const [introBuffers, outroBuffers] = await Promise.all([
      synthesizeText(WATERMARK_INTRO_TEXT, voice),
      synthesizeText(WATERMARK_OUTRO_TEXT, voice)
    ]);
    return { intro: introBuffers[0], outro: outroBuffers[0] };
  }
}

/**
 * Generate watermarks via TTS and cache to object storage for a specific voice
 */
async function generateAndCacheWatermarks(voice: string): Promise<CachedWatermarks> {
  const objectStorage = new ObjectStorageService();
  
  const [introBuffers, outroBuffers] = await Promise.all([
    synthesizeText(WATERMARK_INTRO_TEXT, voice),
    synthesizeText(WATERMARK_OUTRO_TEXT, voice)
  ]);
  
  const introBuffer = introBuffers[0];
  const outroBuffer = outroBuffers[0];
  
  // Store in object storage
  await Promise.all([
    objectStorage.uploadPublicObject(
      `${WATERMARK_STORAGE_PATH}/${voice}/${INTRO_FILENAME}`,
      introBuffer,
      'audio/wav'
    ),
    objectStorage.uploadPublicObject(
      `${WATERMARK_STORAGE_PATH}/${voice}/${OUTRO_FILENAME}`,
      outroBuffer,
      'audio/wav'
    )
  ]);
  
  // Cache in memory
  const cached = { intro: introBuffer, outro: outroBuffer };
  voiceWatermarkCache.set(voice, cached);
  
  console.log(`[WatermarkCache] ✅ Generated and cached for voice=${voice} (intro: ${introBuffer.length}b, outro: ${outroBuffer.length}b)`);
  return cached;
}

/**
 * Check if watermarks are cached for a specific voice
 */
export function isWatermarkCacheReady(voice?: string): boolean {
  if (voice) {
    return voiceWatermarkCache.has(voice);
  }
  return voiceWatermarkCache.size > 0;
}

/**
 * Pre-warm cache for common voices (optional startup optimization)
 */
export async function initializeWatermarkCache(defaultVoice?: string): Promise<void> {
  if (defaultVoice) {
    console.log(`[WatermarkCache] Pre-warming cache for default voice=${defaultVoice}...`);
    await getCachedWatermarks(defaultVoice);
  } else {
    console.log('[WatermarkCache] Lazy initialization - watermarks will be cached on first use per voice');
  }
}

/**
 * Force regenerate watermarks for a specific voice
 */
export async function regenerateWatermarks(voice: string): Promise<void> {
  console.log(`[WatermarkCache] Force regenerating watermarks for voice=${voice}...`);
  voiceWatermarkCache.delete(voice);
  await generateAndCacheWatermarks(voice);
}
