import { generateImage } from '../gemini';
import { ObjectStorageService } from '../objectStorage';
import { db } from '../db';
import { voices } from '@shared/schema';
import { eq } from 'drizzle-orm';

interface VoiceData {
  id: string;
  googleVoiceName: string;
  aliasName: string;
  gender: string;
  accent: string;
}

/**
 * Generate realistic AI face avatars for all active Gemini voices
 * Uses Gemini 2.5 Flash Image to create professional portraits matching each voice's characteristics
 */
async function generateVoiceAvatars() {
  console.log('🎨 Starting voice avatar generation for all active Gemini voices...\n');
  
  // Get all active voices
  const activeVoices = await db
    .select({
      id: voices.id,
      googleVoiceName: voices.googleVoiceName,
      aliasName: voices.aliasName,
      gender: voices.gender,
      accent: voices.accent,
    })
    .from(voices)
    .where(eq(voices.isActive, true))
    .orderBy(voices.sortOrder);

  console.log(`📊 Found ${activeVoices.length} active voices to process\n`);

  const objectStorage = new ObjectStorageService();
  let successCount = 0;
  let failCount = 0;

  for (const voice of activeVoices) {
    try {
      // Skip if avatar already exists
      const existingVoice = await db.select().from(voices).where(eq(voices.id, voice.id)).limit(1);
      if (existingVoice[0]?.avatarUrl) {
        console.log(`\n⏭️  Skipping ${voice.aliasName} (${voice.googleVoiceName}) - avatar already exists`);
        successCount++;
        continue;
      }

      console.log(`\n🖼️  Generating avatar for ${voice.aliasName} (${voice.googleVoiceName})...`);

      // Create detailed prompt for realistic portrait
      const prompt = generateAvatarPrompt(voice);
      console.log(`   Prompt: ${prompt.substring(0, 100)}...`);

      // Generate image using Gemini 2.5 Flash Image (returns base64 data URL)
      const imageDataUrl = await generateImage(prompt);
      console.log(`   ✅ Generated avatar (${imageDataUrl.length} bytes)`);

      // Store base64 data URL directly in database (embedded - no object storage needed)
      // This ensures avatars work in both development and published environments
      await db
        .update(voices)
        .set({ avatarUrl: imageDataUrl })
        .where(eq(voices.id, voice.id));
      console.log(`   💾 Database updated with embedded image data`);

      successCount++;
      console.log(`   ✨ Success! (${successCount}/${activeVoices.length})`);

      // Rate limiting: wait 2 seconds between generations to avoid API throttling
      if (successCount < activeVoices.length) {
        console.log('   ⏳ Waiting 2s before next generation...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

    } catch (error) {
      failCount++;
      console.error(`   ❌ Failed for ${voice.aliasName}:`, error instanceof Error ? error.message : error);
      console.log(`   Continuing with next voice...`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 Avatar Generation Summary:');
  console.log(`   ✅ Success: ${successCount}/${activeVoices.length}`);
  console.log(`   ❌ Failed: ${failCount}/${activeVoices.length}`);
  console.log('='.repeat(60) + '\n');

  if (failCount > 0) {
    console.log('⚠️  Some avatars failed to generate. You can re-run this script to retry failed voices.');
  } else {
    console.log('🎉 All voice avatars generated successfully!');
  }
}

/**
 * Generate a detailed prompt for creating a realistic portrait
 * that matches the voice's characteristics
 */
function generateAvatarPrompt(voice: VoiceData): string {
  const { aliasName, gender, accent } = voice;

  // Base description for professional portrait
  let prompt = `Professional headshot portrait photograph of a person named ${aliasName}, `;

  // Gender-specific descriptions
  if (gender === 'MALE') {
    prompt += 'a professional man, ';
  } else if (gender === 'FEMALE') {
    prompt += 'a professional woman, ';
  } else if (gender === 'NEUTRAL') {
    prompt += 'a professional person with androgynous features, ';
  }

  // Accent/ethnicity hints (subtle, diverse representation)
  if (accent === 'US') {
    prompt += 'American, ';
  } else if (accent === 'UK') {
    prompt += 'British, ';
  } else if (accent === 'AU') {
    prompt += 'Australian, ';
  } else if (accent === 'IN') {
    prompt += 'Indian, ';
  }

  // Professional photography style
  prompt += 'clean studio lighting, neutral gray background, ';
  prompt += 'facing camera, friendly warm smile, professional attire, ';
  prompt += 'sharp focus on face, photorealistic, high quality, ';
  prompt += 'diversity-conscious casting, natural skin tones, ';
  prompt += '30-40 years old, approachable and trustworthy expression. ';

  // Negative prompts to avoid common AI artifacts
  prompt += 'NO text, NO logos, NO watermarks, NO artificial effects, NO exaggerated features.';

  return prompt;
}

// Run the script
generateVoiceAvatars()
  .then(() => {
    console.log('✅ Voice avatar generation complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
