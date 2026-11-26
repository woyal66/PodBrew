/**
 * Voice Speed Calibration Script
 * 
 * Generates an identical 1-minute test podcast for all active voices to measure
 * the actual words-per-second (WPS) rate of each voice. Results are stored in
 * the database and used during podcast generation for accurate duration targeting.
 * 
 * Usage: npx tsx server/scripts/calibrateVoiceSpeeds.ts
 */

import { db } from '../db';
import { voices } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { synthesizeSingleSpeaker } from '../geminiTTS';
import { getAudioDuration } from '../audioUtils';

// Standard calibration script - identical for all voices
// Contains exactly 100 words for easy WPS calculation
const CALIBRATION_SCRIPT = `Welcome to this voice calibration test. This standardized passage contains exactly one hundred words and is designed to measure the speaking rate of each voice accurately. The text includes a mix of short and long sentences, common words, and natural pauses. Good morning and welcome to our program. Today we will explore various topics including technology, science, and culture. The weather today is beautiful with clear skies. Numbers like one, two, three, and four are included. Questions help vary the rhythm. What do you think about that? Finally, we conclude with a simple statement. Thank you for listening to this calibration test.`;

// Word count of the calibration script (verified manually)
const CALIBRATION_WORD_COUNT = 100;

async function calibrateVoice(voice: typeof voices.$inferSelect): Promise<{ wps: number; durationSeconds: number } | null> {
  console.log(`\n[Calibration] Testing voice: ${voice.googleVoiceName} (${voice.aliasName})`);
  
  try {
    // Synthesize the calibration script using Gemini TTS (single speaker)
    const audioBuffer = await synthesizeSingleSpeaker(
      CALIBRATION_SCRIPT,
      voice.googleVoiceName,
      'gemini-2.5-flash-preview-tts'
    );
    
    if (!audioBuffer || audioBuffer.length === 0) {
      console.error(`[Calibration] ❌ No audio returned for ${voice.googleVoiceName}`);
      return null;
    }
    
    // Convert WAV to MP3 for duration measurement (getAudioDuration expects MP3)
    const { convertWavToMp3 } = await import('../audioUtils');
    const mp3Buffer = await convertWavToMp3(audioBuffer);
    
    // Get actual audio duration from MP3
    const durationSeconds = await getAudioDuration(mp3Buffer);
    
    if (durationSeconds <= 0) {
      console.error(`[Calibration] ❌ Invalid duration for ${voice.googleVoiceName}`);
      return null;
    }
    
    // Calculate words per second
    const wps = CALIBRATION_WORD_COUNT / durationSeconds;
    const wpm = wps * 60;
    
    console.log(`[Calibration] ✅ ${voice.googleVoiceName}:`);
    console.log(`   Duration: ${durationSeconds.toFixed(2)}s`);
    console.log(`   WPS: ${wps.toFixed(3)} (${wpm.toFixed(1)} WPM)`);
    
    return { wps, durationSeconds };
  } catch (error) {
    console.error(`[Calibration] ❌ Error testing ${voice.googleVoiceName}:`, error);
    return null;
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           VOICE SPEED CALIBRATION SCRIPT                     ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║ Calibration script: ${CALIBRATION_WORD_COUNT} words                                  ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  
  // Get all active voices
  const allVoices = await db.select().from(voices).where(eq(voices.isActive, true));
  console.log(`Found ${allVoices.length} active voices to calibrate\n`);
  
  const results: Array<{
    voice: string;
    name: string;
    wps: number;
    wpm: number;
    durationSeconds: number;
  }> = [];
  
  let successCount = 0;
  let failCount = 0;
  
  // Process voices sequentially to avoid rate limiting
  for (let i = 0; i < allVoices.length; i++) {
    const voice = allVoices[i];
    console.log(`\n[${i + 1}/${allVoices.length}] Processing ${voice.aliasName}...`);
    
    const result = await calibrateVoice(voice);
    
    if (result) {
      // Store calibration results in database
      await db.update(voices)
        .set({
          calibratedWps: result.wps,
          calibratedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(voices.id, voice.id));
      
      results.push({
        voice: voice.googleVoiceName,
        name: voice.aliasName,
        wps: result.wps,
        wpm: result.wps * 60,
        durationSeconds: result.durationSeconds,
      });
      
      successCount++;
    } else {
      failCount++;
    }
    
    // Small delay between voices to avoid rate limiting
    if (i < allVoices.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  // Print summary
  console.log('\n\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                  CALIBRATION RESULTS SUMMARY                  ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║ Successful: ${successCount.toString().padStart(3)} voices                                      ║`);
  console.log(`║ Failed:     ${failCount.toString().padStart(3)} voices                                      ║`);
  console.log('╠══════════════════════════════════════════════════════════════╣');
  
  // Sort by WPM and display
  results.sort((a, b) => b.wpm - a.wpm);
  
  console.log('║ VOICE                  │ WPS    │ WPM    │ Duration          ║');
  console.log('╟────────────────────────┼────────┼────────┼───────────────────╢');
  
  for (const r of results) {
    const voiceName = r.name.substring(0, 20).padEnd(20);
    const wps = r.wps.toFixed(2).padStart(6);
    const wpm = r.wpm.toFixed(1).padStart(6);
    const duration = `${r.durationSeconds.toFixed(1)}s`.padStart(6);
    console.log(`║ ${voiceName} │ ${wps} │ ${wpm} │ ${duration}             ║`);
  }
  
  console.log('╚══════════════════════════════════════════════════════════════╝');
  
  // Calculate statistics
  if (results.length > 0) {
    const avgWpm = results.reduce((sum, r) => sum + r.wpm, 0) / results.length;
    const minWpm = Math.min(...results.map(r => r.wpm));
    const maxWpm = Math.max(...results.map(r => r.wpm));
    
    console.log(`\nStatistics:`);
    console.log(`  Average WPM: ${avgWpm.toFixed(1)}`);
    console.log(`  Min WPM:     ${minWpm.toFixed(1)}`);
    console.log(`  Max WPM:     ${maxWpm.toFixed(1)}`);
    console.log(`  Range:       ${(maxWpm - minWpm).toFixed(1)} WPM`);
    
    // Output JSON for easy import
    console.log(`\nJSON Results:`);
    console.log(JSON.stringify(results, null, 2));
  }
  
  console.log('\n✅ Calibration complete! Voice speeds are now stored in the database.');
  console.log('The generation pipeline will use these values for accurate duration targeting.');
  
  process.exit(0);
}

main().catch(err => {
  console.error('Calibration script failed:', err);
  process.exit(1);
});
