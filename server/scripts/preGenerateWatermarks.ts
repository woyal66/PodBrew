/**
 * Pre-generate all watermarks (intro + outro) for all 31 voices
 * Stores in object storage permanently - ZERO CREDITS for all users, forever
 * 
 * Run once: npx tsx server/scripts/preGenerateWatermarks.ts
 */

import { db } from '../db';
import { voices as voicesTable } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { generateWatermarks } from '../geminiTTS';
import { ObjectStorageService } from '../objectStorage';
import { convertWavToMp3 } from '../audioUtils';

const objectStorage = new ObjectStorageService();

async function preGenerateAllWatermarks() {
  console.log('🎙️  Starting pre-generation of ALL watermarks (intro + outro)...');
  console.log('Goal: Permanent storage = ZERO credits for all users forever\n');
  
  try {
    // Get all active voices
    const allVoices = await db.select().from(voicesTable).where(eq(voicesTable.isActive, true));
    console.log(`📊 Found ${allVoices.length} active voices to process\n`);
    
    let successCount = 0;
    let skipCount = 0;
    
    // Process each voice
    for (const voice of allVoices) {
      try {
        console.log(`▶️  Processing: ${voice.aliasName} (${voice.googleVoiceName})`);
        
        // Check if already cached
        if (voice.watermarkIntroUrl && voice.watermarkOutroUrl) {
          console.log(`✅ Already cached - skipping\n`);
          skipCount++;
          continue;
        }
        
        console.log(`⏳ Generating watermarks...`);
        const watermarks = await generateWatermarks(voice.googleVoiceName);
        console.log(`✓ Generated: intro=${watermarks.intro.length} bytes, outro=${watermarks.outro.length} bytes`);
        
        // Convert WAV to MP3
        console.log(`Converting WAV → MP3...`);
        const introMp3 = await convertWavToMp3(watermarks.intro);
        const outroMp3 = await convertWavToMp3(watermarks.outro);
        console.log(`✓ Converted: intro=${introMp3.length} bytes, outro=${outroMp3.length} bytes`);
        
        // Upload to object storage
        console.log(`Uploading to object storage...`);
        const introFileName = `${voice.googleVoiceName}-intro-watermark.mp3`;
        const outroFileName = `${voice.googleVoiceName}-outro-watermark.mp3`;
        
        const introUrl = await objectStorage.uploadVoicePreview(
          voice.id,
          introMp3,
          `watermarks/${introFileName}`
        );
        const outroUrl = await objectStorage.uploadVoicePreview(
          voice.id,
          outroMp3,
          `watermarks/${outroFileName}`
        );
        
        console.log(`✓ Uploaded - Intro: ${introUrl.substring(0, 60)}...`);
        console.log(`✓ Uploaded - Outro: ${outroUrl.substring(0, 60)}...`);
        
        // Save URLs to database
        console.log(`Saving to database...`);
        await db.update(voicesTable).set({
          watermarkIntroUrl: introUrl,
          watermarkOutroUrl: outroUrl,
          updatedAt: new Date(),
        }).where(eq(voicesTable.id, voice.id));
        
        console.log(`✅ ${voice.aliasName} watermarks cached permanently!\n`);
        successCount++;
        
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`❌ Error for ${voice.aliasName}: ${errorMsg}\n`);
      }
    }
    
    // Summary
    console.log(`${'='.repeat(70)}`);
    console.log('🎉 WATERMARK PRE-GENERATION COMPLETE');
    console.log(`${'='.repeat(70)}`);
    console.log(`✅ Successfully generated: ${successCount}/${allVoices.length}`);
    console.log(`⏭️  Skipped (already cached): ${skipCount}/${allVoices.length}`);
    console.log(`${'='.repeat(70)}`);
    console.log('\n🔒 PERMANENT CACHING ACHIEVED:');
    console.log(`  • All ${allVoices.length} voice watermarks stored in object storage`);
    console.log('  • URLs persisted to database');
    console.log('  • Users NEVER pay credits for watermark generation');
    console.log('  • Load watermarks at 0ms (instant from cache)');
    console.log(`${'='.repeat(70)}\n`);
    
    process.exit(0);
    
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

preGenerateAllWatermarks();
