/**
 * Audio Assembler - Simple WAV concatenation and MP3 conversion
 * 
 * Clean implementation:
 * - Sample rate detection from WAV headers (no hardcoded assumptions)
 * - Validates all chunks match before concatenation
 * - Direct ffmpeg MP3 conversion
 */

import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

/**
 * WAV audio parameters extracted from header
 * Includes dataOffset for WAV files with extra metadata chunks
 */
interface WavParams {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  dataSize: number;
  dataOffset: number;  // Actual byte offset where PCM data starts
}

/**
 * Extract WAV parameters from buffer by properly parsing RIFF chunks
 * Handles WAV files with extra metadata chunks (Gemini TTS can emit these)
 * Returns null if buffer is too small or not a valid WAV
 */
function extractWavParams(wavBuffer: Buffer): WavParams | null {
  if (wavBuffer.length < 44) {
    return null;
  }
  
  // Verify RIFF header
  const riff = wavBuffer.slice(0, 4).toString('utf-8');
  const wave = wavBuffer.slice(8, 12).toString('utf-8');
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    console.warn('[AudioAssembler] Invalid WAV header - missing RIFF/WAVE markers');
    return null;
  }
  
  // Parse chunks starting after "WAVE" marker (byte 12)
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitDepth = 0;
  let dataSize = 0;
  let dataOffset = 0;
  let foundFmt = false;
  let foundData = false;
  
  while (offset < wavBuffer.length - 8) {
    // Read chunk ID (4 bytes) and chunk size (4 bytes)
    const chunkId = wavBuffer.slice(offset, offset + 4).toString('utf-8');
    const chunkSize = wavBuffer.readUInt32LE(offset + 4);
    
    if (chunkId === 'fmt ') {
      // Format chunk - read audio parameters
      if (offset + 8 + 16 <= wavBuffer.length) {
        channels = wavBuffer.readUInt16LE(offset + 10);
        sampleRate = wavBuffer.readUInt32LE(offset + 12);
        bitDepth = wavBuffer.readUInt16LE(offset + 22);
        foundFmt = true;
      }
    } else if (chunkId === 'data') {
      // Data chunk - this is where the actual PCM audio starts
      dataOffset = offset + 8;
      
      // Clamp dataSize to actual available bytes in buffer
      const availableBytes = wavBuffer.length - dataOffset;
      dataSize = chunkSize > availableBytes ? availableBytes : chunkSize;
      
      foundData = true;
      break;
    }
    
    // Move to next chunk (chunk header is 8 bytes + chunk data)
    // Chunks are word-aligned, so add padding byte if size is odd
    offset += 8 + chunkSize + (chunkSize % 2);
    
    // Safety check to prevent infinite loop on malformed files
    if (chunkSize === 0 && chunkId !== 'data') {
      break;
    }
  }
  
  if (!foundFmt || !foundData) {
    // Fallback to standard 44-byte header assumption
    return {
      sampleRate: wavBuffer.readUInt32LE(24),
      channels: wavBuffer.readUInt16LE(22),
      bitDepth: wavBuffer.readUInt16LE(34),
      dataSize: wavBuffer.length - 44,
      dataOffset: 44
    };
  }
  
  return { sampleRate, channels, bitDepth, dataSize, dataOffset };
}

/**
 * Create a standard WAV header (44 bytes)
 */
function createWavHeader(
  dataSize: number,
  sampleRate: number = 24000,
  channels: number = 1,
  bitDepth: number = 16
): Buffer {
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

/**
 * Generate silence of specified duration
 */
export function generateSilence(durationSeconds: number = 1): Buffer {
  const sampleRate = 24000;
  const channels = 1;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const dataSize = sampleRate * channels * bytesPerSample * durationSeconds;
  
  const header = createWavHeader(dataSize, sampleRate, channels, bitDepth);
  const silence = Buffer.alloc(dataSize); // Zero-filled = silence
  
  return Buffer.concat([header, silence]);
}

/**
 * Apply fade-in and fade-out to a WAV buffer to eliminate clicks at join points
 * Uses linear fade over specified duration (in milliseconds)
 * Supports 16-bit PCM audio (standard for Gemini TTS output)
 */
export function applyFades(wavBuffer: Buffer, fadeMs: number = 15): Buffer {
  if (wavBuffer.length <= 44) {
    return wavBuffer; // No PCM data to fade
  }
  
  const params = extractWavParams(wavBuffer);
  if (!params) {
    return wavBuffer;
  }
  
  const { sampleRate, channels, bitDepth, dataSize, dataOffset } = params;
  
  // Only support 16-bit PCM (standard for Gemini TTS)
  if (bitDepth !== 16) {
    console.warn(`[AudioAssembler] applyFades: Skipping non-16-bit audio (${bitDepth}-bit)`);
    return wavBuffer;
  }
  
  const bytesPerSample = 2 * channels; // 2 bytes per sample for 16-bit
  const fadeSamples = Math.floor((fadeMs / 1000) * sampleRate);
  
  // Use proper dataOffset and dataSize from chunk parsing
  const pcmData = Buffer.from(wavBuffer.slice(dataOffset, dataOffset + dataSize));
  const totalSamples = Math.floor(pcmData.length / bytesPerSample);
  
  // Don't fade if audio is too short or fade duration is invalid
  if (totalSamples < fadeSamples * 2 || fadeSamples <= 1) {
    return wavBuffer;
  }
  
  // Apply fade-in at start: gain ramps from 0 to 1
  for (let i = 0; i < fadeSamples; i++) {
    const gain = i / (fadeSamples - 1); // Reaches exactly 1.0 at last fade sample
    const offset = i * bytesPerSample;
    
    for (let ch = 0; ch < channels; ch++) {
      const sampleOffset = offset + (ch * 2);
      if (sampleOffset + 1 < pcmData.length) {
        const sample = pcmData.readInt16LE(sampleOffset);
        const fadedSample = Math.round(sample * gain);
        pcmData.writeInt16LE(Math.max(-32768, Math.min(32767, fadedSample)), sampleOffset);
      }
    }
  }
  
  // Apply fade-out at end: gain ramps from 1 to 0
  for (let i = 0; i < fadeSamples; i++) {
    const gain = (fadeSamples - 1 - i) / (fadeSamples - 1); // Starts at 1.0, reaches 0.0 at last sample
    const sampleIndex = totalSamples - fadeSamples + i;
    const offset = sampleIndex * bytesPerSample;
    
    for (let ch = 0; ch < channels; ch++) {
      const sampleOffset = offset + (ch * 2);
      if (sampleOffset + 1 < pcmData.length && sampleOffset >= 0) {
        const sample = pcmData.readInt16LE(sampleOffset);
        const fadedSample = Math.round(sample * gain);
        pcmData.writeInt16LE(Math.max(-32768, Math.min(32767, fadedSample)), sampleOffset);
      }
    }
  }
  
  // Reconstruct WAV: preserve original header + faded PCM
  const headerAndMetadata = wavBuffer.slice(0, dataOffset);
  return Buffer.concat([headerAndMetadata, pcmData]);
}

/**
 * Concatenate WAV buffers by skipping 44-byte headers
 * Validates all chunks have matching audio parameters
 * Automatically applies fades to eliminate clicks at join points
 * For large files (>50MB), uses streaming file-based approach to reduce memory
 */
export async function concatenateWavBuffers(buffers: Buffer[], autoFade: boolean = true): Promise<Buffer> {
  if (buffers.length === 0) {
    throw new Error('No audio buffers to concatenate');
  }
  
  if (buffers.length === 1) {
    console.log(`[AudioAssembler] Single buffer, returning as-is: ${buffers[0].length} bytes`);
    return buffers[0];
  }
  
  // Apply fades to all buffers to eliminate clicking sounds at join points
  let processedBuffers = buffers;
  if (autoFade) {
    console.log(`[AudioAssembler] Applying 15ms fades to ${buffers.length} buffers...`);
    processedBuffers = buffers.map(buf => applyFades(buf, 15));
  }
  
  console.log(`[AudioAssembler] Concatenating ${processedBuffers.length} WAV buffers...`);
  
  // Extract parameters from first valid buffer to use as reference
  let referenceParams: WavParams | null = null;
  let referenceIndex = -1;
  
  for (let i = 0; i < processedBuffers.length; i++) {
    const params = extractWavParams(processedBuffers[i]);
    if (params) {
      referenceParams = params;
      referenceIndex = i;
      break;
    }
  }
  
  if (!referenceParams) {
    console.error('[AudioAssembler] No valid WAV headers found in any buffer');
    throw new Error('No valid WAV headers found - cannot determine audio format');
  }
  
  console.log(`[AudioAssembler] Reference format (from chunk ${referenceIndex + 1}): ${referenceParams.sampleRate}Hz, ${referenceParams.channels}ch, ${referenceParams.bitDepth}bit`);
  
  // Parse all buffers and validate format matching
  // Store parsed params to avoid re-parsing during PCM extraction
  const bufferParams: (WavParams | null)[] = [];
  let totalPcmSize = 0;
  let mismatchWarnings: string[] = [];
  
  for (let i = 0; i < processedBuffers.length; i++) {
    const buf = processedBuffers[i];
    const params = extractWavParams(buf);
    bufferParams.push(params);
    
    if (params) {
      // Check for format mismatch (main cause of distortion)
      if (params.sampleRate !== referenceParams.sampleRate) {
        mismatchWarnings.push(`Chunk ${i + 1}: ${params.sampleRate}Hz vs reference ${referenceParams.sampleRate}Hz`);
      }
      if (params.channels !== referenceParams.channels) {
        mismatchWarnings.push(`Chunk ${i + 1}: ${params.channels}ch vs reference ${referenceParams.channels}ch`);
      }
      if (params.bitDepth !== referenceParams.bitDepth) {
        mismatchWarnings.push(`Chunk ${i + 1}: ${params.bitDepth}bit vs reference ${referenceParams.bitDepth}bit`);
      }
      // Use proper dataSize from chunk parsing
      totalPcmSize += params.dataSize;
    }
  }
  
  // Throw error on format mismatches - these cause audio speed drift/distortion
  if (mismatchWarnings.length > 0) {
    console.error(`[AudioAssembler] ❌ FORMAT MISMATCH DETECTED - ABORTING CONCATENATION:`);
    mismatchWarnings.forEach(w => console.error(`  - ${w}`));
    throw new Error(`Audio format mismatch detected: ${mismatchWarnings.join('; ')}. This would cause audio speed drift. Check TTS sample rate handling.`);
  }
  
  console.log(`[AudioAssembler] ✓ All ${processedBuffers.length} chunks have matching format (${referenceParams.sampleRate}Hz, ${referenceParams.channels}ch, ${referenceParams.bitDepth}bit)`);
  
  const totalWavSize = 44 + totalPcmSize;
  console.log(`[AudioAssembler] Total expected size: ${(totalWavSize / 1024 / 1024).toFixed(1)}MB`);
  
  // For very large files (>50MB), use file-based streaming
  if (totalWavSize > 50 * 1024 * 1024) {
    console.log(`[AudioAssembler] Large file detected, using streaming concatenation...`);
    return await concatenateWavBuffersStreaming(processedBuffers, bufferParams, totalPcmSize, referenceParams);
  }
  
  // Standard in-memory concatenation using proper dataOffset from chunk parsing
  const pcmChunks: Buffer[] = [];
  for (let i = 0; i < processedBuffers.length; i++) {
    const buf = processedBuffers[i];
    const params = bufferParams[i];
    
    if (params && params.dataSize > 0) {
      // Use proper dataOffset/dataSize from WAV chunk parsing
      const pcm = buf.slice(params.dataOffset, params.dataOffset + params.dataSize);
      pcmChunks.push(pcm);
      const offsetInfo = params.dataOffset !== 44 ? ` [dataOffset=${params.dataOffset}]` : '';
      console.log(`[AudioAssembler] Chunk ${i + 1}: ${buf.length} → ${pcm.length} bytes PCM${offsetInfo}`);
    }
  }
  
  // Use detected sample rate instead of hardcoded 24000Hz
  const header = createWavHeader(totalPcmSize, referenceParams.sampleRate, referenceParams.channels, referenceParams.bitDepth);
  const finalWav = Buffer.concat([header, ...pcmChunks]);
  
  console.log(`[AudioAssembler] Final WAV: ${finalWav.length} bytes (44 header + ${totalPcmSize} PCM) @ ${referenceParams.sampleRate}Hz`);
  return finalWav;
}

/**
 * Stream-based concatenation for large WAV files
 * Writes directly to disk to reduce memory pressure
 * Uses pre-parsed buffer params for proper dataOffset handling
 */
async function concatenateWavBuffersStreaming(
  buffers: Buffer[], 
  bufferParams: (WavParams | null)[], 
  totalPcmSize: number, 
  params: WavParams
): Promise<Buffer> {
  const timestamp = Date.now();
  const tempWavPath = path.join(os.tmpdir(), `concat_${timestamp}.wav`);
  
  try {
    // Write header using detected parameters instead of hardcoded values
    const header = createWavHeader(totalPcmSize, params.sampleRate, params.channels, params.bitDepth);
    await fs.writeFile(tempWavPath, header);
    
    // Append each chunk's PCM data using proper dataOffset
    let processedChunks = 0;
    let processedBytes = 0;
    
    for (let i = 0; i < buffers.length; i++) {
      const buf = buffers[i];
      const bufParams = bufferParams[i];
      
      if (bufParams && bufParams.dataSize > 0) {
        // Use proper dataOffset/dataSize from WAV chunk parsing
        const pcm = buf.slice(bufParams.dataOffset, bufParams.dataOffset + bufParams.dataSize);
        await fs.appendFile(tempWavPath, pcm);
        processedChunks++;
        processedBytes += pcm.length;
        
        // Log progress every 20 chunks
        if (processedChunks % 20 === 0) {
          console.log(`[AudioAssembler] Streaming progress: ${processedChunks}/${buffers.length} chunks, ${(processedBytes / 1024 / 1024).toFixed(1)}MB`);
        }
      }
    }
    
    // Read back the complete file
    const finalWav = await fs.readFile(tempWavPath);
    console.log(`[AudioAssembler] Streaming complete: ${finalWav.length} bytes (${(finalWav.length / 1024 / 1024).toFixed(1)}MB)`);
    
    return finalWav;
    
  } finally {
    // Cleanup temp file
    try { await fs.unlink(tempWavPath); } catch { /* ignore */ }
  }
}

/**
 * Convert WAV to MP3 using ffmpeg
 * Reads sample rate from WAV header instead of assuming fixed rate
 */
export async function convertWavToMp3(wavBuffer: Buffer): Promise<Buffer> {
  const timestamp = Date.now();
  const tempWavPath = path.join(os.tmpdir(), `podcast_${timestamp}.wav`);
  const tempMp3Path = path.join(os.tmpdir(), `podcast_${timestamp}.mp3`);
  
  // Extract actual sample rate from WAV header
  const wavParams = extractWavParams(wavBuffer);
  const sampleRate = wavParams?.sampleRate || 24000;
  const channels = wavParams?.channels || 1;
  
  try {
    await fs.writeFile(tempWavPath, wavBuffer);
    console.log(`[AudioAssembler] Converting WAV (${wavBuffer.length} bytes, ${sampleRate}Hz, ${channels}ch) to MP3...`);
    
    // CRITICAL FIX: Let ffmpeg auto-detect sample rate and channels from WAV header
    // Explicitly setting audioFrequency/audioChannels was causing progressive speed drift
    // The working test-simple-tts.ts script uses raw ffmpeg without explicit settings
    await new Promise<void>((resolve, reject) => {
      ffmpeg(tempWavPath)
        .audioCodec('libmp3lame')
        .audioBitrate('192k')
        .on('error', (error: Error) => {
          console.error('[AudioAssembler] FFmpeg error:', error.message);
          reject(new Error(`FFmpeg failed: ${error.message}`));
        })
        .on('end', () => resolve())
        .save(tempMp3Path);
    });
    
    const mp3Buffer = await fs.readFile(tempMp3Path);
    console.log(`[AudioAssembler] MP3 created: ${mp3Buffer.length} bytes @ ${sampleRate}Hz`);
    return mp3Buffer;
    
  } finally {
    try { await fs.unlink(tempWavPath); } catch { /* ignore */ }
    try { await fs.unlink(tempMp3Path); } catch { /* ignore */ }
  }
}

/**
 * Mix a speech MP3 with a music MP3 clip.
 * - Plays a short music intro (first `introSecs` seconds, fades out over `fadeSecs`)
 * - Speech follows immediately
 * - Plays a short music outro (last `outroSecs` seconds, fades in over `fadeSecs`)
 *
 * Both music intro and outro are taken from the same clip buffer.
 * The output is a new MP3 buffer.
 *
 * Non-fatal: if ffmpeg fails for any reason, returns speechMp3 unchanged.
 */
/**
 * Probe an audio file to get its duration in seconds.
 * Returns 0 on error so callers can proceed gracefully.
 */
async function probeAudioDuration(filePath: string): Promise<number> {
  return new Promise<number>((resolve) => {
    (ffmpeg as any).ffprobe(filePath, (err: Error | null, metadata: any) => {
      if (err || !metadata?.format?.duration) {
        resolve(0);
        return;
      }
      resolve(Number(metadata.format.duration));
    });
  });
}

/**
 * Mix a Lyria 3 music bed under a speech MP3.
 *
 * Strategy:
 *   - Music loops to cover the full output duration
 *   - Full volume intro (0 → introSecs) with a smooth ramp-down at the end
 *   - Ducked bed under speech (~15% volume) with smooth ramp-up/down at both transitions
 *   - Full volume outro (speechEnd → speechEnd + outroSecs) with a smooth ramp-up at start
 *   - Speech is delayed by introSecs and mixed on top of the looped music bed
 *
 * Non-fatal: returns speechMp3 unchanged if FFmpeg fails.
 */
export async function mixMusicBed(
  speechMp3: Buffer,
  musicMp3: Buffer,
  options: { introSecs?: number; outroSecs?: number; fadeSecs?: number; bedVolume?: number } = {}
): Promise<{ buffer: Buffer; durationSeconds: number }> {
  const introSecs = options.introSecs ?? 8;
  const outroSecs = options.outroSecs ?? 8;
  const fadeSecs = options.fadeSecs ?? 1;
  const bedVolume = options.bedVolume ?? 0.15; // 15% volume under speech

  const timestamp = Date.now();
  const tmpDir = os.tmpdir();
  const speechPath = path.join(tmpDir, `speech_${timestamp}.mp3`);
  const musicPath = path.join(tmpDir, `music_${timestamp}.mp3`);
  const outPath = path.join(tmpDir, `mixed_${timestamp}.mp3`);

  // Hoist speechDuration so the catch block can always reference it safely
  let speechDuration = 0;

  try {
    await fs.writeFile(speechPath, speechMp3);
    await fs.writeFile(musicPath, musicMp3);

    // Probe speech duration so we can time the ducking envelope precisely
    speechDuration = await probeAudioDuration(speechPath);
    if (speechDuration <= 0) {
      console.warn('[AudioAssembler/mixMusicBed] Could not probe speech duration — returning speech-only');
      return { buffer: speechMp3, durationSeconds: 0 };
    }

    const totalDuration = introSecs + speechDuration + outroSecs;
    const introMs = Math.round(introSecs * 1000);

    // Volume automation key times
    // ss:  start of fade-down (ramp from 1.0 → bedVolume)
    // se:  start of fade-up   (ramp from bedVolume → 1.0)
    // se2: end   of fade-up
    const ss = Math.max(0, introSecs - fadeSecs);
    const se = introSecs + speechDuration;
    const se2 = Math.min(se + fadeSecs, totalDuration);
    const bv = bedVolume;

    // FFmpeg volume expression evaluated per-frame:
    //   [0, ss)           → 1.0   (full-volume intro)
    //   [ss, introSecs)   → ramp down  1.0 → bv
    //   [introSecs, se)   → bv    (ducked under speech)
    //   [se, se2)         → ramp up    bv → 1.0
    //   [se2, totalDur]   → 1.0   (full-volume outro)
    const rampDown = fadeSecs > 0
      ? `1-(1-${bv})*(t-${ss})/${fadeSecs}`
      : `${bv}`;
    const rampUp = fadeSecs > 0
      ? `${bv}+(1-${bv})*(t-${se})/${fadeSecs}`
      : '1';
    const volExpr = `if(lt(t,${ss}),1,if(lt(t,${introSecs}),${rampDown},if(lt(t,${se}),${bv},if(lt(t,${se2}),${rampUp},1))))`;

    // Filter complex:
    //   [0:a] = music.mp3  →  loop infinitely → trim to totalDuration → apply volume envelope → [music_bed]
    //   [1:a] = speech.mp3 →  delay by introMs → pad to totalDuration → [speech_shifted]
    //   Mix both → [out]
    const filterComplex = [
      `[0:a]aloop=loop=-1:size=2147483647,atrim=0:${totalDuration.toFixed(3)},asetpts=PTS-STARTPTS,volume='${volExpr}':eval=frame[music_bed]`,
      `[1:a]adelay=${introMs}|${introMs},apad=whole_dur=${totalDuration.toFixed(3)},asetpts=PTS-STARTPTS[speech_shifted]`,
      `[music_bed][speech_shifted]amix=inputs=2:duration=first:normalize=0[out]`,
    ].join(';');

    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(musicPath)
        .input(speechPath)
        .complexFilter(filterComplex)
        .outputOptions(['-map', '[out]', '-codec:a', 'libmp3lame', '-b:a', '192k'])
        .on('error', (err: Error) => {
          console.error('[AudioAssembler/mixMusicBed] FFmpeg error:', err.message);
          reject(err);
        })
        .on('end', () => resolve())
        .save(outPath);
    });

    const mixed = await fs.readFile(outPath);
    console.log(`[AudioAssembler/mixMusicBed] Mixed audio: ${mixed.length} bytes (speech: ${speechDuration.toFixed(1)}s, total: ${totalDuration.toFixed(1)}s)`);
    return { buffer: mixed, durationSeconds: totalDuration };
  } catch (err) {
    console.error('[AudioAssembler/mixMusicBed] Mixing failed, returning speech-only:', err);
    return { buffer: speechMp3, durationSeconds: speechDuration };
  } finally {
    for (const p of [speechPath, musicPath, outPath]) {
      try { await fs.unlink(p); } catch { /* ignore */ }
    }
  }
}

/**
 * Calculate WAV duration in seconds
 * Uses proper chunk parsing to handle WAVs with extra metadata
 */
export function getWavDuration(wavBuffer: Buffer): number {
  if (wavBuffer.length < 44) return 0;
  
  // Use proper WAV chunk parsing
  const params = extractWavParams(wavBuffer);
  if (!params) return 0;
  
  const { sampleRate, channels, bitDepth, dataSize } = params;
  
  const bytesPerSample = (bitDepth / 8) * channels;
  if (bytesPerSample <= 0 || sampleRate <= 0) return 0;
  
  const numSamples = dataSize / bytesPerSample;
  
  return numSamples / sampleRate;
}
