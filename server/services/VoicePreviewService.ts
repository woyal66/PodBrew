import { ObjectStorageService, objectStorageClient } from '../objectStorage';
import { voiceCatalogRepository } from './VoiceCatalogRepository';
import { synthesizeSingleSpeakerV2 } from './GeminiTTSv2';
import { convertWavToMp3 } from '../audioUtils';
import type { Voice } from '@shared/schema';
import crypto from 'crypto';

/**
 * VoicePreviewService
 * Generates short audio preview samples for voice catalog voices
 * 
 * Features:
 * - Standard test phrase for consistent comparisons
 * - 5-10 second preview duration
 * - Storage in object storage with caching
 * - Support for all voice tiers and models
 */
export class VoicePreviewService {
  private objectStorage: ObjectStorageService;
  
  // Concurrency control: track in-progress preview generations to prevent duplicate TTS calls
  private generatingPreviews = new Map<string, Promise<string>>();

  private accentPreviewMap: Map<string, string> | null = null;
  private accentMapLoadPromise: Promise<void> | null = null;

  // Standard test phrases for different voice contexts
  private readonly TEST_PHRASES = {
    default: "Welcome to PodBrew. This is a sample of my voice, designed to help you choose the perfect narrator for your podcast. I can adapt to different tones and styles to match your content.",
    news: "Good evening. Breaking news just in: researchers have made a groundbreaking discovery. We'll bring you the latest developments as this story unfolds.",
    conversational: "Hey there! So I was thinking about this really interesting topic, and I just had to share it with you. It's one of those things that really makes you stop and think, you know?",
    narrative: "In the depths of winter, when the world lay silent beneath a blanket of snow, something extraordinary was about to unfold. This is where our story begins.",
  };

  constructor() {
    this.objectStorage = new ObjectStorageService();
  }

  /**
   * Generate a preview audio sample for a voice
   * Uses concurrency control to prevent duplicate TTS calls for the same voice
   */
  async generatePreview(voiceId: string): Promise<string> {
    // Check if preview generation is already in progress for this voice
    const existingGeneration = this.generatingPreviews.get(voiceId);
    if (existingGeneration) {
      console.log(`Voice preview generation already in progress for ${voiceId}, waiting...`);
      return existingGeneration;
    }

    // Create new generation promise
    const generationPromise = this.doGeneratePreview(voiceId);
    
    // Store in map to prevent concurrent generations
    this.generatingPreviews.set(voiceId, generationPromise);

    try {
      const result = await generationPromise;
      return result;
    } finally {
      // Clean up after generation completes (success or failure)
      this.generatingPreviews.delete(voiceId);
    }
  }

  /**
   * Internal method to actually generate the preview
   * OPTIMIZATION: Checks object storage first to avoid TTS quota cost
   * Only generates if not cached in object storage
   */
  private async doGeneratePreview(voiceId: string): Promise<string> {
    console.log(`Starting preview generation for voice ${voiceId}`);
    
    // Get voice from catalog
    const voice = await voiceCatalogRepository.findById(voiceId);
    if (!voice) {
      throw new Error(`Voice not found: ${voiceId}`);
    }

    // CRITICAL: Reject standard tier voices - only allow premium, ultra, cinematic
    if (voice.tier === 'standard') {
      throw new Error(`Standard tier voices are not supported. Voice "${voice.displayName}" is standard tier. Please select premium, ultra, or cinematic voices only.`);
    }

    // Check if preview URL already stored in database (fastest path)
    if (voice.previewUrl) {
      console.log(`✅ Preview URL already cached in database for ${voiceId}`);
      return voice.previewUrl;
    }

    // CHECK OBJECT STORAGE FIRST - Zero quota cost if already generated!
    const existingPreview = await this.getExistingPreview(voice);
    if (existingPreview) {
      console.log(`✅ Preview found in object storage (no quota used): ${voiceId}`);
      // Update database with preview URL for faster future lookups
      await voiceCatalogRepository.updatePreviewUrl(voiceId, existingPreview);
      return existingPreview;
    }

    // Only generate if not already cached anywhere
    console.log(`⏳ Preview not cached - generating via TTS for ${voiceId}...`);

    // Select appropriate test phrase based on voice category
    const testPhrase = this.selectTestPhrase(voice);

    console.log(`Generating TTS audio for voice ${voiceId} (${voice.displayName})`);
    
    // Generate audio using Google TTS - THIS USES QUOTA
    const audioBuffer = await this.synthesizeSpeech(voice, testPhrase);

    console.log(`Uploading preview audio for voice ${voiceId}`);
    
    // Upload to object storage for permanent caching
    const previewUrl = await this.uploadPreview(voice, audioBuffer);

    // Persist preview URL to database
    await voiceCatalogRepository.updatePreviewUrl(voiceId, previewUrl);

    console.log(`✅ Preview generation complete for voice ${voiceId}: ${previewUrl}`);

    return previewUrl;
  }

  /**
   * Check if a preview already exists in object storage
   */
  private async getExistingPreview(voice: Voice): Promise<string | null> {
    const fileName = this.generatePreviewFileName(voice);
    const filePath = `voice-previews/${voice.id}/${fileName}`;

    try {
      const file = await this.objectStorage.searchPublicObject(filePath);
      
      if (file) {
        return `/public-objects/${filePath}`;
      }
    } catch (error) {
      console.error('Error checking for existing preview:', error);
    }

    return null;
  }

  /**
   * Select appropriate test phrase based on voice category
   */
  private selectTestPhrase(voice: Voice): string {
    if (voice.category === 'news') {
      return this.TEST_PHRASES.news;
    }
    
    const toneArchetype = voice.toneArchetype || '';
    if (toneArchetype.includes('storyteller') || toneArchetype.includes('narrator')) {
      return this.TEST_PHRASES.narrative;
    }
    
    if (toneArchetype.includes('casual') || toneArchetype.includes('friendly')) {
      return this.TEST_PHRASES.conversational;
    }

    return this.TEST_PHRASES.default;
  }

  /**
   * Synthesize speech using Gemini TTS V2 (natural language prompting)
   */
  private async synthesizeSpeech(voice: Voice, text: string): Promise<Buffer> {
    // Gemini TTS uses simple voice names (e.g., 'Kore', 'Puck', 'Charon')
    const geminiVoiceName = voice.googleVoiceName;
    
    console.log(`[Gemini TTS Preview V2] Generating preview for voice: ${geminiVoiceName}`);
    
    // Use V2 module with natural language prompting (no SSML)
    const audioBuffer = await synthesizeSingleSpeakerV2(
      text, 
      geminiVoiceName, 
      'gemini-2.5-flash-preview-tts'
    );
    
    console.log(`[Gemini TTS Preview V2] Generated ${audioBuffer.length} bytes for voice ${geminiVoiceName}`);
    
    return audioBuffer;
  }

  /**
   * Upload preview audio to object storage
   */
  private async uploadPreview(voice: Voice, audioBuffer: Buffer): Promise<string> {
    const fileName = this.generatePreviewFileName(voice);
    
    // Convert WAV to MP3 for better browser compatibility
    console.log(`[VoicePreview] Converting ${audioBuffer.length} bytes WAV to MP3...`);
    const mp3Buffer = await convertWavToMp3(audioBuffer);
    console.log(`[VoicePreview] Converted to MP3: ${mp3Buffer.length} bytes`);
    
    return await this.objectStorage.uploadVoicePreview(
      voice.id,
      mp3Buffer,
      fileName
    );
  }

  /**
   * Generate consistent file name for voice preview
   */
  private generatePreviewFileName(voice: Voice): string {
    // Use voice ID and Google voice name to create a unique, reproducible filename
    const hash = crypto
      .createHash('md5')
      .update(`${voice.id}-${voice.googleVoiceName}`)
      .digest('hex')
      .substring(0, 8);
    
    return `${voice.googleVoiceName}-${hash}.mp3`;
  }

  /**
   * Batch generate previews for multiple voices
   */
  async generateBatchPreviews(voiceIds: string[]): Promise<Map<string, string>> {
    const results = new Map<string, string>();

    // Generate previews sequentially to avoid rate limits
    for (const voiceId of voiceIds) {
      try {
        const previewUrl = await this.generatePreview(voiceId);
        results.set(voiceId, previewUrl);
        
        // Small delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`Failed to generate preview for voice ${voiceId}:`, error);
        results.set(voiceId, '');
      }
    }

    return results;
  }

  /**
   * Get preview URL for a voice (returns existing or generates new)
   */
  async getPreviewUrl(voiceId: string): Promise<string> {
    return await this.generatePreview(voiceId);
  }

  /**
   * Pre-generate all voice previews on server startup
   * Runs in background to warm up the cache without blocking server startup
   */
  async preGenerateAllVoicePreviews(): Promise<void> {
    try {
      console.log('[VoicePreview] Starting pre-generation of all voice previews...');
      
      // Get all active voices from database
      const allVoices = await voiceCatalogRepository.findAll();
      const activeVoices = allVoices.filter(v => v.isActive);
      
      console.log(`[VoicePreview] Found ${activeVoices.length} active voices`);

      // Count how many need preview generation
      const voicesNeedingPreview = activeVoices.filter(v => !v.previewUrl);
      console.log(`[VoicePreview] ${voicesNeedingPreview.length} voices need preview generation`);

      if (voicesNeedingPreview.length === 0) {
        console.log('[VoicePreview] All voice previews already cached');
        return;
      }

      // Generate previews for voices that don't have them yet
      let generatedCount = 0;
      for (const voice of voicesNeedingPreview) {
        try {
          await this.generatePreview(voice.id);
          generatedCount++;
          console.log(`[VoicePreview] Pre-generated ${generatedCount}/${voicesNeedingPreview.length}: ${voice.aliasName}`);
          
          // Respect rate limits - space out requests
          await new Promise(resolve => setTimeout(resolve, 800));
        } catch (error) {
          console.error(`[VoicePreview] Failed to pre-generate preview for ${voice.aliasName}:`, error);
        }
      }

      console.log(`[VoicePreview] Pre-generation complete: ${generatedCount}/${voicesNeedingPreview.length} voices ready`);
    } catch (error) {
      console.error('[VoicePreview] Error during pre-generation:', error);
      // Don't fail server startup if preview generation fails
    }
  }

  /**
   * Build a mapping of "voiceName-accent" -> storage file path by scanning object storage.
   * This resolves the voice ID mismatch between current DB IDs and the IDs used when
   * accent previews were originally cached.
   */
  private async loadAccentPreviewMap(): Promise<void> {
    if (this.accentPreviewMap) return;

    if (this.accentMapLoadPromise) {
      await this.accentMapLoadPromise;
      return;
    }

    this.accentMapLoadPromise = (async () => {
      try {
        const map = new Map<string, string>();
        const searchPaths = this.objectStorage.getPublicObjectSearchPaths();
        const bucketPath = searchPaths[0];
        const { bucketName, objectName: basePath } = this.parsePath(bucketPath);
        const bucket = objectStorageClient.bucket(bucketName);

        const prefix = basePath ? `${basePath}/voice-previews/` : 'voice-previews/';
        const [files] = await bucket.getFiles({ prefix, maxResults: 2000 });

        const accentFiles = files.filter(f => f.name.includes('/accents/'));
        for (const file of accentFiles) {
          const match = file.name.match(/\/accents\/([a-z]+)-(.+)-[0-9a-f]{8}\.mp3$/);
          if (match) {
            const voiceName = match[1];
            const accent = match[2];
            const relativePath = file.name.replace(`${basePath}/`, '');
            const key = `${voiceName}-${accent}`;
            map.set(key, relativePath);
          }
        }

        this.accentPreviewMap = map;
        console.log(`[VoicePreview] Loaded accent preview map: ${map.size} entries`);
      } catch (error) {
        console.error('[VoicePreview] Error loading accent preview map:', error);
        this.accentPreviewMap = new Map();
      }
    })();

    await this.accentMapLoadPromise;
  }

  private parsePath(path: string): { bucketName: string; objectName: string } {
    if (!path.startsWith('/')) path = `/${path}`;
    const parts = path.split('/');
    return {
      bucketName: parts[1],
      objectName: parts.slice(2).join('/'),
    };
  }

  /**
   * Get accent-specific preview URL for a voice
   * Uses a cached mapping of voice name + accent to actual storage paths,
   * resolving any voice ID mismatches between DB and object storage.
   */
  async getAccentPreviewUrl(voiceId: string, accent: string): Promise<string | null> {
    const voice = await voiceCatalogRepository.findById(voiceId);
    if (!voice) {
      console.error(`[VoicePreview] Voice not found: ${voiceId}`);
      return null;
    }

    await this.loadAccentPreviewMap();

    const normalizedAccent = accent.toLowerCase().trim().replace(/\s+/g, '-');
    const key = `${voice.googleVoiceName.toLowerCase()}-${normalizedAccent}`;

    const storagePath = this.accentPreviewMap?.get(key);
    if (storagePath) {
      console.log(`[VoicePreview] ✅ Found accent preview: ${voice.aliasName} (${accent})`);
      return `/public-objects/${storagePath}`;
    }

    console.log(`[VoicePreview] ⚠️ Accent preview not cached: ${voice.aliasName} (${accent}) [key=${key}]`);
    return null;
  }

  /**
   * Get all available accent preview URLs for a voice
   * Returns a map of accent -> preview URL for all cached accent previews
   */
  async getAllAccentPreviews(voiceId: string): Promise<Record<string, string>> {
    const SUPPORTED_ACCENTS = [
      'british', 'australian', 'irish', 'scottish', 
      'indian', 'canadian', 'southern american', 'new zealand'
    ];

    const results: Record<string, string> = {};

    for (const accent of SUPPORTED_ACCENTS) {
      const url = await this.getAccentPreviewUrl(voiceId, accent);
      if (url) {
        results[accent] = url;
      }
    }

    return results;
  }
}

// Singleton instance
export const voicePreviewService = new VoicePreviewService();
