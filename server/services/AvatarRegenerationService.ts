/**
 * Avatar Regeneration Service
 * Handles one-time migration of voice avatars on production publish
 * 
 * Flow:
 * 1. Check if REGENERATE_AVATARS env var is set
 * 2. Check if migration marker exists in object storage
 * 3. If needed, regenerate avatars for target voices
 * 4. Write completion marker to prevent re-runs
 */

import { db } from '../db';
import { voices } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { generateImage } from '../gemini';
import { ObjectStorageService } from '../objectStorage';

// Target voices to regenerate by name (empty for v2 - already done in v1)
const TARGET_VOICE_NAMES: string[] = [];

// Target voices to regenerate by specific ID (for duplicates like Victor)
// v2: Only regenerate Victor (professional) - "Smooth and pleasant, flowing delivery"
const TARGET_VOICE_IDS = [
  '061f991c-e1fc-4bdd-bfed-cf7605b7d503' // Victor (professional) - "Smooth and pleasant, flowing delivery"
];

// Migration version - change this to trigger a new migration
const MIGRATION_VERSION = 'v2';
const MARKER_PATH = `voice-avatars/_migrations/avatar-regen-${MIGRATION_VERSION}.json`;

interface VoiceData {
  id: string;
  aliasName: string;
  gender: string;
  accent: string;
}

// Module-level state to prevent concurrent runs
let migrationInProgress = false;
let migrationComplete = false;

/**
 * Generate a detailed prompt for creating a realistic portrait
 */
function generateAvatarPrompt(voice: VoiceData): string {
  const { aliasName, gender, accent } = voice;

  let prompt = `Professional headshot portrait photograph of a person named ${aliasName}, `;

  if (gender === 'MALE') {
    prompt += 'a professional man, ';
  } else if (gender === 'FEMALE') {
    prompt += 'a professional woman, ';
  } else if (gender === 'NEUTRAL') {
    prompt += 'a professional person with androgynous features, ';
  }

  if (accent === 'US') {
    prompt += 'American, ';
  } else if (accent === 'UK') {
    prompt += 'British, ';
  } else if (accent === 'AU') {
    prompt += 'Australian, ';
  } else if (accent === 'IN') {
    prompt += 'Indian, ';
  }

  prompt += 'clean studio lighting, neutral gray background, ';
  prompt += 'facing camera, friendly warm smile, professional attire, ';
  prompt += 'sharp focus on face, photorealistic, high quality, ';
  prompt += 'diversity-conscious casting, natural skin tones, ';
  prompt += '30-40 years old, approachable and trustworthy expression. ';
  prompt += 'NO text, NO logos, NO watermarks, NO artificial effects, NO exaggerated features.';

  return prompt;
}

class AvatarRegenerationService {
  private objectStorage: ObjectStorageService;

  constructor() {
    this.objectStorage = new ObjectStorageService();
  }

  /**
   * Check if migration should run
   */
  async shouldRunMigration(): Promise<boolean> {
    // Check environment variable
    const shouldRegenerate = process.env.REGENERATE_AVATARS === 'true';
    if (!shouldRegenerate) {
      return false;
    }

    // Check if already complete in memory (fastest)
    if (migrationComplete) {
      return false;
    }

    // Check if migration is currently running
    if (migrationInProgress) {
      return false;
    }

    // Check for completion marker in object storage
    try {
      const markerExists = await this.objectStorage.checkObjectExists(MARKER_PATH);
      if (markerExists) {
        migrationComplete = true;
        return false;
      }
    } catch (error) {
      console.log('[AvatarMigration] Error checking marker, will attempt migration:', error);
    }

    return true;
  }

  /**
   * Write completion marker to object storage
   */
  private async writeCompletionMarker(results: { success: number; failed: number }): Promise<void> {
    const marker = {
      version: MIGRATION_VERSION,
      completedAt: new Date().toISOString(),
      targetVoiceNames: TARGET_VOICE_NAMES,
      targetVoiceIds: TARGET_VOICE_IDS,
      results
    };

    const buffer = Buffer.from(JSON.stringify(marker, null, 2));
    await this.objectStorage.uploadBuffer(MARKER_PATH, buffer, 'application/json');
    migrationComplete = true;
    console.log(`[AvatarMigration] Completion marker written to ${MARKER_PATH}`);
  }

  /**
   * Regenerate avatars for target voices
   * Runs asynchronously and writes completion marker when done
   */
  async runMigration(): Promise<void> {
    if (migrationInProgress) {
      console.log('[AvatarMigration] Migration already in progress, skipping');
      return;
    }

    migrationInProgress = true;
    console.log('[AvatarMigration] Starting avatar regeneration migration...');

    let successCount = 0;
    let failCount = 0;

    try {
      // Fetch target voices from database
      const targetVoices = await db
        .select({
          id: voices.id,
          aliasName: voices.aliasName,
          gender: voices.gender,
          accent: voices.accent,
        })
        .from(voices)
        .where(eq(voices.isActive, true));

      const voicesToUpdate = targetVoices.filter(v => 
        TARGET_VOICE_NAMES.includes(v.aliasName) || TARGET_VOICE_IDS.includes(v.id)
      );

      if (voicesToUpdate.length === 0) {
        console.log('[AvatarMigration] No matching voices found');
        await this.writeCompletionMarker({ success: 0, failed: 0 });
        return;
      }

      console.log(`[AvatarMigration] Found ${voicesToUpdate.length} voices to regenerate:`, 
        voicesToUpdate.map(v => v.aliasName).join(', '));

      for (const voice of voicesToUpdate) {
        try {
          console.log(`[AvatarMigration] Regenerating avatar for ${voice.aliasName}...`);

          // Generate prompt
          const prompt = generateAvatarPrompt(voice);

          // Generate image (returns base64 data URL)
          const imageDataUrl = await generateImage(prompt);

          // Extract base64 from data URL
          const matches = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (!matches) {
            throw new Error('Invalid image data URL format');
          }

          const base64Data = matches[2];
          const buffer = Buffer.from(base64Data, 'base64');

          // Upload to object storage
          const avatarUrl = await this.objectStorage.uploadVoiceAvatar(
            voice.id,
            buffer,
            'avatar.png'
          );

          // Update database
          await db
            .update(voices)
            .set({ avatarUrl, updatedAt: new Date() })
            .where(eq(voices.id, voice.id));

          successCount++;
          console.log(`[AvatarMigration] ✅ ${voice.aliasName} complete (${successCount}/${voicesToUpdate.length})`);

          // Rate limit between generations
          if (successCount < voicesToUpdate.length) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }

        } catch (error) {
          failCount++;
          console.error(`[AvatarMigration] ❌ Failed for ${voice.aliasName}:`, 
            error instanceof Error ? error.message : error);
        }
      }

      // Write completion marker
      await this.writeCompletionMarker({ success: successCount, failed: failCount });

      console.log('[AvatarMigration] Migration complete!');
      console.log(`[AvatarMigration] Summary: ${successCount} success, ${failCount} failed`);

    } catch (error) {
      console.error('[AvatarMigration] Fatal error:', error instanceof Error ? error.message : error);
    } finally {
      migrationInProgress = false;
    }
  }

  /**
   * Trigger migration if needed (non-blocking)
   * Call this from the GET /api/voices route
   */
  async triggerMigrationIfNeeded(): Promise<void> {
    try {
      const shouldRun = await this.shouldRunMigration();
      if (shouldRun) {
        // Fire and forget - don't block the response
        this.runMigration().catch(err => {
          console.error('[AvatarMigration] Background migration error:', err);
        });
      }
    } catch (error) {
      console.error('[AvatarMigration] Error checking migration status:', error);
    }
  }
}

export const avatarRegenerationService = new AvatarRegenerationService();
