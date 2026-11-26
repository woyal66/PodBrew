import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Target audio format for concatenation (must match Gemini TTS output)
const TARGET_SAMPLE_RATE = 24000;
const TARGET_CHANNELS = 1;
const TARGET_BIT_DEPTH = 16;

/**
 * Extended WAV header info including data chunk location
 * This properly handles WAV files with extra metadata chunks (fact, LIST, INFO, etc.)
 */
export interface WavHeaderInfo {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  dataSize: number;
  dataOffset: number;  // Actual byte offset where PCM data starts
  valid: boolean;
  extraChunks?: string[];  // Names of extra chunks found (for debugging)
}

/**
 * Read WAV header parameters from a buffer by properly parsing RIFF chunks
 * 
 * CRITICAL FIX: Gemini TTS occasionally outputs WAV files with extra metadata chunks
 * (fact, LIST, INFO, etc.) before the 'data' chunk. The old code assumed data always
 * started at byte 44, which caused audio corruption when extra chunks were present.
 * 
 * This function now properly iterates through RIFF chunks to find the actual 'data'
 * chunk location, preventing the ~4-minute audio quality degradation cycles.
 * 
 * @param buffer - WAV file buffer
 * @returns WAV header info including correct data offset
 */
export function readWavHeader(buffer: Buffer): WavHeaderInfo {
  const invalidResult: WavHeaderInfo = { 
    sampleRate: 0, channels: 0, bitDepth: 0, dataSize: 0, dataOffset: 0, valid: false 
  };
  
  if (buffer.length < 44) {
    console.warn(`[Audio] WAV buffer too small: ${buffer.length} bytes`);
    return invalidResult;
  }
  
  // Verify RIFF/WAVE header
  const riffHeader = buffer.slice(0, 4).toString('utf-8');
  const waveFormat = buffer.slice(8, 12).toString('utf-8');
  
  if (riffHeader !== 'RIFF' || waveFormat !== 'WAVE') {
    console.warn(`[Audio] Invalid WAV header: RIFF="${riffHeader}", WAVE="${waveFormat}"`);
    return invalidResult;
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
  const extraChunks: string[] = [];
  
  while (offset < buffer.length - 8) {
    // Read chunk ID (4 bytes) and chunk size (4 bytes)
    const chunkId = buffer.slice(offset, offset + 4).toString('utf-8');
    const chunkSize = buffer.readUInt32LE(offset + 4);
    
    if (chunkId === 'fmt ') {
      // Format chunk - read audio parameters
      if (offset + 8 + 16 <= buffer.length) {
        channels = buffer.readUInt16LE(offset + 10);
        sampleRate = buffer.readUInt32LE(offset + 12);
        bitDepth = buffer.readUInt16LE(offset + 22);
        foundFmt = true;
      }
    } else if (chunkId === 'data') {
      // Data chunk - this is where the actual PCM audio starts
      dataOffset = offset + 8;  // PCM data starts after chunk ID + size
      
      // CRITICAL: Clamp dataSize to actual available bytes in buffer
      // Gemini TTS can emit inconsistent metadata where chunkSize exceeds remaining bytes
      const availableBytes = buffer.length - dataOffset;
      if (chunkSize > availableBytes) {
        console.warn(`[Audio] ⚠️ WAV data chunk size (${chunkSize}) exceeds available bytes (${availableBytes}), clamping to actual size`);
        dataSize = Math.max(0, availableBytes);
      } else {
        dataSize = chunkSize;
      }
      
      foundData = true;
      break;  // Stop searching once we find data chunk
    } else {
      // Track extra chunks for debugging (fact, LIST, INFO, etc.)
      extraChunks.push(`${chunkId}(${chunkSize})`);
    }
    
    // Move to next chunk (chunk header is 8 bytes + chunk data)
    // Chunks are word-aligned, so add padding byte if size is odd
    offset += 8 + chunkSize + (chunkSize % 2);
    
    // Safety check to prevent infinite loop on malformed files
    if (chunkSize === 0 && chunkId !== 'data') {
      console.warn(`[Audio] Zero-size chunk "${chunkId}" at offset ${offset - 8}, stopping parse`);
      break;
    }
  }
  
  if (!foundFmt || !foundData) {
    console.warn(`[Audio] Missing required chunks: fmt=${foundFmt}, data=${foundData}`);
    return invalidResult;
  }
  
  // Log if we found extra chunks (useful for debugging the 4-minute cycle issue)
  if (extraChunks.length > 0) {
    console.log(`[Audio] Found extra WAV chunks: ${extraChunks.join(', ')} - data starts at byte ${dataOffset} (not 44)`);
  }
  
  return { 
    sampleRate, 
    channels, 
    bitDepth, 
    dataSize, 
    dataOffset,
    valid: true,
    extraChunks: extraChunks.length > 0 ? extraChunks : undefined
  };
}

/**
 * Resample WAV buffer to target format using ffmpeg
 * Converts to 24kHz, mono, 16-bit PCM
 * @exported for use in GeminiTTSv2 validateAndNormalizeWav
 */
export async function resampleWavToTarget(wavBuffer: Buffer, segmentIndex: number = 0): Promise<Buffer> {
  const timestamp = Date.now();
  const tempInputPath = path.join(os.tmpdir(), `resample_in_${timestamp}_${segmentIndex}.wav`);
  const tempOutputPath = path.join(os.tmpdir(), `resample_out_${timestamp}_${segmentIndex}.wav`);
  
  try {
    await fs.writeFile(tempInputPath, wavBuffer);
    
    await new Promise<void>((resolve, reject) => {
      ffmpeg(tempInputPath)
        .audioCodec('pcm_s16le')
        .audioFrequency(TARGET_SAMPLE_RATE)
        .audioChannels(TARGET_CHANNELS)
        .on('error', (error: Error) => {
          console.error(`[Audio] Resample error for segment ${segmentIndex}:`, error.message);
          reject(new Error(`Resample failed: ${error.message}`));
        })
        .on('end', () => {
          resolve();
        })
        .save(tempOutputPath);
    });
    
    const resampledBuffer = await fs.readFile(tempOutputPath);
    console.log(`[Audio] Resampled segment ${segmentIndex}: ${wavBuffer.length} → ${resampledBuffer.length} bytes`);
    return resampledBuffer;
  } finally {
    try { await fs.unlink(tempInputPath); } catch (e) { /* ignore */ }
    try { await fs.unlink(tempOutputPath); } catch (e) { /* ignore */ }
  }
}

/**
 * Simple WAV header creation (matches simple test approach)
 */
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

/**
 * Apply fade-in and fade-out to a WAV buffer to eliminate clicks at join points
 * Uses linear fade over specified duration (in milliseconds)
 * Supports 16-bit PCM audio (standard for Gemini TTS output)
 * Properly handles WAV files with extra metadata chunks
 */
function applyFadesInternal(wavBuffer: Buffer, fadeMs: number = 15): Buffer {
  if (wavBuffer.length <= 44) {
    return wavBuffer; // Too small to be a valid WAV
  }
  
  // Use proper WAV header parsing to handle extra metadata chunks
  const header = readWavHeader(wavBuffer);
  if (!header.valid) {
    return wavBuffer; // Invalid WAV, return unchanged
  }
  
  const { sampleRate, channels, bitDepth, dataSize, dataOffset } = header;
  
  // Only support 16-bit PCM (standard for Gemini TTS)
  if (bitDepth !== 16) {
    return wavBuffer;
  }
  
  const bytesPerSample = 2 * channels;
  const fadeSamples = Math.floor((fadeMs / 1000) * sampleRate);
  
  // Extract actual PCM data using correct offset
  const pcmData = Buffer.from(wavBuffer.slice(dataOffset, dataOffset + dataSize));
  const totalSamples = Math.floor(pcmData.length / bytesPerSample);
  
  // Don't fade if audio is too short or fade duration is invalid
  if (totalSamples < fadeSamples * 2 || fadeSamples <= 1) {
    return wavBuffer;
  }
  
  // Apply fade-in at start
  for (let i = 0; i < fadeSamples; i++) {
    const gain = i / (fadeSamples - 1);
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
  
  // Apply fade-out at end
  for (let i = 0; i < fadeSamples; i++) {
    const gain = (fadeSamples - 1 - i) / (fadeSamples - 1);
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
  
  // Reconstruct WAV: header bytes + faded PCM (preserve original header/metadata)
  const headerAndMetadata = wavBuffer.slice(0, dataOffset);
  return Buffer.concat([headerAndMetadata, pcmData]);
}

/**
 * Simple concatenation of WAV buffers with proper chunk parsing
 * Handles WAV files with extra metadata chunks (Gemini TTS can emit these)
 * Automatically applies fades to eliminate clicks at join points
 * 
 * @param audioBuffers - Array of WAV audio buffers to concatenate (in order)
 * @param autoFade - Whether to apply fades at chunk boundaries (default: true)
 * @returns Buffer containing properly formatted WAV file (24kHz, mono, 16-bit)
 */
export async function concatenateAudioBuffers(audioBuffers: Buffer[], autoFade: boolean = true): Promise<Buffer> {
  if (audioBuffers.length === 0) {
    throw new Error('No audio buffers provided');
  }
  
  if (audioBuffers.length === 1) {
    console.log(`[Audio] Single segment, returning as-is: ${audioBuffers[0].length} bytes`);
    return audioBuffers[0];
  }
  
  // Apply fades to all buffers to eliminate clicking sounds
  let processedBuffers = audioBuffers;
  if (autoFade) {
    console.log(`[Audio] Applying 15ms fades to ${audioBuffers.length} buffers...`);
    processedBuffers = audioBuffers.map(buf => applyFadesInternal(buf, 15));
  }
  
  console.log(`[Audio] Concatenating ${processedBuffers.length} WAV buffers with proper chunk parsing...`);
  
  // Extract PCM data from each buffer using proper WAV header parsing
  const pcmChunks: Buffer[] = [];
  for (let i = 0; i < processedBuffers.length; i++) {
    const buf = processedBuffers[i];
    const header = readWavHeader(buf);
    
    if (header.valid && header.dataOffset > 0 && header.dataSize > 0) {
      // Use proper data offset/size from WAV chunk parsing
      const pcm = buf.slice(header.dataOffset, header.dataOffset + header.dataSize);
      pcmChunks.push(pcm);
      const offsetInfo = header.dataOffset !== 44 ? ` [dataOffset=${header.dataOffset}]` : '';
      console.log(`[Audio] Segment ${i}: ${buf.length} bytes → ${pcm.length} bytes PCM${offsetInfo}`);
    } else if (buf.length > 44) {
      // Fallback to 44-byte skip for invalid headers
      const pcm = buf.slice(44);
      pcmChunks.push(pcm);
      console.log(`[Audio] Segment ${i}: ${buf.length} bytes → ${pcm.length} bytes PCM (fallback)`);
    }
  }
  
  const totalPcmSize = pcmChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const header = createWavHeader(totalPcmSize);
  
  const finalWav = Buffer.concat([header, ...pcmChunks]);
  console.log(`[Audio] Created final WAV: ${finalWav.length} bytes (header: 44 + PCM: ${totalPcmSize})`);
  
  return finalWav;
}

/**
 * Adds intro and outro watermarks to a podcast audio buffer
 * 
 * @param podcastAudio - Main podcast audio buffer
 * @param introWatermark - Intro watermark audio buffer
 * @param outroWatermark - Outro watermark audio buffer
 * @returns Buffer with watermarks added at start and end
 */
export async function addWatermarksToPodcast(
  podcastAudio: Buffer,
  introWatermark: Buffer,
  outroWatermark: Buffer
): Promise<Buffer> {
  return concatenateAudioBuffers([
    introWatermark,
    podcastAudio,
    outroWatermark,
  ]);
}

/**
 * Calculate audio duration in seconds from WAV buffer
 * Uses proper chunk parsing to handle WAV files with extra metadata chunks
 * This is precise and doesn't require external tools
 * @param wavBuffer - WAV audio buffer
 * @returns Duration in seconds
 */
export function calculateWavDuration(wavBuffer: Buffer): number {
  try {
    // Use proper chunk parsing to get accurate data size
    const header = readWavHeader(wavBuffer);
    
    if (!header.valid) {
      console.warn('[Audio] WAV buffer has invalid header, cannot calculate duration');
      return 0;
    }
    
    const bytesPerSample = header.bitDepth / 8;
    const blockAlign = header.channels * bytesPerSample;
    
    // Calculate duration using properly parsed data size
    const numSamples = header.dataSize / blockAlign;
    const durationSeconds = numSamples / header.sampleRate;
    
    const offsetInfo = header.dataOffset !== 44 ? ` [dataOffset=${header.dataOffset}]` : '';
    console.log(`[Audio] WAV header: ${header.sampleRate}Hz, ${header.channels}ch, ${header.bitDepth}-bit${offsetInfo}`);
    console.log(`[Audio] Calculated WAV duration: ${durationSeconds.toFixed(2)}s (${header.dataSize} bytes of PCM data, ${numSamples} samples @ ${header.sampleRate}Hz)`);
    
    return durationSeconds;
  } catch (error) {
    console.error('[Audio] Error calculating WAV duration:', error);
    return 0;
  }
}

/**
 * Get actual audio duration in seconds from MP3 buffer using ffprobe
 * @param mp3Buffer - MP3 audio buffer
 * @returns Promise with duration in seconds
 */
export async function getAudioDuration(mp3Buffer: Buffer): Promise<number> {
  return new Promise((resolve, reject) => {
    const tempFile = path.join(os.tmpdir(), `duration_${Date.now()}.mp3`);
    
    fs.writeFile(tempFile, mp3Buffer)
      .then(() => {
        ffmpeg.ffprobe(tempFile, async (err, metadata) => {
          try {
            await fs.unlink(tempFile);
          } catch (e) {
            // Ignore cleanup errors
          }
          
          if (err) {
            console.error('[Audio] ffprobe error:', err.message);
            reject(new Error(`Failed to get audio duration: ${err.message}`));
            return;
          }
          
          const duration = metadata?.format?.duration || 0;
          console.log(`[Audio] Actual audio duration: ${duration.toFixed(2)} seconds`);
          resolve(duration);
        });
      })
      .catch(reject);
  });
}

/**
 * Format duration in seconds to "MM:SS" string
 * @param seconds - Duration in seconds
 * @returns Formatted duration string
 */
export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Convert MP3 buffer to WAV format (24kHz, mono, 16-bit PCM)
 * Used for loading stored MP3 watermarks and converting back to WAV for concatenation
 * @param mp3Buffer - MP3 audio buffer
 * @returns Promise with WAV buffer
 */
export async function convertMp3ToWav(mp3Buffer: Buffer): Promise<Buffer> {
  const timestamp = Date.now();
  const tempMp3Path = path.join(os.tmpdir(), `input_${timestamp}.mp3`);
  const tempWavPath = path.join(os.tmpdir(), `output_${timestamp}.wav`);
  
  try {
    // Write MP3 to temp file
    await fs.writeFile(tempMp3Path, mp3Buffer);
    
    // Convert MP3 to WAV (24kHz, mono, 16-bit to match podcast audio format)
    await new Promise<void>((resolve, reject) => {
      ffmpeg(tempMp3Path)
        .audioCodec('pcm_s16le')    // 16-bit PCM
        .audioFrequency(24000)      // 24kHz to match TTS output
        .audioChannels(1)           // Mono
        .on('error', (error: Error) => {
          console.error('[Audio] FFmpeg MP3→WAV error:', error.message);
          reject(new Error(`FFmpeg conversion failed: ${error.message}`));
        })
        .on('end', () => {
          resolve();
        })
        .save(tempWavPath);
    });
    
    // Read the WAV file
    const wavBuffer = await fs.readFile(tempWavPath);
    console.log(`[Audio] Converted MP3 (${mp3Buffer.length} bytes) to WAV (${wavBuffer.length} bytes)`);
    
    return wavBuffer;
  } finally {
    // Clean up temp files
    try { await fs.unlink(tempMp3Path); } catch (e) { /* ignore */ }
    try { await fs.unlink(tempWavPath); } catch (e) { /* ignore */ }
  }
}

/**
 * Convert WAV buffer to MP3 using ffmpeg with reliable settings
 * Uses temp files to ensure proper duration metadata is written
 * Uses standard settings: 44.1kHz stereo, 192kbps CBR for maximum compatibility
 * @param wavBuffer - WAV audio buffer
 * @returns Promise with MP3 buffer
 */
export async function convertWavToMp3(wavBuffer: Buffer): Promise<Buffer> {
  const startTime = Date.now();
  const inputSize = wavBuffer.length;
  const timestamp = Date.now();
  const tempWavPath = path.join(os.tmpdir(), `podcast_${timestamp}.wav`);
  const tempMp3Path = path.join(os.tmpdir(), `podcast_${timestamp}.mp3`);
  
  try {
    // Write WAV to temp file
    await fs.writeFile(tempWavPath, wavBuffer);
    console.log(`[Audio] Written temp WAV: ${tempWavPath} (${inputSize} bytes)`);
    
    // Convert using temp files for proper metadata writing
    await new Promise<void>((resolve, reject) => {
      ffmpeg(tempWavPath)
        .audioCodec('libmp3lame')
        .audioFrequency(24000)     // Match Gemini TTS output (24kHz) to avoid resampling artifacts
        .audioChannels(1)          // Mono to match TTS output
        .audioBitrate('192k')      // CBR 192kbps for reliable duration
        .outputOptions([
          '-write_xing', '1',      // Write Xing header with accurate duration
        ])
        .on('start', (cmd) => {
          console.log(`[Audio] FFmpeg command: ${cmd}`);
        })
        .on('error', (error: Error) => {
          console.error('[Audio] FFmpeg error:', error.message);
          reject(new Error(`FFmpeg conversion failed: ${error.message}`));
        })
        .on('end', () => {
          console.log(`[Audio] FFmpeg conversion complete`);
          resolve();
        })
        .save(tempMp3Path);
    });
    
    // Read the MP3 file
    const mp3Buffer = await fs.readFile(tempMp3Path);
    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    const compressionRatio = (inputSize / mp3Buffer.length).toFixed(1);
    console.log(`[Audio] Converted WAV (${inputSize} bytes) to MP3 (${mp3Buffer.length} bytes) in ${elapsedSec}s (${compressionRatio}x compression)`);
    
    return mp3Buffer;
  } finally {
    // Clean up temp files
    try {
      await fs.unlink(tempWavPath);
    } catch (e) {
      // Ignore cleanup errors
    }
    try {
      await fs.unlink(tempMp3Path);
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}
