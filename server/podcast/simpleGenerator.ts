/**
 * Simple Podcast Generator - Clean orchestration module
 * 
 * Takes podcast settings → returns audio file
 * No complex caching, no queuing, no legacy dependencies
 */

import { generateScript, ScriptSegment } from './scriptBuilder';
import { synthesizeText, synthesizeMultiSpeakerDialogue, processEmotionTags, DialogueSegment, MultiSpeakerConfig } from './ttsAdapter';
import { concatenateWavBuffers, convertWavToMp3, generateSilence, getWavDuration, mixMusicBed } from './audioAssembler';
import { ObjectStorageService } from '../objectStorage';
import { getCachedWatermarks, isWatermarkCacheReady } from './watermarkCache';
import { generateMusicClip, defaultMusicStyleForTemplate, isMusicEnabled, type MusicContext } from '../services/LyriaMusic';
import type { MusicStyleId } from '@shared/schema';
import * as fs from 'fs';

/**
 * Clean text for TTS by removing square brackets, SSML tags, and angle-bracket markup.
 * Gemini 2.5 Flash TTS uses natural language for style control, not bracket tags or SSML.
 * Per Google's official docs: https://ai.google.dev/gemini-api/docs/speech-generation
 *
 * IMPORTANT: Call processEmotionTags() on the text BEFORE this function.
 * processEmotionTags() converts [laugh]→(laughs), [sigh]→(sighs) etc.
 * This function intentionally does NOT strip parenthetical content so that
 * those phonetic cues survive to Gemini TTS and produce audible vocalizations.
 *
 * CRITICAL: Square brackets and SSML can cause progressive audio speed drift.
 */
function cleanTextForTTS(text: string): string {
  let cleaned = text;
  
  // Remove ALL square bracket content - use while loop to handle nested brackets like [[nested]]
  // Regex targets innermost brackets first: [content without brackets inside]
  let prevLength = -1;
  while (prevLength !== cleaned.length) {
    prevLength = cleaned.length;
    cleaned = cleaned.replace(/\[[^\[\]]*\]/g, '');
  }
  
  // NOTE: Do NOT strip parenthetical content here.
  // Vocal-effect phonetics like (laughs), (sighs), (gasps) are converted from [laugh] etc.
  // by processEmotionTags() before this function runs. Stripping parens would destroy them.
  
  // Remove SSML break tags like <break time="1s"/> or <break time="0.5s"/>
  cleaned = cleaned.replace(/<break\s+time=["'][^"']*["']\s*\/?\s*>/gi, '');
  
  // Remove any angle bracket tags that might have slipped through
  // Use while loop for nested tags
  prevLength = -1;
  while (prevLength !== cleaned.length) {
    prevLength = cleaned.length;
    cleaned = cleaned.replace(/<[^<>]*>/g, '');
  }
  
  // Final safety: Remove any remaining square/angle bracket characters
  // NOTE: Do NOT include () here — phonetic cues like (laughs) use parens and must survive
  cleaned = cleaned.replace(/[\[\]<>]/g, '');
  
  // Clean up any resulting double spaces, multiple punctuation, or leading/trailing whitespace
  cleaned = cleaned.replace(/\s+/g, ' ');
  cleaned = cleaned.replace(/\s+([.,!?;:])/g, '$1'); // Remove space before punctuation
  cleaned = cleaned.replace(/([.,!?;:])\s*\1+/g, '$1'); // Remove duplicate punctuation
  cleaned = cleaned.trim();
  
  return cleaned;
}

export interface PodcastSettings {
  topic: string;
  durationMinutes: number;
  hostVoice: string;
  hostName?: string;
  coHostVoice?: string;
  coHostName?: string;
  style?: 'conversational' | 'narrative' | 'educational';
  includeWatermarks?: boolean;
  // Extended settings for full customization
  mood?: string;
  languageComplexity?: number;
  coHostPersonality?: string;
  language?: string;
  selectedAccents?: Record<string, string | null>;
  // Voice-calibrated WPS for accurate duration targeting
  voiceWps?: number;
  /** Podcast template (e.g. 'news', 'stories', 'teachme') — drives TTS sampling temperature */
  template?: string;
  /** Lyria 3 background music style (e.g. 'ambient', 'news', 'upbeat') */
  musicStyle?: MusicStyleId;
}

export interface GeneratedPodcast {
  title: string;
  audioUrl: string;
  durationSeconds: number;
  segments: number;
}

/**
 * Generate a complete podcast from settings
 */
export async function generatePodcast(settings: PodcastSettings): Promise<GeneratedPodcast> {
  const startTime = Date.now();
  const isTwoHost = !!(settings.coHostVoice && settings.coHostName);

  console.log('='.repeat(60));
  console.log('[PodcastGen] Starting podcast generation');
  console.log(`[PodcastGen] Topic: ${settings.topic.substring(0, 80)}...`);
  console.log(`[PodcastGen] Duration: ${settings.durationMinutes} minutes`);
  console.log(`[PodcastGen] Hosts: ${isTwoHost ? `${settings.hostName} + ${settings.coHostName}` : settings.hostName || 'Host'}`);
  console.log('='.repeat(60));

  // Step 1: Generate script with all settings
  console.log('\n[Step 1] Generating script...');
  console.log(`[Step 1] Using settings: mood=${settings.mood || 'default'}, complexity=${settings.languageComplexity || 5}, personality=${settings.coHostPersonality || 'default'}, lang=${settings.language || 'en'}`);
  
  // Use voiceWps from settings, default 2.5 WPS if not provided
  const voiceWps = settings.voiceWps || 2.5;
  console.log(`[Step 1] Voice WPS for duration targeting: ${voiceWps}`);
  
  const script = await generateScript({
    topic: settings.topic,
    durationMinutes: settings.durationMinutes,
    hostName: settings.hostName || 'Host',
    coHostName: isTwoHost ? settings.coHostName : undefined,
    style: settings.style || 'conversational',
    mood: settings.mood,
    languageComplexity: settings.languageComplexity,
    coHostPersonality: settings.coHostPersonality,
    language: settings.language,
    voiceWps
  });

  console.log(`[Step 1] Script ready: "${script.title}" - ${script.segments.length} segments, ~${script.estimatedMinutes.toFixed(1)} min`);

  // EXPORT SCRIPT TO FILE FOR DEBUGGING
  const timestamp = Date.now();
  const scriptFilePath = `/tmp/script_debug_${timestamp}.txt`;
  const scriptContent = [
    '='.repeat(80),
    `PODCAST SCRIPT DEBUG EXPORT`,
    `Generated: ${new Date().toISOString()}`,
    `Topic: ${settings.topic}`,
    `Title: ${script.title}`,
    `Duration Target: ${settings.durationMinutes} minutes`,
    `Mood: ${settings.mood || 'default'}`,
    `Hosts: ${isTwoHost ? `${settings.hostName} + ${settings.coHostName}` : settings.hostName || 'Host'}`,
    `Total Segments: ${script.segments.length}`,
    `Estimated Duration: ${script.estimatedMinutes.toFixed(1)} minutes`,
    '='.repeat(80),
    '',
    '--- RAW SCRIPT SEGMENTS (BEFORE CLEANING) ---',
    '',
    ...script.segments.map((seg, i) => `[Segment ${i + 1}] ${seg.speaker}:\n${seg.text}\n`),
    '',
    '--- CLEANED TEXT FOR TTS (AFTER CLEANING) ---',
    '',
    ...script.segments.map((seg, i) => `[Segment ${i + 1}] ${seg.speaker}:\n${cleanTextForTTS(seg.text)}\n`),
    '',
    '='.repeat(80),
    'END OF SCRIPT',
    '='.repeat(80),
  ].join('\n');
  
  fs.writeFileSync(scriptFilePath, scriptContent);
  console.log(`[Step 1] Script exported to: ${scriptFilePath}`);

  // Step 2: Synthesize audio
  console.log('\n[Step 2] Synthesizing audio...');
  
  // Log voice-to-accent mapping
  // selectedAccents keys can be voice IDs (e.g., "Kore") or voice names
  // We need to resolve accents for both hostVoice and coHostVoice
  let hostAccent: string | null = null;
  let coHostAccent: string | null = null;
  
  if (settings.selectedAccents) {
    console.log(`[Step 2] Selected accents input:`, JSON.stringify(settings.selectedAccents));
    
    // Try to find accent for host voice (try voiceId, then hostName as fallback)
    hostAccent = settings.selectedAccents[settings.hostVoice] 
                 || settings.selectedAccents[settings.hostName || ''] 
                 || null;
    
    if (settings.coHostVoice) {
      coHostAccent = settings.selectedAccents[settings.coHostVoice] 
                     || settings.selectedAccents[settings.coHostName || ''] 
                     || null;
    }
    
    console.log(`[Step 2] Resolved accents: host(${settings.hostVoice})=${hostAccent || 'none'}, coHost(${settings.coHostVoice || 'n/a'})=${coHostAccent || 'none'}`);
  }
  
  let wavBuffers: Buffer[];

  if (isTwoHost) {
    // Map segments to dialogue format with voices
    const dialogueSegments: DialogueSegment[] = script.segments.map(seg => {
      const isHost = seg.speaker === settings.hostName;
      // Convert vocal-effect tags ([laugh]→(laughs) etc.) BEFORE bracket stripping
      const { cleanText: emotionProcessed } = processEmotionTags(seg.text);
      return {
        speaker: seg.speaker,
        voice: isHost ? settings.hostVoice : settings.coHostVoice!,
        text: cleanTextForTTS(emotionProcessed),
        accent: isHost ? hostAccent : coHostAccent
      };
    });
    
    // Add watermarks AS dialogue segments (synthesized together in one API call)
    // This avoids mixing different audio formats which causes distortion
    if (settings.includeWatermarks) {
      const introSegment: DialogueSegment = {
        speaker: settings.hostName || 'Host',
        voice: settings.hostVoice,
        text: "It's brew time!",
        accent: hostAccent
      };
      const outroSegment: DialogueSegment = {
        speaker: settings.hostName || 'Host',
        voice: settings.hostVoice,
        text: "You've been listening to a PodBrew creation.",
        accent: hostAccent
      };
      dialogueSegments.unshift(introSegment);
      dialogueSegments.push(outroSegment);
      console.log('[Step 2] Watermarks included as dialogue segments (unified synthesis)');
    }
    
    // DEBUG: Log cleaned dialogue segments
    const allDialogueText = dialogueSegments.map(s => s.text).join(' ');
    console.log(`\n[DEBUG TTS INPUT] Cleaned dialogue being sent to TTS (${allDialogueText.length} chars, ${dialogueSegments.length} segments):`);
    console.log('─'.repeat(60));
    console.log(allDialogueText.substring(0, 500) + (allDialogueText.length > 500 ? '...' : ''));
    console.log('─'.repeat(60));
    
    // Verify cleaning worked
    const emotionTags = allDialogueText.match(/\[[\w]+\]/g) || [];
    const ssmlBreaks = allDialogueText.match(/<break[^>]*>/g) || [];
    if (emotionTags.length > 0 || ssmlBreaks.length > 0) {
      console.log(`[DEBUG TTS INPUT] WARNING: Still found ${emotionTags.length} emotion tags, ${ssmlBreaks.length} SSML breaks after cleaning`);
    } else {
      console.log(`[DEBUG TTS INPUT] ✓ Dialogue cleaned successfully - no tags remaining`);
    }
    
    // Use multi-speaker synthesis (1-2 API calls instead of N calls per segment)
    const multiSpeakerConfig: MultiSpeakerConfig = {
      hostName: settings.hostName || 'Host',
      hostVoice: settings.hostVoice,
      coHostName: settings.coHostName!,
      coHostVoice: settings.coHostVoice!,
      language: settings.language || 'en',
      template: settings.template,
    };
    
    console.log(`[Step 2] Using multi-speaker TTS: ${dialogueSegments.length} segments → 1-2 API calls`);
    wavBuffers = await synthesizeMultiSpeakerDialogue(dialogueSegments, multiSpeakerConfig);
    
    // Skip Step 3 watermarks for 2-host (already included above)
  } else {
    // Single host - concatenate all text and clean for TTS
    const rawText = script.segments.map(s => s.text).join(' ');
    // Convert vocal-effect tags ([laugh]→(laughs) etc.) BEFORE bracket stripping
    const { cleanText: emotionProcessed } = processEmotionTags(rawText);
    const fullText = cleanTextForTTS(emotionProcessed);
    
    // DEBUG: Log cleaned text being sent to TTS
    console.log(`\n[DEBUG TTS INPUT] Cleaned text being sent to TTS (${fullText.length} chars, cleaned from ${rawText.length}):`);
    console.log('─'.repeat(60));
    console.log(fullText.substring(0, 500) + (fullText.length > 500 ? '...' : ''));
    console.log('─'.repeat(60));
    
    // Verify cleaning worked - check for any remaining tags
    const emotionTags = fullText.match(/\[[\w]+\]/g) || [];
    const ssmlBreaks = fullText.match(/<break[^>]*>/g) || [];
    if (emotionTags.length > 0 || ssmlBreaks.length > 0) {
      console.log(`[DEBUG TTS INPUT] WARNING: Still found ${emotionTags.length} emotion tags, ${ssmlBreaks.length} SSML breaks after cleaning`);
    } else {
      console.log(`[DEBUG TTS INPUT] ✓ Text cleaned successfully - no tags remaining`);
    }
    
    wavBuffers = await synthesizeText(fullText, settings.hostVoice, hostAccent, settings.language || 'en', settings.template);
  }

  console.log(`[Step 2] Synthesized ${wavBuffers.length} audio chunks`);

  // Step 3: Add watermarks if requested (ONLY for single-host podcasts)
  // For 2-host podcasts, watermarks are already included as dialogue segments above
  if (settings.includeWatermarks && !isTwoHost) {
    console.log('\n[Step 3] Adding watermarks (single-host mode)...');
    const introSilence = generateSilence(1);
    
    // Use cached watermarks (0 TTS API calls) instead of generating each time
    const cached = await getCachedWatermarks(settings.hostVoice);
    
    // Fades are automatically applied during concatenation in Step 4
    wavBuffers = [introSilence, cached.intro, ...wavBuffers, cached.outro];
    console.log(`[Step 3] Watermarks added from cache (0 API calls)`);
  } else if (isTwoHost) {
    console.log('\n[Step 3] Skipped (watermarks already in multi-speaker synthesis)');
  }

  // Step 4: Concatenate all audio
  console.log('\n[Step 4] Assembling final audio...');
  const finalWav = await concatenateWavBuffers(wavBuffers);
  let durationSeconds = getWavDuration(finalWav);
  console.log(`[Step 4] Final WAV: ${finalWav.length} bytes, ${durationSeconds.toFixed(1)}s`);

  // Step 5: Convert to MP3
  console.log('\n[Step 5] Converting to MP3...');
  let mp3Buffer = await convertWavToMp3(finalWav);
  console.log(`[Step 5] MP3 ready: ${mp3Buffer.length} bytes`);

  // Step 5b: Mix in Lyria 3 background music (non-fatal)
  // If music is enabled and style is not explicitly 'none', apply music.
  // When musicStyle is undefined (user didn't choose), fall back to the template default.
  if (isMusicEnabled() && settings.musicStyle !== 'none') {
    // Inside this block the type is already narrowed away from 'none'
    const effectiveStyle: MusicStyleId = settings.musicStyle
      ?? defaultMusicStyleForTemplate(settings.template || 'custom');

    const musicContext: MusicContext = {
      topic: settings.topic,
      template: settings.template,
      mood: settings.mood,
    };

    console.log(`\n[Step 5b] Generating Lyria 3 music clip (style: ${effectiveStyle}, template: ${musicContext.template ?? '—'}, mood: ${musicContext.mood ?? '—'})...`);
    try {
      const musicBuffer = await generateMusicClip(effectiveStyle, musicContext);
      if (musicBuffer) {
        const { buffer: mixedBuf, durationSeconds: mixedDur } = await mixMusicBed(mp3Buffer, musicBuffer);
        mp3Buffer = mixedBuf;
        if (mixedDur > 0) durationSeconds = mixedDur;
        console.log(`[Step 5b] Music bed mixed in successfully — new duration: ${durationSeconds.toFixed(1)}s`);
      } else {
        console.log(`[Step 5b] No music buffer returned — skipping`);
      }
    } catch (err) {
      console.error('[Step 5b] Music generation/mixing failed (non-fatal):', err);
    }
  }

  // Step 6: Upload to object storage
  console.log('\n[Step 6] Uploading to storage...');
  const objectStorage = new ObjectStorageService();
  const filename = `podcast_${Date.now()}.mp3`;
  const audioUrl = await objectStorage.uploadAudioFile(mp3Buffer, filename);
  console.log(`[Step 6] Uploaded: ${audioUrl}`);

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n' + '='.repeat(60));
  console.log(`[PodcastGen] Complete in ${elapsedSec}s`);
  console.log(`[PodcastGen] Title: ${script.title}`);
  console.log(`[PodcastGen] Duration: ${durationSeconds.toFixed(1)}s`);
  console.log(`[PodcastGen] URL: ${audioUrl}`);
  console.log('='.repeat(60) + '\n');

  return {
    title: script.title,
    audioUrl,
    durationSeconds,
    segments: script.segments.length
  };
}

/**
 * Format seconds to MM:SS string
 */
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Legacy adapter - wraps new generatePodcast with old API signature
 * Maintains backward compatibility with existing routes
 * 
 * CRITICAL: This function bridges between routes.ts and the new generation pipeline
 * All user settings MUST be passed through and applied
 */
export async function generatePodcastLegacy(
  topic: string,
  durationMinutes: number = 10,
  languageComplexity: number = 5,
  numPeople: number = 2,
  podcastStyle: string = 'conversational',
  timeFrame?: string,
  coHostPersonality?: string,
  podcastMood?: string,
  language: string = 'en',
  assignedVoices?: any[],
  templateCategory: string = 'custom',
  templateSpecificParams?: Record<string, any>,
  voiceQuality: string = 'premium',
  selectedVoiceIds?: string[],
  locationEnabled?: boolean,
  locationCity?: string | null,
  skipPerplexityResearch: boolean = false,
  selectedAccents?: Record<string, string | null>,
  musicStyle?: MusicStyleId
): Promise<{ audioUrl: string; wavUrl: string; duration: string; citations: string[] }> {
  
  // ============================================================
  // VOICE EXTRACTION - Handle both object arrays and string arrays
  // Routes may pass either full voice objects OR string voice names
  // Also extract calibratedWps for accurate duration targeting
  // ============================================================
  let hostVoice = 'Kore';  // Default Gemini voice
  let hostName = 'Host';
  let hostVoiceId: string | undefined; // Database UUID for accent lookup
  let coHostVoice: string | undefined;
  let coHostName: string | undefined;
  let coHostVoiceId: string | undefined; // Database UUID for accent lookup
  let voiceWps = 2.5; // Default WPS if not available from voice object

  console.log(`[PodcastLegacy] Received settings: duration=${durationMinutes}min, numPeople=${numPeople}, style=${podcastStyle}, mood=${podcastMood}, complexity=${languageComplexity}, lang=${language}`);
  console.log(`[PodcastLegacy] Voices received:`, JSON.stringify(assignedVoices?.slice(0, 2)));
  console.log(`[PodcastLegacy] Accents received:`, JSON.stringify(selectedAccents));

  if (assignedVoices && assignedVoices.length > 0) {
    const firstVoice = assignedVoices[0];
    
    // Handle both string and object formats
    if (typeof firstVoice === 'string') {
      // Routes passed string voice names (e.g., ['Kore', 'Charon'])
      hostVoice = firstVoice;
      hostName = firstVoice; // Use voice name as host name
      
      if (numPeople >= 2 && assignedVoices.length > 1) {
        coHostVoice = assignedVoices[1];
        coHostName = assignedVoices[1];
      }
    } else {
      // Routes passed voice objects with googleVoiceId, aliasName, calibratedWps, id, etc.
      hostVoice = firstVoice.googleVoiceId || firstVoice.googleVoiceName || firstVoice.name || 'Kore';
      hostName = firstVoice.aliasName || firstVoice.displayName || firstVoice.name || 'Host';
      hostVoiceId = firstVoice.id; // Database UUID for accent lookup
      
      // Extract calibratedWps from voice object for accurate duration targeting
      if (firstVoice.calibratedWps && typeof firstVoice.calibratedWps === 'number') {
        voiceWps = firstVoice.calibratedWps;
        console.log(`[PodcastLegacy] Using calibratedWps from host voice: ${voiceWps}`);
      }
      
      if (numPeople >= 2 && assignedVoices.length > 1) {
        const secondVoice = assignedVoices[1];
        coHostVoice = secondVoice.googleVoiceId || secondVoice.googleVoiceName || secondVoice.name || 'Charon';
        coHostName = secondVoice.aliasName || secondVoice.displayName || secondVoice.name || 'Co-Host';
        coHostVoiceId = secondVoice.id; // Database UUID for accent lookup
        
        // For two-host podcasts, average the WPS if both have calibrated values
        if (secondVoice.calibratedWps && typeof secondVoice.calibratedWps === 'number') {
          const avgWps = (voiceWps + secondVoice.calibratedWps) / 2;
          console.log(`[PodcastLegacy] Averaging WPS for two hosts: (${voiceWps} + ${secondVoice.calibratedWps}) / 2 = ${avgWps.toFixed(2)}`);
          voiceWps = avgWps;
        }
      }
    }
  } else if (numPeople >= 2) {
    // Default two-host setup when no voices provided
    coHostVoice = 'Charon';
    coHostName = 'Co-Host';
  }

  // ============================================================
  // ACCENT RESOLUTION - Map database voice IDs to accents
  // selectedAccents uses database UUIDs as keys, not Gemini voice names
  // ============================================================
  let resolvedAccents: Record<string, string | null> | undefined;
  if (selectedAccents && Object.keys(selectedAccents).length > 0) {
    resolvedAccents = {};
    
    // Map by Gemini voice name for TTS lookup
    if (hostVoiceId && selectedAccents[hostVoiceId]) {
      resolvedAccents[hostVoice] = selectedAccents[hostVoiceId];
      console.log(`[PodcastLegacy] Resolved host accent: ${hostVoice} -> ${selectedAccents[hostVoiceId]}`);
    }
    if (coHostVoiceId && coHostVoice && selectedAccents[coHostVoiceId]) {
      resolvedAccents[coHostVoice] = selectedAccents[coHostVoiceId];
      console.log(`[PodcastLegacy] Resolved co-host accent: ${coHostVoice} -> ${selectedAccents[coHostVoiceId]}`);
    }
    
    // If no accents resolved, clear the object
    if (Object.keys(resolvedAccents).length === 0) {
      resolvedAccents = undefined;
      console.log(`[PodcastLegacy] No accents resolved - voice IDs may not match selectedAccents keys`);
    }
  }

  console.log(`[PodcastLegacy] Resolved voices: host=${hostVoice} (${hostName}, id=${hostVoiceId}), coHost=${coHostVoice} (${coHostName}, id=${coHostVoiceId}), voiceWps=${voiceWps}`);
  console.log(`[PodcastLegacy] Resolved accents:`, JSON.stringify(resolvedAccents));

  // ============================================================
  // STYLE MAPPING - Map user's podcastStyle to script builder styles
  // ============================================================
  let style: 'conversational' | 'narrative' | 'educational' = 'conversational';
  if (podcastStyle === 'narrative' || podcastStyle === 'stories') {
    style = 'narrative';
  } else if (podcastStyle === 'tutor' || podcastStyle === 'lecturer' || podcastStyle === 'coach' || templateCategory === 'teachme') {
    style = 'educational';
  }

  // ============================================================
  // ENHANCE TOPIC WITH TEMPLATE-SPECIFIC PARAMS
  // These provide additional context for the script generation
  // ============================================================
  let enhancedTopic = topic;
  const contextParts: string[] = [];

  if (timeFrame) {
    const timeFrameMap: Record<string, string> = {
      'past24h': 'from the past 24 hours',
      'pastWeek': 'from the past week',
      'pastMonth': 'from the past month',
      'pastYear': 'from the past year',
      'next24h': 'happening in the next 24 hours',
      'nextWeek': 'happening in the next week',
      'nextMonth': 'happening in the next month',
      'nextYear': 'happening in the next year',
      'allTime': 'covering all time'
    };
    if (timeFrameMap[timeFrame]) {
      contextParts.push(`Time focus: ${timeFrameMap[timeFrame]}`);
    }
  }

  if (templateSpecificParams) {
    // Sports template params
    if (templateSpecificParams.sportType) {
      contextParts.push(`Sport: ${templateSpecificParams.sportType}`);
    }
    if (templateSpecificParams.team) {
      contextParts.push(`Team: ${templateSpecificParams.team}`);
    }
    if (templateSpecificParams.league) {
      contextParts.push(`League: ${templateSpecificParams.league}`);
    }
    if (templateSpecificParams.format) {
      contextParts.push(`Format: ${templateSpecificParams.format}`);
    }

    // Events template params
    if (templateSpecificParams.eventName) {
      contextParts.push(`Event: ${templateSpecificParams.eventName}`);
    }
    if (templateSpecificParams.eventFormat) {
      const formatMap: Record<string, string> = {
        'recap': 'This should be an event recap/review',
        'preview': 'This should be an event preview/what to expect',
        'guide': 'This should be a guide for attendees'
      };
      if (formatMap[templateSpecificParams.eventFormat]) {
        contextParts.push(formatMap[templateSpecificParams.eventFormat]);
      }
    }
    if (templateSpecificParams.eventType) {
      contextParts.push(`Event type: ${templateSpecificParams.eventType}`);
    }
    if (templateSpecificParams.eventDate) {
      contextParts.push(`Event date: ${templateSpecificParams.eventDate}`);
    }
    if (templateSpecificParams.venue) {
      contextParts.push(`Venue: ${templateSpecificParams.venue}`);
    }

    // Story template params
    if (templateSpecificParams.storyGenre) {
      contextParts.push(`Genre: ${templateSpecificParams.storyGenre}`);
    }
  }

  if (contextParts.length > 0) {
    enhancedTopic = `${topic}\n\n[Context: ${contextParts.join('. ')}]`;
    console.log(`[PodcastLegacy] Enhanced topic with template params: ${contextParts.join(', ')}`);
  }

  // ============================================================
  // BUILD SETTINGS - Pass ALL user settings to generation
  // ============================================================
  const settings: PodcastSettings = {
    topic: enhancedTopic,
    durationMinutes,
    hostVoice,
    hostName,
    coHostVoice,
    coHostName,
    style,
    includeWatermarks: true,
    // Extended settings - MUST be passed through
    mood: podcastMood,
    languageComplexity,
    coHostPersonality,
    language,
    // Use resolvedAccents (keyed by Gemini voice name) instead of selectedAccents (keyed by DB UUID)
    selectedAccents: resolvedAccents,
    // Voice-calibrated WPS for accurate duration targeting
    voiceWps,
    // Template drives per-template TTS sampling temperature for voice consistency
    template: templateCategory,
    // Lyria 3 background music
    musicStyle,
  };

  console.log(`[PodcastLegacy] Final settings:`, {
    durationMinutes: settings.durationMinutes,
    hostVoice: settings.hostVoice,
    hostName: settings.hostName,
    coHostVoice: settings.coHostVoice,
    coHostName: settings.coHostName,
    style: settings.style,
    mood: settings.mood,
    languageComplexity: settings.languageComplexity,
    coHostPersonality: settings.coHostPersonality,
    language: settings.language,
    voiceWps: settings.voiceWps
  });

  const result = await generatePodcast(settings);

  // Return in legacy format
  return {
    audioUrl: result.audioUrl,
    wavUrl: result.audioUrl, // MP3 URL used for both
    duration: formatDuration(result.durationSeconds),
    citations: [] // New pipeline doesn't track citations (handled separately by routes)
  };
}

/**
 * Generate podcast from pre-written script (for advanced use)
 */
export async function generatePodcastFromScript(
  script: { title: string; segments: ScriptSegment[] },
  settings: Omit<PodcastSettings, 'topic' | 'durationMinutes'>
): Promise<GeneratedPodcast> {
  const isTwoHost = !!(settings.coHostVoice && settings.coHostName);

  console.log('[PodcastGen] Generating from pre-written script...');

  // Synthesize audio
  let wavBuffers: Buffer[];

  if (isTwoHost) {
    const dialogueSegments: DialogueSegment[] = script.segments.map(seg => ({
      speaker: seg.speaker,
      voice: seg.speaker === settings.hostName ? settings.hostVoice : settings.coHostVoice!,
      text: seg.text
    }));
    
    // Add watermarks AS dialogue segments (synthesized together in one API call)
    if (settings.includeWatermarks) {
      const introSegment: DialogueSegment = {
        speaker: settings.hostName || 'Host',
        voice: settings.hostVoice,
        text: "It's brew time!"
      };
      const outroSegment: DialogueSegment = {
        speaker: settings.hostName || 'Host',
        voice: settings.hostVoice,
        text: "You've been listening to a PodBrew creation."
      };
      dialogueSegments.unshift(introSegment);
      dialogueSegments.push(outroSegment);
    }
    
    // Use multi-speaker synthesis (1-2 API calls instead of N calls per segment)
    const multiSpeakerConfig: MultiSpeakerConfig = {
      hostName: settings.hostName || 'Host',
      hostVoice: settings.hostVoice,
      coHostName: settings.coHostName!,
      coHostVoice: settings.coHostVoice!,
      language: settings.language || 'en',
      template: settings.template,
    };
    
    wavBuffers = await synthesizeMultiSpeakerDialogue(dialogueSegments, multiSpeakerConfig);
  } else {
    const fullText = script.segments.map(s => s.text).join(' ');
    wavBuffers = await synthesizeText(fullText, settings.hostVoice, undefined, settings.language || 'en', settings.template);
    
    // Add watermarks for single-host only (2-host already included above)
    if (settings.includeWatermarks) {
      const introSilence = generateSilence(1);
      const introBuffers = await synthesizeText("It's brew time!", settings.hostVoice);
      const outroBuffers = await synthesizeText("You've been listening to a PodBrew creation.", settings.hostVoice);
      
      // Fades are automatically applied during concatenation
      wavBuffers = [introSilence, ...introBuffers, ...wavBuffers, ...outroBuffers];
    }
  }

  // Assemble and convert
  const finalWav = await concatenateWavBuffers(wavBuffers);
  const durationSeconds = getWavDuration(finalWav);
  const mp3Buffer = await convertWavToMp3(finalWav);

  // Upload
  const objectStorage = new ObjectStorageService();
  const filename = `podcast_${Date.now()}.mp3`;
  const audioUrl = await objectStorage.uploadAudioFile(mp3Buffer, filename);

  return {
    title: script.title,
    audioUrl,
    durationSeconds,
    segments: script.segments.length
  };
}
