/**
 * Generate Emotion Demo Podcast
 * Creates a podcast demonstrating all vocal effects and emotion tags
 * Uses ttsAdapter for multi-key fallback support
 * 
 * Run with: npx tsx server/scripts/generateEmotionDemo.ts
 */

import { db } from '../db';
import { generatedPodcasts, voices as voicesTable } from '@shared/schema';
import { synthesizeText } from '../podcast/ttsAdapter';
import { concatenateWavBuffers, convertWavToMp3 } from '../podcast/audioAssembler';
import { ObjectStorageService } from '../objectStorage';
import { generateImage } from '../gemini';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';

// Helper to wait
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function generateEmotionDemoPodcast() {
  console.log('\n=== EMOTION DEMO PODCAST GENERATOR ===\n');
  console.log('Note: Generating with 7-second delays to avoid rate limits.\n');
  
  // Get a voice from database
  const voiceResult = await db.select().from(voicesTable).where(eq(voicesTable.isActive, true)).limit(1);
  if (!voiceResult.length) {
    throw new Error('No active voices found in database');
  }
  const voice = voiceResult[0];
  console.log(`Using voice: ${voice.aliasName} (${voice.googleVoiceName})`);

  // Demo script with all the emotion tags user wants to test
  const emotionDemoScript = {
    segments: [
      // Intro
      { speaker: voice.aliasName!, text: "Welcome to the emotion demo podcast. I'll be demonstrating various vocal effects and emotions.", emotion: "neutral", speakerIndex: 0 },
      
      // LAUGH
      { speaker: voice.aliasName!, text: "[laugh] Ha ha ha! That joke was absolutely hilarious! I can't stop laughing!", emotion: "laugh", speakerIndex: 0 },
      
      // CHUCKLE
      { speaker: voice.aliasName!, text: "[chuckle] Heh, that's pretty amusing. A little chuckle never hurt anyone.", emotion: "chuckle", speakerIndex: 0 },
      
      // SIGH
      { speaker: voice.aliasName!, text: "[sigh] Well, that's just how things go sometimes. Life can be exhausting.", emotion: "sigh", speakerIndex: 0 },
      
      // GASP
      { speaker: voice.aliasName!, text: "[gasp] Oh my goodness! I can't believe what I'm seeing! This is incredible!", emotion: "gasp", speakerIndex: 0 },
      
      // BREATH
      { speaker: voice.aliasName!, text: "[breath] Taking a deep breath... Okay, let me compose myself here.", emotion: "breath", speakerIndex: 0 },
      
      // FRUSTRATED (maps to angry)
      { speaker: voice.aliasName!, text: "This is so frustrating! Why won't this work the way it's supposed to?!", emotion: "frustrated", speakerIndex: 0 },
      
      // IRRITATED (maps to angry)
      { speaker: voice.aliasName!, text: "I'm getting really irritated with all these interruptions. Can we please focus?", emotion: "irritated", speakerIndex: 0 },
      
      // MOCKING
      { speaker: voice.aliasName!, text: "Oh sure, because THAT was such a brilliant idea. Really genius level thinking there.", emotion: "mocking", speakerIndex: 0 },
      
      // IRONIC (maps to sarcastic)
      { speaker: voice.aliasName!, text: "Oh how wonderful, another meeting that could have been an email. My favorite.", emotion: "ironic", speakerIndex: 0 },
      
      // WITTY
      { speaker: voice.aliasName!, text: "You know, they say money can't buy happiness, but it can buy podcasts, which is pretty close.", emotion: "witty", speakerIndex: 0 },
      
      // Outro
      { speaker: voice.aliasName!, text: "And that concludes our emotion demo. Hope you enjoyed the range of vocal expressions!", emotion: "cheerful", speakerIndex: 0 },
    ]
  };

  console.log(`\nGenerating ${emotionDemoScript.segments.length} audio segments...\n`);

  const audioBuffers: Buffer[] = [];
  let i = 0;
  
  while (i < emotionDemoScript.segments.length) {
    const segment = emotionDemoScript.segments[i];
    console.log(`[${i + 1}/${emotionDemoScript.segments.length}] Generating: "${segment.emotion}" emotion`);
    console.log(`   Text: "${segment.text.substring(0, 60)}..."`);
    
    try {
      // Add emotion marker to text if not already present
      const textWithEmotion = segment.text.startsWith('[') ? segment.text : `[${segment.emotion}] ${segment.text}`;
      
      // synthesizeText returns array of WAV buffers (from chunks), concatenate them
      const wavBufferChunks = await synthesizeText(textWithEmotion, voice.googleVoiceName!);
      const combinedSegmentWav = await concatenateWavBuffers(wavBufferChunks);
      audioBuffers.push(combinedSegmentWav);
      console.log(`   ✓ Generated ${(combinedSegmentWav.length / 1024).toFixed(1)} KB`);
      
      // Wait 7 seconds between requests to avoid rate limits (10 req/min limit)
      if (i < emotionDemoScript.segments.length - 1) {
        console.log(`   Waiting 7s to avoid rate limit...`);
        await sleep(7000);
      }
      i++; // Move to next segment
    } catch (error: any) {
      // If rate limited, wait and retry
      if (error?.message?.includes('429') || error?.status === 429) {
        console.log(`   Rate limited. Waiting 60s and retrying...`);
        await sleep(60000);
        // Don't increment i, retry same segment
        continue;
      }
      console.error(`   ✗ Error generating segment:`, error);
      throw error;
    }
  }

  // Concatenate all audio
  console.log('\nConcatenating audio segments...');
  const combinedWav = await concatenateWavBuffers(audioBuffers);
  
  // Convert to MP3
  console.log('Converting to MP3...');
  const mp3Buffer = await convertWavToMp3(combinedWav);
  console.log(`Final MP3 size: ${(mp3Buffer.length / 1024 / 1024).toFixed(2)} MB`);

  // Upload to object storage
  console.log('Uploading to object storage...');
  const podcastId = nanoid();
  const audioFilename = `${podcastId}/audio.mp3`;
  
  const objectStorage = new ObjectStorageService();
  const audioUrl = await objectStorage.uploadAudioFile(mp3Buffer, audioFilename);
  console.log(`Audio uploaded: ${audioUrl}`);

  // Generate cover art
  console.log('Generating cover art...');
  let coverArtUrl: string | undefined;
  try {
    const coverArtDataUrl = await generateImage('Podcast cover art for an emotion demonstration showcase, featuring abstract colorful sound waves representing different emotions like joy, anger, surprise, and calm. Modern minimalist design with vibrant gradient colors.');
    if (coverArtDataUrl) {
      // Extract base64 data from data URL and convert to Buffer
      const base64Data = coverArtDataUrl.split(',')[1];
      const coverArtBuffer = Buffer.from(base64Data, 'base64');
      const coverFilename = `${podcastId}/cover.png`;
      coverArtUrl = await objectStorage.uploadImageFile(coverArtBuffer, coverFilename);
      console.log(`Cover art uploaded: ${coverArtUrl}`);
    }
  } catch (e) {
    console.log('Cover art generation failed, continuing without it');
  }

  // Calculate duration (rough estimate based on text length)
  const totalChars = emotionDemoScript.segments.reduce((sum, s) => sum + s.text.length, 0);
  const estimatedSeconds = Math.ceil(totalChars / 15); // ~15 chars/second speaking rate
  const durationStr = `${Math.floor(estimatedSeconds / 60)}:${(estimatedSeconds % 60).toString().padStart(2, '0')}`;

  // Save to database
  console.log('Saving to database...');
  const [savedPodcast] = await db.insert(generatedPodcasts).values({
    userId: 'dev-user-001',
    topic: 'Emotion Tag Demo: Vocal Effects Showcase',
    title: 'Vocal Effects & Emotions Demo',
    description: 'Demonstration of Gemini TTS emotion capabilities: laugh, chuckle, sigh, gasp, breath, frustrated, irritated, mocking, ironic, and witty vocal expressions.',
    audioUrl,
    coverImageUrl: coverArtUrl,
    duration: durationStr,
    generationParams: emotionDemoScript as any,
    templateCategory: 'demo',
    isPublic: true,
  }).returning();

  console.log('\n=== SUCCESS ===');
  console.log(`Podcast ID: ${savedPodcast.id}`);
  console.log(`Title: ${savedPodcast.title}`);
  console.log(`Audio URL: ${savedPodcast.audioUrl}`);
  console.log(`Duration: ${durationStr}`);
  console.log('\nYou can listen to this podcast in the Library!');

  process.exit(0);
}

generateEmotionDemoPodcast().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
