/**
 * Resumable Podcast Generator - Checkpoint-based generation that survives server restarts
 * 
 * Key features:
 * - Stores progress in pending_generations table
 * - Generates script in one pass, saves to DB
 * - Synthesizes audio in small batches (5 segments at a time)
 * - Uploads intermediate chunks to object storage
 * - Resumes from last checkpoint on restart
 */

import { eq } from 'drizzle-orm';
import { db } from '../db';
import { pendingGenerations, PendingGeneration } from '@shared/schema';
import { generateScript, ScriptSegment } from './scriptBuilder';
import { synthesizeText, synthesizeMultiSpeakerDialogue, DialogueSegment, MultiSpeakerConfig, deriveSeedFromId } from './ttsAdapter';
import { concatenateWavBuffers, convertWavToMp3, generateSilence, getWavDuration } from './audioAssembler';
import { ObjectStorageService } from '../objectStorage';

// TTS batching configuration
// Each TTS call can handle up to ~4500 chars (~5 min of audio)
// We process multiple TTS calls per checkpoint for balance of speed vs restart safety
const TTS_CALLS_PER_CHECKPOINT = 3; // Number of TTS API calls per scheduler cycle
const MAX_CHARS_PER_CALL = 4500; // ~5 minutes of audio per call
// Max attempts before marking as failed
// Increased for long podcasts - 60min needs fewer batches now with optimization
const MAX_ATTEMPTS = 100;

/**
 * Represents a batched TTS call - multiple segments combined into one API call
 */
interface TTSBatch {
  voice: string;
  accent: string | null;
  text: string;
  segmentIndices: number[]; // Which original segments are included
}

export interface ResumableSettings {
  userId: string;
  topic: string;
  durationMinutes: number;
  hostVoice: string;
  hostName?: string;
  coHostVoice?: string;
  coHostName?: string;
  style?: 'conversational' | 'narrative' | 'educational';
  mood?: string;
  languageComplexity?: number;
  coHostPersonality?: string;
  language?: string;
  selectedAccents?: Record<string, string | null>;
  voiceWps?: number;
  templateCategory?: string;
  creditsCost?: number;
}

export interface GenerationJob {
  id: string;
  status: string;
  progress: number;
  totalSegments: number;
  completedSegments: number;
  title?: string;
  audioUrl?: string;
  durationSeconds?: number;
}

/**
 * Create a new generation job (called when user starts a podcast)
 */
export async function createGenerationJob(settings: ResumableSettings): Promise<string> {
  console.log('[ResumableGen] Creating new generation job...');
  
  const result = await db.insert(pendingGenerations).values({
    userId: settings.userId,
    topic: settings.topic,
    durationMinutes: settings.durationMinutes,
    templateCategory: settings.templateCategory || 'custom',
    generationParams: settings as any,
    status: 'pending',
    creditsCost: settings.creditsCost || 0,
  }).returning({ id: pendingGenerations.id });
  
  const jobId = result[0].id;
  console.log(`[ResumableGen] Created job ${jobId}`);
  return jobId;
}

/**
 * Get job status (for polling)
 */
export async function getJobStatus(jobId: string): Promise<GenerationJob | null> {
  const job = await db.select().from(pendingGenerations).where(eq(pendingGenerations.id, jobId)).limit(1);
  if (job.length === 0) return null;
  
  const j = job[0];
  return {
    id: j.id,
    status: j.status,
    progress: j.totalSegments > 0 ? (j.completedSegments / j.totalSegments) * 100 : 0,
    totalSegments: j.totalSegments,
    completedSegments: j.completedSegments,
    title: j.title || undefined,
  };
}

/**
 * Process one batch of a pending job (called by worker/scheduler)
 * Returns true if job completed, false if more work needed
 */
export async function processJobBatch(jobId: string): Promise<boolean> {
  // Load job
  const jobs = await db.select().from(pendingGenerations).where(eq(pendingGenerations.id, jobId)).limit(1);
  if (jobs.length === 0) {
    console.log(`[ResumableGen] Job ${jobId} not found`);
    return true;
  }
  
  const job = jobs[0];
  
  // Check if already complete, failed, or being processed
  if (job.status === 'complete' || job.status === 'failed') {
    console.log(`[ResumableGen] Job ${jobId} already ${job.status}`);
    return true;
  }
  
  // Check if job is currently being processed (processing status)
  if (job.status === 'processing') {
    // Check if processing has been stuck for more than 2 minutes (likely crashed)
    const stuckThreshold = 2 * 60 * 1000; // 2 minutes
    const timeSinceUpdate = Date.now() - new Date(job.updatedAt).getTime();
    if (timeSinceUpdate < stuckThreshold) {
      console.log(`[ResumableGen] Job ${jobId} is being processed, skipping`);
      return false;
    }
    console.log(`[ResumableGen] Job ${jobId} appears stuck, resuming...`);
  }
  
  // Increment attempt counter
  if (job.attempts >= MAX_ATTEMPTS) {
    await db.update(pendingGenerations).set({ status: 'failed', updatedAt: new Date() }).where(eq(pendingGenerations.id, jobId));
    console.log(`[ResumableGen] Job ${jobId} exceeded max attempts, marking failed`);
    return true;
  }
  
  // Mark as processing to prevent concurrent runs
  const previousStatus = job.status;
  await db.update(pendingGenerations).set({ 
    status: 'processing', 
    attempts: job.attempts + 1, 
    updatedAt: new Date() 
  }).where(eq(pendingGenerations.id, jobId));
  
  try {
    if (previousStatus === 'pending' || previousStatus === 'processing') {
      // Check if script already generated
      if (job.scriptSegments && (job.scriptSegments as any[]).length > 0) {
        // Script exists, continue with TTS
        return await processTTSBatch(job);
      }
      // Step 1: Generate script
      return await processScriptGeneration(job);
    } else if (previousStatus === 'script_complete' || previousStatus === 'synthesizing') {
      // Step 2: Synthesize audio in batches
      return await processTTSBatch(job);
    }
  } catch (error) {
    console.error(`[ResumableGen] Error processing job ${jobId}:`, error);
    // Revert to previous status on error so it can be retried
    await db.update(pendingGenerations).set({ 
      status: previousStatus === 'processing' ? 'pending' : previousStatus,
      updatedAt: new Date() 
    }).where(eq(pendingGenerations.id, jobId));
    return false;
  }
  
  return false;
}

/**
 * Generate script and save to DB
 */
async function processScriptGeneration(job: PendingGeneration): Promise<boolean> {
  console.log(`[ResumableGen] Generating script for job ${job.id}...`);
  
  const settings = job.generationParams as ResumableSettings;
  const isTwoHost = !!(settings.coHostVoice && settings.coHostName);
  const voiceWps = settings.voiceWps || 2.5;
  
  const script = await generateScript({
    topic: settings.topic,
    durationMinutes: job.durationMinutes,
    hostName: settings.hostName || 'Host',
    coHostName: isTwoHost ? settings.coHostName : undefined,
    style: settings.style || 'conversational',
    mood: settings.mood,
    languageComplexity: settings.languageComplexity,
    coHostPersonality: settings.coHostPersonality,
    language: settings.language,
    voiceWps
  });
  
  console.log(`[ResumableGen] Script ready: ${script.segments.length} segments, ~${script.estimatedMinutes.toFixed(1)} min`);
  
  // Save script to DB with status update
  await db.update(pendingGenerations).set({
    title: script.title,
    scriptSegments: script.segments as any,
    totalSegments: script.segments.length,
    status: 'script_complete',
    updatedAt: new Date()
  }).where(eq(pendingGenerations.id, job.id));
  
  console.log(`[ResumableGen] Script saved, job ${job.id} ready for TTS`);
  return false; // More work needed (TTS)
}

/**
 * Create optimized TTS batches from remaining segments
 * Combines consecutive same-voice segments up to MAX_CHARS_PER_CALL
 * Returns batches for the next TTS_CALLS_PER_CHECKPOINT API calls
 */
function createTTSBatches(
  segments: ScriptSegment[],
  startIndex: number,
  settings: ResumableSettings,
  hostAccent: string | null,
  coHostAccent: string | null
): { batches: TTSBatch[]; segmentsProcessed: number } {
  const isTwoHost = !!(settings.coHostVoice && settings.coHostName);
  const batches: TTSBatch[] = [];
  let currentIndex = startIndex;
  let segmentsProcessed = 0;
  
  while (batches.length < TTS_CALLS_PER_CHECKPOINT && currentIndex < segments.length) {
    const startSeg = segments[currentIndex];
    const isHost = startSeg.speaker === settings.hostName;
    const voice = isTwoHost ? (isHost ? settings.hostVoice : settings.coHostVoice!) : settings.hostVoice;
    const accent = isTwoHost ? (isHost ? hostAccent : coHostAccent) : hostAccent;
    
    // Collect consecutive segments with same voice until hitting char limit
    const batchTexts: string[] = [];
    const batchIndices: number[] = [];
    let totalChars = 0;
    
    while (currentIndex < segments.length && totalChars < MAX_CHARS_PER_CALL) {
      const seg = segments[currentIndex];
      const segIsHost = seg.speaker === settings.hostName;
      const segVoice = isTwoHost ? (segIsHost ? settings.hostVoice : settings.coHostVoice!) : settings.hostVoice;
      
      // For two-host: stop if voice changes
      if (isTwoHost && segVoice !== voice) {
        break;
      }
      
      // Check if adding this segment would exceed limit
      if (totalChars + seg.text.length > MAX_CHARS_PER_CALL && batchTexts.length > 0) {
        break;
      }
      
      batchTexts.push(seg.text);
      batchIndices.push(currentIndex);
      totalChars += seg.text.length;
      currentIndex++;
      segmentsProcessed++;
    }
    
    if (batchTexts.length > 0) {
      batches.push({
        voice,
        accent,
        text: batchTexts.join('\n\n'), // Natural paragraph breaks between segments
        segmentIndices: batchIndices
      });
    }
  }
  
  return { batches, segmentsProcessed };
}

/**
 * Process a batch of TTS segments with optimized batching
 * For 2-host podcasts: Uses multi-speaker TTS (single API call per ~8 min chunk)
 * For 1-host podcasts: Batches segments by voice (up to 4500 chars per call)
 */
async function processTTSBatch(job: PendingGeneration): Promise<boolean> {
  const settings = job.generationParams as ResumableSettings;
  const segments = job.scriptSegments as ScriptSegment[];
  
  if (!segments || segments.length === 0) {
    console.error(`[ResumableGen] No segments found for job ${job.id}`);
    await db.update(pendingGenerations).set({ status: 'failed', updatedAt: new Date() }).where(eq(pendingGenerations.id, job.id));
    return true;
  }
  
  const startIndex = job.completedSegments;
  const isTwoHost = !!(settings.coHostVoice && settings.coHostName);
  
  // Use multi-speaker synthesis for 2-host podcasts (MUCH fewer API calls)
  if (isTwoHost) {
    try {
      return await processTTSBatchMultiSpeaker(job, segments, settings, startIndex);
    } catch (error: any) {
      // Fall back to single-host batching if multi-speaker fails
      console.warn(`[ResumableGen] Multi-speaker synthesis failed, falling back to single-host batching: ${error.message}`);
      return await processTTSBatchSingleHost(job, segments, settings, startIndex);
    }
  }
  
  // Single-host path: use existing batched synthesis
  return await processTTSBatchSingleHost(job, segments, settings, startIndex);
}

/**
 * Process 2-host podcast using Gemini multi-speaker TTS
 * Makes dramatically fewer API calls by synthesizing entire dialogue chunks in one call
 */
async function processTTSBatchMultiSpeaker(
  job: PendingGeneration,
  segments: ScriptSegment[],
  settings: ResumableSettings,
  startIndex: number
): Promise<boolean> {
  const objectStorage = new ObjectStorageService();
  
  // Convert remaining segments to DialogueSegment format
  const remainingSegments = segments.slice(startIndex);
  const dialogueSegments: DialogueSegment[] = remainingSegments.map(seg => ({
    speaker: seg.speaker,
    voice: seg.speaker === settings.hostName ? settings.hostVoice : settings.coHostVoice!,
    text: seg.text
  }));
  
  // Multi-speaker config
  const config: MultiSpeakerConfig = {
    hostName: settings.hostName || 'Host',
    hostVoice: settings.hostVoice,
    coHostName: settings.coHostName || 'Co-Host',
    coHostVoice: settings.coHostVoice!,
    language: settings.language || 'en',
    template: settings.templateCategory,
  };
  
  console.log(`[ResumableGen] Using MULTI-SPEAKER TTS for 2-host podcast`);
  console.log(`[ResumableGen] Processing ${dialogueSegments.length} segments from ${startIndex + 1} to ${segments.length}`);
  
  // Synthesize entire remaining dialogue using multi-speaker TTS
  // This makes dramatically fewer API calls (one per ~8 min chunk instead of per segment)
  const wavBuffers = await synthesizeMultiSpeakerDialogue(dialogueSegments, config);
  
  // Upload each WAV buffer to object storage
  const newChunkUrls: string[] = [];
  for (let i = 0; i < wavBuffers.length; i++) {
    const chunkFilename = `pending/${job.id}/multispeaker_chunk_${(startIndex + i).toString().padStart(4, '0')}.wav`;
    const chunkUrl = await objectStorage.uploadAudioFile(wavBuffers[i], chunkFilename);
    newChunkUrls.push(chunkUrl);
    console.log(`[ResumableGen] Uploaded multi-speaker chunk ${i + 1}/${wavBuffers.length}: ${chunkUrl} (${(wavBuffers[i].length / 1024).toFixed(0)}KB)`);
  }
  
  // Append new URLs to existing list
  const existingUrls = job.audioChunkUrls || [];
  const allUrls = [...existingUrls, ...newChunkUrls];
  
  // Multi-speaker synthesis completes all remaining segments in one batch
  const newCompleted = segments.length;
  
  await db.update(pendingGenerations).set({
    completedSegments: newCompleted,
    audioChunkUrls: allUrls,
    status: 'assembling',
    updatedAt: new Date()
  }).where(eq(pendingGenerations.id, job.id));
  
  console.log(`[ResumableGen] Multi-speaker synthesis complete: ${newCompleted}/${segments.length} segments (${allUrls.length} audio chunks, ${wavBuffers.length} API calls total)`);
  
  // All TTS done, assemble final audio
  return await assembleFinalAudio(job.id, allUrls, settings);
}

/**
 * Process single-host podcast with optimized batching
 * Batches consecutive segments up to 4500 chars per API call
 */
async function processTTSBatchSingleHost(
  job: PendingGeneration,
  segments: ScriptSegment[],
  settings: ResumableSettings,
  startIndex: number
): Promise<boolean> {
  // Resolve accents
  let hostAccent: string | null = null;
  let coHostAccent: string | null = null;
  
  if (settings.selectedAccents) {
    hostAccent = settings.selectedAccents[settings.hostVoice] || settings.selectedAccents[settings.hostName || ''] || null;
    if (settings.coHostVoice) {
      coHostAccent = settings.selectedAccents[settings.coHostVoice] || settings.selectedAccents[settings.coHostName || ''] || null;
    }
  }
  
  // Create optimized batches
  const { batches, segmentsProcessed } = createTTSBatches(
    segments, startIndex, settings, hostAccent, coHostAccent
  );
  
  if (batches.length === 0) {
    console.error(`[ResumableGen] No batches created for job ${job.id}`);
    return false;
  }
  
  const endIndex = startIndex + segmentsProcessed;
  console.log(`[ResumableGen] Processing ${batches.length} TTS calls covering segments ${startIndex + 1}-${endIndex} of ${segments.length} for job ${job.id}...`);
  console.log(`[ResumableGen] Optimized: ${segmentsProcessed} segments → ${batches.length} API calls (${(segmentsProcessed / batches.length).toFixed(1)} segs/call)`);
  
  // Synthesize each batch and upload to object storage
  const objectStorage = new ObjectStorageService();
  const newChunkUrls: string[] = [];

  // Deterministic per-job seed: every batch of this podcast (including any
  // batches generated after a resume) shares the same seed so the model
  // re-initializes the same prosody trajectory, preventing drift across batches.
  const jobSeed = deriveSeedFromId(job.id);
  console.log(`[ResumableGen] Single-host job seed=${jobSeed}, template=${settings.templateCategory ?? 'default'}`);

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    const firstSeg = batch.segmentIndices[0] + 1;
    const lastSeg = batch.segmentIndices[batch.segmentIndices.length - 1] + 1;
    
    console.log(`[ResumableGen] TTS call ${batchIdx + 1}/${batches.length}: segments ${firstSeg}-${lastSeg} (${batch.text.length} chars, ${batch.segmentIndices.length} segments)`);
    
    // synthesizeText returns array of buffers, concatenate them for this batch
    const batchBuffers = await synthesizeText(batch.text, batch.voice, batch.accent, settings.language || 'en', settings.templateCategory, jobSeed);
    const batchWav = await concatenateWavBuffers(batchBuffers);
    
    // Upload batch to object storage for durability
    // Use first segment index for filename to maintain ordering
    const chunkFilename = `pending/${job.id}/chunk_${firstSeg.toString().padStart(4, '0')}.wav`;
    const chunkUrl = await objectStorage.uploadAudioFile(batchWav, chunkFilename);
    newChunkUrls.push(chunkUrl);
    
    console.log(`[ResumableGen] Uploaded batch ${batchIdx + 1}: ${chunkUrl} (${(batchWav.length / 1024).toFixed(0)}KB)`);
  }
  
  // Append new URLs to existing list
  const existingUrls = job.audioChunkUrls || [];
  const allUrls = [...existingUrls, ...newChunkUrls];
  
  // Update progress
  const newCompleted = endIndex;
  const isComplete = newCompleted >= segments.length;
  
  await db.update(pendingGenerations).set({
    completedSegments: newCompleted,
    audioChunkUrls: allUrls,
    status: isComplete ? 'assembling' : 'synthesizing',
    updatedAt: new Date()
  }).where(eq(pendingGenerations.id, job.id));
  
  console.log(`[ResumableGen] Checkpoint: ${newCompleted}/${segments.length} segments complete (${allUrls.length} audio chunks, ${batches.length} API calls this cycle)`);
  
  if (isComplete) {
    // All TTS done, assemble final audio
    return await assembleFinalAudio(job.id, allUrls, settings);
  }
  
  return false; // More batches needed
}

/**
 * Assemble final audio from chunks stored in object storage
 */
async function assembleFinalAudio(jobId: string, chunkUrls: string[], settings: ResumableSettings): Promise<boolean> {
  console.log(`[ResumableGen] Assembling final audio for job ${jobId} (${chunkUrls.length} chunks)...`);
  
  const objectStorage = new ObjectStorageService();
  const wavBuffers: Buffer[] = [];
  
  // Download all chunks from object storage
  for (let i = 0; i < chunkUrls.length; i++) {
    const url = chunkUrls[i];
    console.log(`[ResumableGen] Downloading chunk ${i + 1}/${chunkUrls.length}...`);
    
    try {
      // Extract relative path from URL (remove /public-objects/ prefix if present)
      const relativePath = url.replace(/^\/public-objects\//, '');
      const buffer = await objectStorage.downloadPublicObjectAsBuffer(relativePath);
      if (!buffer) {
        throw new Error(`Chunk not found: ${url}`);
      }
      wavBuffers.push(buffer);
    } catch (error) {
      console.error(`[ResumableGen] Failed to download chunk ${url}:`, error);
      throw new Error(`Failed to download audio chunk ${i + 1}`);
    }
  }
  
  console.log(`[ResumableGen] Loaded ${wavBuffers.length} audio chunks`);
  
  // Fades are automatically applied during concatenation to eliminate clicking sounds
  const finalWav = await concatenateWavBuffers(wavBuffers);
  const durationSeconds = getWavDuration(finalWav);
  console.log(`[ResumableGen] Final WAV: ${(finalWav.length / 1024 / 1024).toFixed(1)}MB, ${durationSeconds.toFixed(1)}s`);
  
  // Convert to MP3
  const mp3Buffer = await convertWavToMp3(finalWav);
  console.log(`[ResumableGen] MP3: ${(mp3Buffer.length / 1024 / 1024).toFixed(1)}MB`);
  
  // Upload final podcast
  const filename = `podcast_${Date.now()}.mp3`;
  const audioUrl = await objectStorage.uploadAudioFile(mp3Buffer, filename);
  console.log(`[ResumableGen] Uploaded: ${audioUrl}`);
  
  // Clean up chunk files from object storage (non-blocking)
  for (const url of chunkUrls) {
    const relativePath = url.replace(/^\/public-objects\//, '');
    objectStorage.deletePublicObject(relativePath).catch((err: Error) => {
      console.warn(`[ResumableGen] Could not delete chunk ${url}:`, err.message);
    });
  }
  
  // Mark complete - store final URL in description field temporarily (we'll use it in getCompletedJob)
  await db.update(pendingGenerations).set({
    status: 'complete',
    description: audioUrl,
    updatedAt: new Date()
  }).where(eq(pendingGenerations.id, jobId));
  
  console.log(`[ResumableGen] Job ${jobId} COMPLETE`);
  return true;
}

/**
 * Get all pending jobs that need processing
 */
export async function getPendingJobs(): Promise<PendingGeneration[]> {
  const { inArray, and, lt } = await import('drizzle-orm');
  
  // Jobs in states that need processing
  const activeStatuses = ['pending', 'script_complete', 'synthesizing', 'assembling'];
  
  // Also get stuck "processing" jobs (older than 2 minutes)
  const stuckThreshold = new Date(Date.now() - 2 * 60 * 1000);
  
  const jobs = await db.select().from(pendingGenerations)
    .where(inArray(pendingGenerations.status, activeStatuses))
    .limit(10);
  
  // Check for stuck processing jobs
  const stuckJobs = await db.select().from(pendingGenerations)
    .where(and(
      eq(pendingGenerations.status, 'processing'),
      lt(pendingGenerations.updatedAt, stuckThreshold)
    ))
    .limit(5);
  
  return [...jobs, ...stuckJobs];
}

/**
 * Resume all pending jobs (called on startup)
 */
export async function resumePendingJobs(): Promise<void> {
  console.log('[ResumableGen] Checking for pending jobs...');
  
  const pendingJobs = await getPendingJobs();
  
  if (pendingJobs.length === 0) {
    console.log('[ResumableGen] No pending jobs to resume');
    return;
  }
  
  console.log(`[ResumableGen] Found ${pendingJobs.length} pending jobs, starting processing...`);
  
  // Process each job one batch at a time
  for (const job of pendingJobs) {
    console.log(`[ResumableGen] Processing job ${job.id} (status: ${job.status}, ${job.completedSegments}/${job.totalSegments} segments)`);
    
    try {
      const done = await processJobBatch(job.id);
      if (!done) {
        console.log(`[ResumableGen] Job ${job.id} needs more processing`);
      }
    } catch (error) {
      console.error(`[ResumableGen] Error processing job ${job.id}:`, error);
    }
  }
}

/**
 * Get completed job with audio URL
 */
export async function getCompletedJob(jobId: string): Promise<{ audioUrl: string; title: string; durationSeconds: number } | null> {
  const jobs = await db.select().from(pendingGenerations).where(eq(pendingGenerations.id, jobId)).limit(1);
  if (jobs.length === 0 || jobs[0].status !== 'complete') return null;
  
  const job = jobs[0];
  return {
    audioUrl: job.description || '', // We stored the final URL in description field
    title: job.title || 'Untitled Podcast',
    durationSeconds: job.durationMinutes * 60 // Approximate
  };
}
