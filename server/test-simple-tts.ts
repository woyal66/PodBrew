/**
 * Simple TTS Test - Direct Gemini API call
 * Generates a 10-minute podcast with minimal processing
 * Outputs both WAV and MP3 for comparison
 */

import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Simple WAV header creation
function createWavHeader(dataSize: number, sampleRate: number = 24000, channels: number = 1, bitDepth: number = 16): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * (bitDepth / 8);
  const blockAlign = channels * (bitDepth / 8);

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

  return header;
}

// Simple concatenation of WAV buffers
function concatWavBuffers(buffers: Buffer[]): Buffer {
  if (buffers.length === 0) return Buffer.alloc(0);
  if (buffers.length === 1) return buffers[0];

  // Extract PCM data from each buffer (skip 44-byte header)
  const pcmChunks: Buffer[] = [];
  for (const buf of buffers) {
    if (buf.length > 44) {
      pcmChunks.push(buf.slice(44));
    }
  }

  const totalPcmSize = pcmChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const header = createWavHeader(totalPcmSize);
  
  return Buffer.concat([header, ...pcmChunks]);
}

const API_KEYS = [
  { name: 'Primary (PodBrew)', key: process.env.GOOGLE_CLOUD_API_KEY },
  { name: 'Secondary (Default Gemini)', key: process.env.GOOGLE_CLOUD_API_KEY_SECONDARY },
  { name: 'Tertiary (PodBrew Backup)', key: process.env.GOOGLE_CLOUD_API_KEY_TERTIARY },
].filter(k => k.key);

let currentKeyIndex = 0;

async function generateSimpleTTS(text: string, voiceName: string): Promise<Buffer> {
  if (API_KEYS.length === 0) {
    throw new Error('No Gemini API keys found');
  }

  let lastError: Error | null = null;

  // Try each key until one works
  for (let attempts = 0; attempts < API_KEYS.length; attempts++) {
    const keyInfo = API_KEYS[currentKeyIndex];
    const client = new GoogleGenAI({ apiKey: keyInfo.key! });

    console.log(`[SimpleTTS] Using ${keyInfo.name}, generating ${text.length} chars with voice ${voiceName}`);

    try {
      const response = await client.models.generateContent({
        model: 'gemini-2.5-flash-preview-tts',
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName,
              },
            },
          },
        },
      });

      const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      
      if (!audioData) {
        throw new Error('No audio data received');
      }

      const audioBuffer = Buffer.from(audioData, 'base64');
      const header = audioBuffer.slice(0, 4).toString('utf-8');
      
      console.log(`[SimpleTTS] Received ${audioBuffer.length} bytes, format: "${header}"`);

      // If already WAV, return as-is
      if (header === 'RIFF') {
        return audioBuffer;
      }

      // Otherwise wrap PCM with WAV header
      console.log('[SimpleTTS] Wrapping PCM with WAV header');
      const wavHeader = createWavHeader(audioBuffer.length);
      return Buffer.concat([wavHeader, audioBuffer]);
      
    } catch (error: any) {
      lastError = error;
      const errorMessage = error.message || String(error);
      
      // Check for quota/rate limit errors (429)
      if (errorMessage.includes('429') || errorMessage.includes('quota') || errorMessage.includes('RESOURCE_EXHAUSTED')) {
        console.log(`[SimpleTTS] Quota exceeded on ${keyInfo.name}, rotating to next key...`);
        currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
        continue;
      }
      
      // For other errors, throw immediately
      throw error;
    }
  }

  // All keys exhausted
  throw new Error(`All ${API_KEYS.length} API keys exhausted. Last error: ${lastError?.message}`);
}

async function main() {
  console.log('===========================================');
  console.log('Simple TTS Test - 10 Minute Podcast');
  console.log('===========================================\n');

  // Generate ~10 minutes of content (roughly 1500 words = 10 min at 150 wpm)
  const script = `
Welcome to this test podcast episode. Today we're going to explore the fascinating world of artificial intelligence and how it's changing our daily lives.

Artificial intelligence, or AI, has become one of the most transformative technologies of our time. From the smartphones in our pockets to the cars we drive, AI is everywhere, quietly making our lives easier and more connected.

Let's start by understanding what AI really means. At its core, artificial intelligence refers to computer systems designed to perform tasks that typically require human intelligence. This includes things like recognizing speech, making decisions, translating languages, and even creating art.

The history of AI dates back to the 1950s when computer scientists first began exploring the possibility of creating machines that could think. Alan Turing, often called the father of computer science, proposed a test to determine whether a machine could exhibit intelligent behavior indistinguishable from a human. This became known as the Turing Test.

Over the decades, AI has evolved dramatically. Early AI systems were based on simple rules and logic. If this, then that. But these systems were limited in what they could achieve. They couldn't learn from experience or adapt to new situations.

The real breakthrough came with machine learning. Instead of programming explicit rules, scientists began creating systems that could learn from data. Feed a machine learning algorithm thousands of pictures of cats and dogs, and it learns to tell them apart. Show it millions of sentences, and it learns the patterns of language.

Deep learning took this even further. Inspired by the structure of the human brain, deep learning uses artificial neural networks with many layers. These networks can find incredibly subtle patterns in data, enabling breakthroughs in image recognition, natural language processing, and more.

Today, we interact with AI constantly. When you ask your phone a question, AI processes your speech and generates a response. When you get a recommendation on what movie to watch next, AI analyzed your viewing history. When you unlock your phone with your face, AI is recognizing your unique features.

But AI isn't just about convenience. It's transforming entire industries. In healthcare, AI helps doctors diagnose diseases earlier and more accurately. In finance, it detects fraudulent transactions in milliseconds. In manufacturing, it optimizes production lines and predicts when machines need maintenance.

The impact on transportation is particularly exciting. Self-driving cars use AI to perceive their environment, make decisions, and navigate safely. While fully autonomous vehicles aren't everywhere yet, the technology is advancing rapidly, promising a future with fewer accidents and more efficient transportation.

AI is also revolutionizing how we create. Generative AI can write stories, compose music, create artwork, and even code software. These tools aren't replacing human creativity; they're augmenting it, giving creators new capabilities and freeing them to focus on higher-level creative decisions.

Of course, with great power comes great responsibility. The rise of AI raises important ethical questions. How do we ensure AI systems are fair and don't perpetuate biases? How do we protect privacy when AI can analyze vast amounts of personal data? Who is responsible when an AI system makes a mistake?

These are questions society is actively grappling with. Researchers are developing techniques to make AI more transparent and explainable. Policymakers are crafting regulations to govern AI use. And companies are establishing ethics boards to guide responsible AI development.

The future of AI is incredibly promising. We're likely to see AI become even more integrated into our daily lives. Smart homes that anticipate our needs. Personal AI assistants that truly understand us. Medical AI that helps us live longer, healthier lives.

But perhaps the most exciting possibility is artificial general intelligence, or AGI. Current AI systems are narrow; they excel at specific tasks but can't generalize to new domains. AGI would be a system with human-like general intelligence, capable of learning and adapting to any intellectual task.

Whether and when we achieve AGI is a topic of much debate. Some experts believe it's decades away, while others think it could happen sooner. What's clear is that the journey toward more capable AI will continue to transform our world in ways we can barely imagine.

As we conclude this episode, I want to leave you with a thought. AI is a tool, and like any tool, its impact depends on how we choose to use it. By approaching AI thoughtfully, with attention to both its potential and its risks, we can harness this technology to build a better future for everyone.

Thank you for listening to this test podcast. The quality of this audio will help us understand how our text-to-speech system performs over longer durations. We're testing whether the speed remains consistent, whether the voice quality is maintained, and whether any distortions occur during extended synthesis.

This has been a simple, direct test of the Gemini text-to-speech API, with minimal processing between the API response and the final audio file. By comparing the WAV and MP3 versions, we can determine if any issues arise from format conversion rather than the synthesis itself.

Until next time, keep exploring, keep learning, and keep embracing the incredible possibilities that technology offers us.
`.trim();

  // Split into chunks for synthesis (Gemini has limits)
  const chunkSize = 3000; // ~3000 chars per chunk
  const chunks: string[] = [];
  
  const paragraphs = script.split('\n\n');
  let currentChunk = '';
  
  for (const para of paragraphs) {
    if (currentChunk.length + para.length > chunkSize) {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = para;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + para;
    }
  }
  if (currentChunk) chunks.push(currentChunk.trim());

  console.log(`Script: ${script.length} chars, split into ${chunks.length} chunks\n`);

  const voiceName = 'Kore'; // A clear, neutral voice
  const audioBuffers: Buffer[] = [];

  for (let i = 0; i < chunks.length; i++) {
    console.log(`\nProcessing chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)...`);
    
    try {
      const buffer = await generateSimpleTTS(chunks[i], voiceName);
      audioBuffers.push(buffer);
      console.log(`Chunk ${i + 1} complete: ${buffer.length} bytes`);
      
      // Small delay between chunks to avoid rate limiting
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error: any) {
      console.error(`Error on chunk ${i + 1}: ${error.message}`);
      throw error;
    }
  }

  console.log('\n-------------------------------------------');
  console.log('Concatenating audio chunks...');

  const finalWav = concatWavBuffers(audioBuffers);
  console.log(`Final WAV size: ${finalWav.length} bytes (${(finalWav.length / 1024 / 1024).toFixed(2)} MB)`);

  // Calculate duration
  const sampleRate = 24000;
  const bytesPerSample = 2;
  const channels = 1;
  const pcmSize = finalWav.length - 44;
  const duration = pcmSize / (sampleRate * bytesPerSample * channels);
  console.log(`Duration: ${Math.floor(duration / 60)}:${Math.floor(duration % 60).toString().padStart(2, '0')}`);

  // Save WAV
  const outputDir = path.join(process.cwd(), 'test-output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const wavPath = path.join(outputDir, 'test-podcast.wav');
  const mp3Path = path.join(outputDir, 'test-podcast.mp3');

  fs.writeFileSync(wavPath, finalWav);
  console.log(`\nWAV saved to: ${wavPath}`);

  // Convert to MP3 using ffmpeg
  console.log('Converting to MP3...');
  try {
    await execAsync(`ffmpeg -y -i "${wavPath}" -codec:a libmp3lame -b:a 192k "${mp3Path}"`);
    console.log(`MP3 saved to: ${mp3Path}`);
  } catch (error: any) {
    console.error('MP3 conversion failed:', error.message);
  }

  console.log('\n===========================================');
  console.log('TEST COMPLETE');
  console.log('===========================================');
  console.log(`WAV: ${wavPath}`);
  console.log(`MP3: ${mp3Path}`);
  console.log('\nCompare both files to check for audio issues.');
}

main().catch(console.error);
