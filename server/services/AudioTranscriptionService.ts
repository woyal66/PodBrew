import OpenAI from 'openai';
import { Readable } from 'stream';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

interface TranscriptionResult {
  text: string;
  duration?: number;
  language?: string;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
  }>;
  method: 'whisper-api' | 'whisper-chunked';
}

interface TranscriptionOptions {
  language?: string;
  prompt?: string;
  responseFormat?: 'text' | 'json' | 'verbose_json' | 'srt' | 'vtt';
  temperature?: number;
}

const MAX_AUDIO_SIZE = 25 * 1024 * 1024;
const CHUNK_DURATION_MS = 10 * 60 * 1000;

class AudioTranscriptionService {
  private openai: OpenAI | null = null;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
    }
  }

  isAvailable(): boolean {
    return !!this.openai;
  }

  async transcribeFromUrl(
    audioUrl: string,
    options: TranscriptionOptions = {}
  ): Promise<TranscriptionResult> {
    if (!this.openai) {
      throw new Error('OpenAI API key not configured. Cannot transcribe audio.');
    }

    console.log(`[Whisper] Starting transcription from URL: ${audioUrl.slice(0, 100)}...`);

    try {
      const response = await fetch(audioUrl, {
        headers: { 
          'User-Agent': 'PodBrew/1.0',
          'Range': 'bytes=0-' 
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch audio: HTTP ${response.status}`);
      }

      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
      console.log(`[Whisper] Audio size: ${(contentLength / 1024 / 1024).toFixed(2)} MB`);

      if (contentLength > MAX_AUDIO_SIZE) {
        console.log(`[Whisper] Audio too large, will process in chunks`);
        return this.transcribeInChunks(audioUrl, contentLength, options);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      return this.transcribeBuffer(buffer, this.getFileExtension(audioUrl), options);

    } catch (error) {
      console.error('[Whisper] Transcription error:', error);
      throw new Error(`Transcription failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async transcribeBuffer(
    buffer: Buffer,
    fileExtension: string = 'mp3',
    options: TranscriptionOptions = {}
  ): Promise<TranscriptionResult> {
    if (!this.openai) {
      throw new Error('OpenAI API key not configured');
    }

    console.log(`[Whisper] Transcribing ${(buffer.length / 1024 / 1024).toFixed(2)} MB audio...`);

    const file = new File([buffer], `audio.${fileExtension}`, {
      type: this.getMimeType(fileExtension)
    });

    const startTime = Date.now();
    
    const transcription = await this.openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      language: options.language,
      prompt: options.prompt,
      response_format: options.responseFormat || 'verbose_json',
      temperature: options.temperature || 0,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Whisper] Transcription completed in ${elapsed}s`);

    if (typeof transcription === 'string') {
      return {
        text: transcription,
        method: 'whisper-api'
      };
    }

    const transcriptionData = transcription as any;
    
    const result: TranscriptionResult = {
      text: transcriptionData.text,
      duration: transcriptionData.duration,
      language: transcriptionData.language,
      method: 'whisper-api'
    };

    if (transcriptionData.segments && Array.isArray(transcriptionData.segments)) {
      result.segments = transcriptionData.segments.map((seg: any) => ({
        start: seg.start,
        end: seg.end,
        text: seg.text
      }));
    }

    const wordCount = result.text.split(/\s+/).length;
    console.log(`[Whisper] Result: ${wordCount} words, ${result.duration?.toFixed(0) || 'unknown'} seconds`);

    return result;
  }

  private async transcribeInChunks(
    audioUrl: string,
    totalSize: number,
    options: TranscriptionOptions
  ): Promise<TranscriptionResult> {
    console.log(`[Whisper] Processing large audio in chunks...`);
    
    const chunkSize = MAX_AUDIO_SIZE - (1024 * 1024);
    const numChunks = Math.ceil(totalSize / chunkSize);
    const transcripts: string[] = [];
    
    for (let i = 0; i < numChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize - 1, totalSize - 1);
      
      console.log(`[Whisper] Fetching chunk ${i + 1}/${numChunks} (bytes ${start}-${end})`);
      
      try {
        const response = await fetch(audioUrl, {
          headers: {
            'User-Agent': 'PodBrew/1.0',
            'Range': `bytes=${start}-${end}`
          }
        });

        if (!response.ok && response.status !== 206) {
          console.warn(`[Whisper] Chunk ${i + 1} fetch failed, skipping`);
          continue;
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        const chunkResult = await this.transcribeBuffer(
          buffer,
          this.getFileExtension(audioUrl),
          {
            ...options,
            prompt: transcripts.length > 0 
              ? transcripts[transcripts.length - 1].slice(-200)
              : options.prompt
          }
        );

        transcripts.push(chunkResult.text);
        
      } catch (error) {
        console.error(`[Whisper] Error processing chunk ${i + 1}:`, error);
      }
    }

    if (transcripts.length === 0) {
      throw new Error('Failed to transcribe any chunks of the audio');
    }

    const fullText = transcripts.join(' ').replace(/\s+/g, ' ').trim();
    console.log(`[Whisper] Chunked transcription complete: ${fullText.split(/\s+/).length} words from ${transcripts.length} chunks`);

    return {
      text: fullText,
      method: 'whisper-chunked'
    };
  }

  private getFileExtension(url: string): string {
    const urlPath = url.split('?')[0];
    const ext = urlPath.split('.').pop()?.toLowerCase();
    
    const validExtensions = ['mp3', 'mp4', 'm4a', 'wav', 'webm', 'ogg', 'flac'];
    if (ext && validExtensions.includes(ext)) {
      return ext;
    }
    
    return 'mp3';
  }

  private getMimeType(extension: string): string {
    const mimeTypes: Record<string, string> = {
      mp3: 'audio/mpeg',
      mp4: 'audio/mp4',
      m4a: 'audio/mp4',
      wav: 'audio/wav',
      webm: 'audio/webm',
      ogg: 'audio/ogg',
      flac: 'audio/flac'
    };
    
    return mimeTypes[extension] || 'audio/mpeg';
  }

  estimateCost(durationSeconds: number): number {
    return (durationSeconds / 60) * 0.006;
  }

  /**
   * Extract audio from YouTube video and transcribe using Whisper
   * Uses yt-dlp for audio extraction
   */
  async transcribeYouTubeVideo(
    videoId: string,
    options: TranscriptionOptions & { maxDurationMinutes?: number } = {}
  ): Promise<TranscriptionResult & { audioExtracted: boolean }> {
    if (!this.openai) {
      throw new Error('OpenAI API key not configured. Cannot transcribe YouTube audio.');
    }

    const { maxDurationMinutes = 60 } = options;
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `yt-audio-${videoId}-${Date.now()}`);
    const audioFile = `${tempFile}.mp3`;

    console.log(`[YouTube-Whisper] Starting audio extraction for video: ${videoId}`);
    console.log(`[YouTube-Whisper] Max duration limit: ${maxDurationMinutes} minutes`);

    try {
      // First, get video duration to check if it's within limits
      const durationCheckCmd = `yt-dlp --get-duration "${videoUrl}" 2>/dev/null`;
      let videoDuration = 0;
      
      try {
        const { stdout: durationStr } = await execAsync(durationCheckCmd, { timeout: 30000 });
        const parts = durationStr.trim().split(':').map(Number);
        if (parts.length === 3) {
          videoDuration = parts[0] * 3600 + parts[1] * 60 + parts[2];
        } else if (parts.length === 2) {
          videoDuration = parts[0] * 60 + parts[1];
        } else if (parts.length === 1) {
          videoDuration = parts[0];
        }
        console.log(`[YouTube-Whisper] Video duration: ${Math.floor(videoDuration / 60)}:${(videoDuration % 60).toString().padStart(2, '0')}`);
      } catch (durationError) {
        console.log(`[YouTube-Whisper] Could not get duration, proceeding with extraction...`);
      }

      // Check duration limit
      if (videoDuration > 0 && videoDuration > maxDurationMinutes * 60) {
        throw new Error(`Video duration (${Math.floor(videoDuration / 60)} min) exceeds maximum limit (${maxDurationMinutes} min)`);
      }

      // Extract audio using yt-dlp with best audio quality, convert to mp3
      // -x: extract audio only
      // --audio-format mp3: convert to mp3
      // --audio-quality 0: best quality
      // -o: output file template
      const extractCmd = `yt-dlp -x --audio-format mp3 --audio-quality 0 -o "${tempFile}.%(ext)s" "${videoUrl}" 2>&1`;
      
      console.log(`[YouTube-Whisper] Extracting audio with yt-dlp...`);
      const startExtract = Date.now();
      
      const { stdout, stderr } = await execAsync(extractCmd, { 
        timeout: 300000, // 5 minute timeout for extraction
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer for output
      });

      const extractTime = ((Date.now() - startExtract) / 1000).toFixed(1);
      console.log(`[YouTube-Whisper] Audio extraction completed in ${extractTime}s`);

      // Check if file exists
      if (!fs.existsSync(audioFile)) {
        // Try to find any extracted file
        const files = fs.readdirSync(tempDir).filter(f => f.startsWith(`yt-audio-${videoId}`));
        if (files.length > 0) {
          const foundFile = path.join(tempDir, files[0]);
          console.log(`[YouTube-Whisper] Found extracted file: ${foundFile}`);
          fs.renameSync(foundFile, audioFile);
        } else {
          throw new Error('Audio extraction failed - no output file created');
        }
      }

      // Get file size
      const stats = fs.statSync(audioFile);
      const fileSizeMB = stats.size / (1024 * 1024);
      console.log(`[YouTube-Whisper] Extracted audio file: ${fileSizeMB.toFixed(2)} MB`);

      // Read the audio file
      const audioBuffer = fs.readFileSync(audioFile);

      // Transcribe with Whisper
      console.log(`[YouTube-Whisper] Starting Whisper transcription...`);
      const transcription = await this.transcribeBuffer(audioBuffer, 'mp3', {
        language: options.language,
        prompt: options.prompt,
        responseFormat: 'verbose_json',
        temperature: options.temperature
      });

      // Cleanup temp file
      try {
        fs.unlinkSync(audioFile);
        console.log(`[YouTube-Whisper] Cleaned up temp file`);
      } catch (cleanupError) {
        console.log(`[YouTube-Whisper] Warning: Could not delete temp file`);
      }

      console.log(`[YouTube-Whisper] ✅ Complete: ${transcription.text.split(/\s+/).length} words transcribed`);

      return {
        ...transcription,
        audioExtracted: true,
        duration: transcription.duration || videoDuration
      };

    } catch (error) {
      // Cleanup on error
      try {
        if (fs.existsSync(audioFile)) {
          fs.unlinkSync(audioFile);
        }
      } catch {}

      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[YouTube-Whisper] ❌ Failed: ${errorMessage}`);
      
      // Check for common yt-dlp errors
      if (errorMessage.includes('Video unavailable') || errorMessage.includes('Private video')) {
        throw new Error('YouTube video is unavailable or private');
      }
      if (errorMessage.includes('Sign in to confirm')) {
        throw new Error('YouTube video requires age verification or sign-in');
      }
      if (errorMessage.includes('exceeds maximum limit')) {
        throw error;
      }
      
      throw new Error(`YouTube audio extraction failed: ${errorMessage}`);
    }
  }

  /**
   * Check if yt-dlp is available
   */
  async isYtDlpAvailable(): Promise<boolean> {
    try {
      await execAsync('which yt-dlp', { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}

export const audioTranscriptionService = new AudioTranscriptionService();
export type { TranscriptionResult, TranscriptionOptions };
