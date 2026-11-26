/**
 * Voice Synchronization Utility
 * Ensures voices table contains ONLY the 30 curated Gemini voices on startup
 * Performs a complete reset to guarantee production matches development
 * Also generates avatars for any voices missing them
 */

import { db } from '../db';
import { voices, voiceFavorites } from '@shared/schema';
import { getAllCuratedVoices } from './curatedVoices';
import { eq, notInArray, sql, isNull, or, like } from 'drizzle-orm';
import { generateImage } from '../gemini';
import { ObjectStorageService } from '../objectStorage';
import * as fs from 'fs';
import * as path from 'path';

const SPECIAL_AVATARS: Record<string, { imagePath: string; googleVoiceName?: string }> = {
  'Morpheus': { imagePath: 'attached_assets/morpheus_avatar.png' },
  'Victor': { imagePath: 'attached_assets/victor_avatar.png', googleVoiceName: 'algieba' },
};

export async function syncVoicesOnStartup(): Promise<void> {
  try {
    const curatedVoices = getAllCuratedVoices();
    const validVoiceNames = curatedVoices.map(v => v.googleVoiceName);
    
    console.log(`🔄 Voice sync starting: ensuring exactly ${curatedVoices.length} Gemini voices...`);
    
    // Step 1: Delete any voices NOT in our curated list
    const deletedVoices = await db
      .delete(voices)
      .where(notInArray(voices.googleVoiceName, validVoiceNames))
      .returning({ id: voices.id, name: voices.googleVoiceName });
    
    if (deletedVoices.length > 0) {
      console.log(`   🗑️  Removed ${deletedVoices.length} outdated voices`);
    }
    
    // Step 2: Upsert all curated voices (update existing, add missing)
    let updated = 0;
    let added = 0;

    for (const curatedVoice of curatedVoices) {
      const existing = await db
        .select()
        .from(voices)
        .where(eq(voices.googleVoiceName, curatedVoice.googleVoiceName))
        .limit(1);

      if (existing.length > 0) {
        const voice = existing[0];
        // Always update to ensure consistency
        await db
          .update(voices)
          .set({
            aliasName: curatedVoice.aliasName,
            displayName: curatedVoice.displayName,
            description: curatedVoice.description,
            accent: curatedVoice.accent,
            gender: curatedVoice.gender,
            modelType: curatedVoice.modelType,
            tier: curatedVoice.tier,
            category: curatedVoice.category,
            toneArchetype: curatedVoice.toneArchetype || null,
            sortOrder: curatedVoice.sortOrder,
            calibratedWps: curatedVoice.calibratedWps || null,
            calibratedAt: curatedVoice.calibratedWps ? new Date() : null,
            isActive: true,
            updatedAt: new Date(),
          })
          .where(eq(voices.id, voice.id));
        updated++;
      } else {
        // Add new voice
        await db.insert(voices).values({
          googleVoiceName: curatedVoice.googleVoiceName,
          displayName: curatedVoice.displayName,
          aliasName: curatedVoice.aliasName,
          description: curatedVoice.description,
          accent: curatedVoice.accent,
          gender: curatedVoice.gender,
          modelType: curatedVoice.modelType,
          tier: curatedVoice.tier,
          category: curatedVoice.category,
          toneArchetype: curatedVoice.toneArchetype || null,
          sortOrder: curatedVoice.sortOrder,
          calibratedWps: curatedVoice.calibratedWps || null,
          calibratedAt: curatedVoice.calibratedWps ? new Date() : null,
          isActive: true,
        });
        added++;
      }
    }

    // Step 3: Report results
    const totalVoices = await db.select({ count: sql<number>`count(*)` }).from(voices);
    console.log(`✅ Voice sync complete:`);
    console.log(`   📊 Total voices: ${totalVoices[0]?.count || 0}`);
    if (deletedVoices.length > 0) console.log(`   🗑️  Deleted: ${deletedVoices.length} old voices`);
    if (added > 0) console.log(`   ➕ Added: ${added} new voices`);
    if (updated > 0) console.log(`   🔄 Updated: ${updated} existing voices`);
    
    // Step 4: Migrate base64 avatars to object storage (async, non-blocking)
    migrateBase64Avatars().catch(err => {
      console.warn('⚠️  Avatar migration warning:', err instanceof Error ? err.message : err);
    });
    
    // Step 5: Update special avatars (Morpheus with custom image)
    updateSpecialAvatars().catch(err => {
      console.warn('⚠️  Special avatar update warning:', err instanceof Error ? err.message : err);
    });
    
    // Step 6: Generate avatars for voices without them (async, non-blocking)
    generateMissingAvatars().catch(err => {
      console.warn('⚠️  Avatar generation warning:', err instanceof Error ? err.message : err);
    });
    
  } catch (error) {
    console.error('⚠️  Warning: Voice synchronization failed (non-critical):', error instanceof Error ? error.message : error);
    // Don't crash the server if sync fails
  }
}

/**
 * Migrate base64 avatars to object storage for better performance
 * This runs on every startup to ensure production/dev consistency
 */
async function migrateBase64Avatars(): Promise<void> {
  try {
    const objectStorage = new ObjectStorageService();
    
    // Find voices with base64 avatars (start with "data:")
    const voicesWithBase64 = await db
      .select({
        id: voices.id,
        aliasName: voices.aliasName,
        avatarUrl: voices.avatarUrl,
      })
      .from(voices)
      .where(like(voices.avatarUrl, 'data:%'));
    
    if (voicesWithBase64.length === 0) {
      return; // No migration needed
    }
    
    console.log(`🔄 Migrating ${voicesWithBase64.length} base64 avatars to object storage...`);
    
    let successCount = 0;
    
    for (const voice of voicesWithBase64) {
      try {
        if (!voice.avatarUrl || !voice.avatarUrl.startsWith('data:')) {
          continue;
        }
        
        // Extract base64 data from data URL
        const matches = voice.avatarUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (!matches) {
          continue;
        }
        
        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, 'base64');
        
        // Upload to object storage
        const publicUrl = await objectStorage.uploadVoiceAvatar(
          voice.id,
          buffer,
          'avatar.png'
        );
        
        // Update database with new URL
        await db
          .update(voices)
          .set({ avatarUrl: publicUrl, updatedAt: new Date() })
          .where(eq(voices.id, voice.id));
        
        successCount++;
        console.log(`   ✅ ${voice.aliasName} → ${publicUrl}`);
        
      } catch (error) {
        console.error(`   ❌ Failed for ${voice.aliasName}:`, error instanceof Error ? error.message : error);
      }
    }
    
    if (successCount > 0) {
      console.log(`📦 Migrated ${successCount} avatars to object storage`);
    }
  } catch (error) {
    // Silently handle object storage errors (may not be configured)
    console.warn('⚠️  Object storage not available for avatar migration');
  }
}

/**
 * Update avatars for voices with special custom images (e.g., Morpheus)
 */
async function updateSpecialAvatars(): Promise<void> {
  const objectStorage = new ObjectStorageService();
  
  for (const [aliasName, config] of Object.entries(SPECIAL_AVATARS)) {
    try {
      const fullPath = path.resolve(process.cwd(), config.imagePath);
      
      if (!fs.existsSync(fullPath)) {
        console.warn(`⚠️  Special avatar not found: ${config.imagePath}`);
        continue;
      }
      
      // Query by googleVoiceName if specified, otherwise by aliasName
      let voice;
      if (config.googleVoiceName) {
        voice = await db
          .select({ id: voices.id, aliasName: voices.aliasName })
          .from(voices)
          .where(eq(voices.googleVoiceName, config.googleVoiceName))
          .limit(1);
      } else {
        voice = await db
          .select({ id: voices.id, aliasName: voices.aliasName })
          .from(voices)
          .where(eq(voices.aliasName, aliasName))
          .limit(1);
      }
      
      if (voice.length === 0) {
        console.warn(`⚠️  Voice not found for special avatar: ${aliasName}`);
        continue;
      }
      
      const imageBuffer = fs.readFileSync(fullPath);
      const publicUrl = await objectStorage.uploadVoiceAvatar(
        voice[0].id,
        imageBuffer,
        'avatar.png'
      );
      
      await db
        .update(voices)
        .set({ avatarUrl: publicUrl, updatedAt: new Date() })
        .where(eq(voices.id, voice[0].id));
      
      console.log(`🎭 ${aliasName} special avatar uploaded: ${publicUrl}`);
    } catch (error) {
      console.error(`❌ Failed to update special avatar for ${aliasName}:`, error instanceof Error ? error.message : error);
    }
  }
}

/**
 * Generate avatars for voices that don't have them
 * Uploads directly to object storage for performance
 */
async function generateMissingAvatars(): Promise<void> {
  // Find voices without avatars (null, empty, or no URL)
  const voicesWithoutAvatars = await db
    .select({
      id: voices.id,
      googleVoiceName: voices.googleVoiceName,
      aliasName: voices.aliasName,
      gender: voices.gender,
      accent: voices.accent,
    })
    .from(voices)
    .where(or(isNull(voices.avatarUrl), sql`${voices.avatarUrl} = ''`));
  
  if (voicesWithoutAvatars.length === 0) {
    console.log(`🖼️  All voices have avatars`);
    return;
  }
  
  console.log(`🖼️  Generating avatars for ${voicesWithoutAvatars.length} voices...`);
  
  let objectStorage: ObjectStorageService | null = null;
  try {
    objectStorage = new ObjectStorageService();
  } catch (error) {
    console.warn('⚠️  Object storage not available, will use base64 (slower)');
  }
  
  let successCount = 0;
  
  for (const voice of voicesWithoutAvatars) {
    try {
      // Create detailed prompt for realistic portrait
      const prompt = generateAvatarPrompt(voice);
      
      // Generate image using Gemini (returns base64 data URL)
      const imageDataUrl = await generateImage(prompt);
      
      let avatarUrl = imageDataUrl;
      
      // Try to upload to object storage for better performance
      if (objectStorage && imageDataUrl.startsWith('data:')) {
        try {
          const matches = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (matches) {
            const buffer = Buffer.from(matches[2], 'base64');
            avatarUrl = await objectStorage.uploadVoiceAvatar(voice.id, buffer, 'avatar.png');
          }
        } catch (uploadError) {
          // Fall back to base64 if upload fails
          console.warn(`   ⚠️  Upload failed for ${voice.aliasName}, using base64`);
        }
      }
      
      // Store in database
      await db
        .update(voices)
        .set({ avatarUrl, updatedAt: new Date() })
        .where(eq(voices.id, voice.id));
      
      successCount++;
      console.log(`   ✅ ${voice.aliasName} (${successCount}/${voicesWithoutAvatars.length})`);
      
      // Rate limiting: wait 2 seconds between generations
      if (successCount < voicesWithoutAvatars.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error) {
      console.error(`   ❌ Failed for ${voice.aliasName}:`, error instanceof Error ? error.message : error);
    }
  }
  
  console.log(`🎨 Avatar generation complete: ${successCount}/${voicesWithoutAvatars.length}`);
}

/**
 * Generate a detailed prompt for creating a realistic portrait
 */
function generateAvatarPrompt(voice: { aliasName: string; gender: string; accent: string }): string {
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
