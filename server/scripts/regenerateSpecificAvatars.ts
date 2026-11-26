/**
 * Manual script to regenerate and replace avatars for specific voices
 * Uses the shared AvatarRegenerationService for consistency
 * 
 * Usage: npx tsx server/scripts/regenerateSpecificAvatars.ts
 */

import { db } from '../db';
import { voices } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { generateImage } from '../gemini';
import { ObjectStorageService } from '../objectStorage';

// Target voices to regenerate
const TARGET_VOICES = [
  'Marcus',
  'Thomas', 
  'Benjamin',
  'Emma',
  'Grace'
];

interface VoiceData {
  id: string;
  aliasName: string;
  gender: string;
  accent: string;
}

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

async function regenerateSpecificAvatars() {
  console.log('🎨 Regenerating avatars for specific voices...\n');
  
  try {
    // Fetch the target voices from database
    const targetVoices = await db
      .select({
        id: voices.id,
        aliasName: voices.aliasName,
        gender: voices.gender,
        accent: voices.accent,
      })
      .from(voices)
      .where(eq(voices.isActive, true));

    const voicesToUpdate = targetVoices.filter(v => TARGET_VOICES.includes(v.aliasName));

    if (voicesToUpdate.length === 0) {
      console.log('❌ No matching voices found in database');
      process.exit(1);
    }

    console.log(`📊 Found ${voicesToUpdate.length} voices to regenerate:\n`);
    voicesToUpdate.forEach(v => console.log(`   • ${v.aliasName}`));
    console.log();

    const objectStorage = new ObjectStorageService();
    let successCount = 0;
    let failCount = 0;

    for (const voice of voicesToUpdate) {
      try {
        console.log(`\n🖼️  Regenerating avatar for ${voice.aliasName}...`);

        // Generate prompt
        const prompt = generateAvatarPrompt(voice);
        console.log(`   📝 Prompt generated`);

        // Generate image (returns base64 data URL)
        const imageDataUrl = await generateImage(prompt);
        console.log(`   ✅ Image generated (${imageDataUrl.length} bytes)`);

        // Extract base64 from data URL
        const matches = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (!matches) {
          throw new Error('Invalid image data URL format');
        }

        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, 'base64');
        console.log(`   📦 Converted to buffer (${buffer.length} bytes)`);

        // Upload to object storage
        const avatarUrl = await objectStorage.uploadVoiceAvatar(
          voice.id,
          buffer,
          'avatar.png'
        );
        console.log(`   ☁️  Uploaded to object storage`);
        console.log(`   📍 URL: ${avatarUrl}`);

        // Update database
        await db
          .update(voices)
          .set({ avatarUrl, updatedAt: new Date() })
          .where(eq(voices.id, voice.id));
        console.log(`   💾 Database updated`);

        successCount++;
        console.log(`   ✨ Success! (${successCount}/${voicesToUpdate.length})`);

        // Rate limit between generations
        if (successCount < voicesToUpdate.length) {
          console.log('   ⏳ Waiting 2s before next generation...');
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

      } catch (error) {
        failCount++;
        console.error(`   ❌ Failed:`, error instanceof Error ? error.message : error);
        console.log(`   Continuing with next voice...`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Avatar Regeneration Summary:');
    console.log(`   ✅ Success: ${successCount}/${voicesToUpdate.length}`);
    console.log(`   ❌ Failed: ${failCount}/${voicesToUpdate.length}`);
    console.log('='.repeat(60));

    if (failCount === 0) {
      console.log('\n🎉 All avatars regenerated successfully!');
      process.exit(0);
    } else {
      console.log('\n⚠️  Some avatars failed. Check logs above.');
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Fatal error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run the script
regenerateSpecificAvatars();
