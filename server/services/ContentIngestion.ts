import { customAlphabet } from 'nanoid';
import grok, { GROK_MODEL, isGrokAvailable } from '../grok';
import { YoutubeTranscript } from 'youtube-transcript';
import { podcastIndexClient, type EpisodeResult } from './PodcastIndexClient';
import { audioTranscriptionService } from './AudioTranscriptionService';
import { transcriptCache, type CachedTranscript } from './TranscriptCache';
import { gatherRealTimeContent } from '../perplexity';
import OpenAI from 'openai';

const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 16);

export type ContentSourceType = 'document' | 'youtube' | 'podcast' | 'spotify' | 'url';

export interface ContentSource {
  id: string;
  type: ContentSourceType;
  title: string;
  url?: string;
  text: string;
  wordCount: number;
  tokenEstimate: number;
  metadata: {
    fileName?: string;
    fileSize?: number;
    duration?: string;
    channel?: string;
    show?: string;
    publishedAt?: string;
    thumbnailUrl?: string;
    audioUrl?: string;
    extractionMethod?: string;
  };
  createdAt: Date;
}

export interface DeepAnalysisResult {
  summary: string;
  keyPoints: string[];
  themes: string[];
  quotes: Array<{ text: string; context: string }>;
  timeline?: Array<{ timestamp: string; event: string }>;
  tokenCount: number;
  analysisMethod: 'grok-deep' | 'gpt-chunked' | 'perplexity-research';
}

export interface UnifiedIngestionResult {
  sourceType: ContentSourceType;
  title: string;
  transcript: string;
  wordCount: number;
  duration?: number;
  extractionMethod: string;
  tiersUsed: string[];
  enrichment?: {
    perplexityResearch?: string;
    citations?: string[];
  };
  metadata: {
    channel?: string;
    show?: string;
    publishedAt?: string;
    thumbnailUrl?: string;
    audioUrl?: string;
    videoId?: string;
    episodeGuid?: string;
  };
  cached: boolean;
}

export interface SummarizationResult {
  summary: string;
  keyPoints: string[];
  themes: string[];
  quotes: Array<{ text: string; context: string }>;
  condensedTranscript: string;
  targetDurationMinutes: number;
  originalWordCount: number;
  condensedWordCount: number;
  compressionRatio: number;
  citations?: string[];
}

const contentCache = new Map<string, ContentSource>();
const CACHE_EXPIRY_MS = 2 * 60 * 60 * 1000;

function cleanupExpiredContent() {
  const now = new Date();
  const expired: string[] = [];
  
  const entries = Array.from(contentCache.entries());
  for (let i = 0; i < entries.length; i++) {
    const [id, content] = entries[i];
    if (now.getTime() - content.createdAt.getTime() > CACHE_EXPIRY_MS) {
      expired.push(id);
    }
  }
  
  expired.forEach(id => contentCache.delete(id));
  
  if (expired.length > 0) {
    console.log(`[ContentIngestion] Cleaned up ${expired.length} expired content items`);
  }
}

setInterval(cleanupExpiredContent, 30 * 60 * 1000);

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function storeContent(
  type: ContentSourceType,
  title: string,
  text: string,
  metadata: ContentSource['metadata'] = {},
  url?: string
): ContentSource {
  const id = nanoid();
  const wordCount = text.trim().split(/\s+/).length;
  const tokenEstimate = estimateTokens(text);
  
  const content: ContentSource = {
    id,
    type,
    title,
    url,
    text,
    wordCount,
    tokenEstimate,
    metadata,
    createdAt: new Date()
  };
  
  contentCache.set(id, content);
  console.log(`[ContentIngestion] Stored ${type} content "${title}" (${wordCount} words, ~${tokenEstimate} tokens)`);
  
  return content;
}

export function getContent(id: string): ContentSource | null {
  return contentCache.get(id) || null;
}

export function deleteContent(id: string): boolean {
  return contentCache.delete(id);
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function parseDuration(durationStr: string): number {
  const parts = durationStr.split(':').map(p => parseInt(p, 10));
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

export async function ingestContent(
  url: string,
  options: {
    enablePerplexityResearch?: boolean;
    enableWhisperTranscription?: boolean;
    maxWhisperDurationMinutes?: number;
  } = {}
): Promise<UnifiedIngestionResult> {
  const {
    enablePerplexityResearch = true,
    enableWhisperTranscription = true,
    maxWhisperDurationMinutes = 60
  } = options;

  const sourceType = detectSourceType(url);
  console.log(`[ContentIngestion] Ingesting ${sourceType} content from: ${url}`);

  const tiersUsed: string[] = [];
  let result: UnifiedIngestionResult;

  if (sourceType === 'youtube') {
    result = await ingestYouTube(url, tiersUsed, enableWhisperTranscription, maxWhisperDurationMinutes);
  } else if (sourceType === 'spotify' || sourceType === 'podcast') {
    result = await ingestPodcast(url, sourceType, tiersUsed, enableWhisperTranscription, maxWhisperDurationMinutes);
  } else {
    throw new Error(`Unsupported content type for URL: ${url}`);
  }

  if (enablePerplexityResearch && result.transcript.length > 100) {
    try {
      console.log(`[ContentIngestion] TIER 4: Enriching with Perplexity research...`);
      tiersUsed.push('perplexity-research');
      
      const researchResult = await gatherRealTimeContent(
        result.title,
        { templateCategory: 'documents' } as any
      );
      
      if (researchResult.content) {
        result.enrichment = {
          perplexityResearch: researchResult.content,
          citations: researchResult.citations
        };
        console.log(`[ContentIngestion] ✅ Perplexity research added: ${researchResult.content.length} chars, ${researchResult.citations.length} citations`);
      }
    } catch (error) {
      console.log(`[ContentIngestion] Perplexity research failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  result.tiersUsed = tiersUsed;
  return result;
}

function detectSourceType(url: string): ContentSourceType {
  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    return 'youtube';
  }
  if (url.includes('spotify.com/episode') || url.includes('open.spotify.com')) {
    return 'spotify';
  }
  if (url.includes('podcasts.apple.com') || 
      url.includes('anchor.fm') || 
      url.includes('podbean.com') ||
      url.includes('buzzsprout.com') ||
      url.includes('transistor.fm') ||
      url.includes('simplecast.com') ||
      url.includes('libsyn.com') ||
      url.includes('spreaker.com') ||
      url.includes('podomatic.com') ||
      url.includes('stitcher.com') ||
      url.includes('overcast.fm') ||
      url.includes('pocket-casts') ||
      url.includes('castbox') ||
      url.match(/\.mp3(\?|$)/) ||
      url.match(/\.m4a(\?|$)/)) {
    return 'podcast';
  }
  return 'url';
}

async function ingestYouTube(
  url: string,
  tiersUsed: string[],
  enableWhisper: boolean,
  maxWhisperMinutes: number
): Promise<UnifiedIngestionResult> {
  const videoIdMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  
  if (!videoIdMatch) {
    throw new Error('Invalid YouTube URL. Please provide a valid YouTube video link.');
  }
  
  const videoId = videoIdMatch[1];
  
  const cached = transcriptCache.get('youtube', videoId);
  if (cached) {
    console.log(`[ContentIngestion] Using cached transcript for YouTube video: ${videoId}`);
    return {
      sourceType: 'youtube',
      title: cached.title,
      transcript: cached.transcript,
      wordCount: cached.wordCount,
      duration: cached.duration,
      extractionMethod: cached.method,
      tiersUsed: ['cache'],
      metadata: {
        videoId,
        channel: cached.metadata.channel,
        thumbnailUrl: cached.metadata.thumbnailUrl
      },
      cached: true
    };
  }

  console.log(`[ContentIngestion] Extracting transcript for YouTube video: ${videoId}`);
  
  let transcript = '';
  let title = 'Untitled Video';
  let channel: string | undefined;
  let duration: string | undefined;
  let durationSeconds: number | undefined;
  let extractionMethod = 'unknown';
  let cachedHtml: string | null = null;
  
  // First try YouTube oEmbed API (more reliable, not blocked)
  try {
    console.log(`[ContentIngestion] TIER 0: Fetching video metadata via oEmbed API...`);
    tiersUsed.push('metadata-fetch');
    
    const oembedResponse = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      { headers: { 'Accept': 'application/json' } }
    );
    
    if (oembedResponse.ok) {
      const oembedData = await oembedResponse.json();
      title = oembedData.title || title;
      channel = oembedData.author_name;
      console.log(`[ContentIngestion] oEmbed metadata: "${title}" by ${channel || 'Unknown'}`);
    } else {
      console.log(`[ContentIngestion] oEmbed API failed: ${oembedResponse.status}`);
    }
  } catch (oembedError) {
    console.log(`[ContentIngestion] oEmbed API error: ${oembedError instanceof Error ? oembedError.message : String(oembedError)}`);
  }
  
  // Then try full page for captions and additional metadata
  try {
    console.log(`[ContentIngestion] Fetching full video page for captions...`);
    
    const pageResponse = await fetch(
      `https://www.youtube.com/watch?v=${videoId}`,
      { 
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        } 
      }
    );
    
    console.log(`[ContentIngestion] Page fetch status: ${pageResponse.status}`);
    
    if (pageResponse.ok) {
      cachedHtml = await pageResponse.text();
      console.log(`[ContentIngestion] Page HTML length: ${cachedHtml.length} chars`);
      
      // Only update title if we didn't get it from oEmbed
      if (title === 'Untitled Video') {
        const titleMatch = cachedHtml.match(/<title>([^<]+)<\/title>/);
        if (titleMatch) {
          title = titleMatch[1].replace(' - YouTube', '').trim();
        }
      }
      
      const channelMatch = cachedHtml.match(/"ownerChannelName":"([^"]+)"/);
      const durationMatch = cachedHtml.match(/"lengthSeconds":"(\d+)"/);
      if (!channel && channelMatch) channel = channelMatch[1];
      
      if (durationMatch) {
        durationSeconds = parseInt(durationMatch[1]);
        duration = formatDuration(durationSeconds);
      }
      
      console.log(`[ContentIngestion] Metadata: "${title}" by ${channel || 'Unknown'} (${duration || 'Unknown duration'})`);
    } else {
      console.log(`[ContentIngestion] Page fetch failed: ${pageResponse.status} ${pageResponse.statusText}`);
    }
  } catch (metaError) {
    console.log(`[ContentIngestion] Failed to fetch page: ${metaError instanceof Error ? metaError.message : String(metaError)}`);
  }
  
  try {
    console.log(`[ContentIngestion] TIER 1: Trying youtube-transcript npm package...`);
    tiersUsed.push('youtube-transcript-package');
    
    const transcriptData = await YoutubeTranscript.fetchTranscript(videoId);
    
    if (transcriptData && transcriptData.length > 0) {
      transcript = transcriptData
        .map(segment => segment.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      console.log(`[ContentIngestion] ✅ TIER 1 SUCCESS: Extracted ${transcriptData.length} segments, ${transcript.length} characters`);
      extractionMethod = 'youtube-transcript-package';
    }
  } catch (tier1Error) {
    console.log(`[ContentIngestion] TIER 1 FAILED: ${tier1Error instanceof Error ? tier1Error.message : String(tier1Error)}`);
  }
  
  if (!transcript || transcript.length < 100) {
    try {
      console.log(`[ContentIngestion] TIER 2: Trying direct timedtext API (json3 format)...`);
      tiersUsed.push('timedtext-json3-api');
      
      const html = cachedHtml || await fetch(
        `https://www.youtube.com/watch?v=${videoId}`,
        { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }
      ).then(r => r.text());
      
      if (html) {
        const captionTracksMatch = html.match(/"captionTracks":\s*(\[[\s\S]*?\])(?=,\s*")/);
        
        if (captionTracksMatch && captionTracksMatch[1]) {
          try {
            const captionTracks = JSON.parse(captionTracksMatch[1]);
            console.log(`[ContentIngestion] Found ${captionTracks.length} caption tracks`);
            
            const englishTrack = captionTracks.find((t: any) => 
              t.languageCode === 'en' || t.languageCode?.startsWith('en')
            ) || captionTracks[0];
            
            if (englishTrack?.baseUrl) {
              let captionUrl = englishTrack.baseUrl
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'");
              
              captionUrl += '&fmt=json3';
              
              console.log(`[ContentIngestion] Fetching captions with json3 format...`);
              
              const captionResponse = await fetch(captionUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
              });
              
              if (captionResponse.ok) {
                const captionJson = await captionResponse.json();
                
                if (captionJson.events && Array.isArray(captionJson.events)) {
                  transcript = captionJson.events
                    .filter((event: any) => event.segs)
                    .map((event: any) => 
                      event.segs
                        .map((seg: any) => seg.utf8 || '')
                        .join('')
                    )
                    .join(' ')
                    .replace(/\s+/g, ' ')
                    .replace(/[\u200B-\u200D\uFEFF]/g, '')
                    .trim();
                  
                  console.log(`[ContentIngestion] ✅ TIER 2 SUCCESS: Extracted ${captionJson.events.length} events, ${transcript.length} characters`);
                  extractionMethod = 'timedtext-json3-api';
                }
              }
            }
          } catch (parseError) {
            console.log(`[ContentIngestion] Failed to parse caption tracks: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
          }
        }
      }
    } catch (tier2Error) {
      console.log(`[ContentIngestion] TIER 2 FAILED: ${tier2Error instanceof Error ? tier2Error.message : String(tier2Error)}`);
    }
  }
  
  // TIER 3: Whisper audio transcription via yt-dlp extraction
  // This guarantees transcript extraction for any YouTube video with audio
  if ((!transcript || transcript.length < 100) && enableWhisper && audioTranscriptionService.isAvailable()) {
    console.log(`[ContentIngestion] TIER 3: Extracting audio with yt-dlp and transcribing with Whisper...`);
    tiersUsed.push('youtube-whisper');
    
    try {
      // Check if yt-dlp is available
      const ytDlpAvailable = await audioTranscriptionService.isYtDlpAvailable();
      if (!ytDlpAvailable) {
        throw new Error('yt-dlp not installed');
      }

      const whisperResult = await audioTranscriptionService.transcribeYouTubeVideo(videoId, {
        maxDurationMinutes: maxWhisperMinutes,
        language: 'en'
      });
      
      if (whisperResult.text && whisperResult.text.length > 100) {
        transcript = whisperResult.text;
        extractionMethod = 'youtube-whisper';
        if (whisperResult.duration) {
          durationSeconds = Math.round(whisperResult.duration);
        }
        console.log(`[ContentIngestion] ✅ TIER 3 SUCCESS: Whisper transcribed ${transcript.length} characters (${whisperResult.text.split(/\s+/).length} words)`);
      }
    } catch (tier3Error) {
      const errorMsg = tier3Error instanceof Error ? tier3Error.message : String(tier3Error);
      console.log(`[ContentIngestion] TIER 3 FAILED: ${errorMsg}`);
      
      // If it's a duration limit error, propagate it
      if (errorMsg.includes('exceeds maximum limit')) {
        throw tier3Error;
      }
    }
  }

  // TIER 4: Grok AI analysis as last resort (only uses metadata, may hallucinate)
  // Only used when captions unavailable AND Whisper fails/disabled
  if ((!transcript || transcript.length < 100) && isGrokAvailable()) {
    console.log(`[ContentIngestion] TIER 4: Using Grok AI to analyze video from metadata (⚠️ may not reflect actual content)...`);
    tiersUsed.push('grok-analysis');
    
    try {
      let html = cachedHtml;
      if (!html) {
        const response = await fetch(
          `https://www.youtube.com/watch?v=${videoId}`,
          { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }
        );
        html = await response.text();
      }
      
      const descMatch = html.match(/"shortDescription":"([^"]*?)"/);
      let description = descMatch ? descMatch[1].replace(/\\n/g, ' ').replace(/\\/g, '') : 'No description available';
      if (!description || description.length < 10) {
        description = 'Video content from YouTube. Use title as reference.';
      }
      
      const analysisPrompt = `Analyze this YouTube video and create a detailed transcript-like summary (at least 500 words).

Video URL: https://www.youtube.com/watch?v=${videoId}
Title: ${title}
${channel ? `Channel: ${channel}` : ''}
${description !== 'Video content from YouTube. Use title as reference.' ? `Description: ${description}` : ''}

You have access to information about this video. Please provide:
1. A comprehensive summary of the main content and topics discussed
2. Key points and takeaways
3. Important quotes or statements made (if known)
4. The structure and flow of the video

Create this as a detailed summary that could serve as source material for a podcast. Be factual and specific based on what you know about this video.`;

      const response = await grok.chat.completions.create({
        model: GROK_MODEL,
        messages: [
          { role: 'system', content: 'You are an expert at analyzing video content and creating detailed summaries. Create a realistic transcript based on the video information.' },
          { role: 'user', content: analysisPrompt }
        ],
        temperature: 0.7,
        max_tokens: 2000
      });
      
      transcript = response.choices[0].message.content || description;
      extractionMethod = 'grok-analysis';
      
      console.log(`[ContentIngestion] ✅ TIER 4 SUCCESS: Grok generated ${transcript.length} characters (⚠️ based on metadata only)`);
    } catch (tier4Error) {
      console.error('[ContentIngestion] TIER 4 FAILED:', tier4Error);
    }
  }

  if (!transcript || transcript.length < 100) {
    throw new Error('Failed to extract transcript: All methods failed');
  }
  
  const wordCount = transcript.split(/\s+/).length;
  console.log(`[ContentIngestion] YouTube extraction complete: ${transcript.length} characters, ${wordCount} words (method: ${extractionMethod})`);
  
  transcriptCache.set('youtube', videoId, {
    title,
    transcript,
    duration: durationSeconds,
    method: extractionMethod,
    metadata: {
      channel,
      thumbnailUrl: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
    }
  });
  
  return {
    sourceType: 'youtube',
    title,
    transcript,
    wordCount,
    duration: durationSeconds,
    extractionMethod,
    tiersUsed,
    metadata: {
      videoId,
      channel,
      thumbnailUrl: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
    },
    cached: false
  };
}

async function ingestPodcast(
  url: string,
  sourceType: 'spotify' | 'podcast',
  tiersUsed: string[],
  enableWhisper: boolean,
  maxWhisperMinutes: number
): Promise<UnifiedIngestionResult> {
  console.log(`[ContentIngestion] Ingesting ${sourceType} content: ${url}`);

  const cached = transcriptCache.get(sourceType, url);
  if (cached) {
    console.log(`[ContentIngestion] Using cached transcript for ${sourceType}: ${url}`);
    return {
      sourceType,
      title: cached.title,
      transcript: cached.transcript,
      wordCount: cached.wordCount,
      duration: cached.duration,
      extractionMethod: cached.method,
      tiersUsed: ['cache'],
      metadata: {
        show: cached.metadata.show,
        channel: cached.metadata.channel,
        thumbnailUrl: cached.metadata.thumbnailUrl,
        audioUrl: cached.metadata.audioUrl
      },
      cached: true
    };
  }

  let episode: EpisodeResult | null = null;
  let transcript = '';
  let title = 'Podcast Episode';
  let show: string | undefined;
  let thumbnailUrl: string | undefined;
  let audioUrl: string | undefined;
  let durationSeconds: number | undefined;
  let extractionMethod = 'unknown';

  if (sourceType === 'spotify' && podcastIndexClient.isAvailable()) {
    console.log(`[ContentIngestion] TIER 1: Cross-referencing Spotify with PodcastIndex...`);
    tiersUsed.push('podcastindex-lookup');
    
    episode = await podcastIndexClient.findSpotifyEpisode(url);
    
    if (episode) {
      title = episode.title;
      show = episode.feedTitle;
      thumbnailUrl = episode.image || episode.feedImage;
      audioUrl = episode.enclosureUrl;
      durationSeconds = episode.duration;
      
      console.log(`[ContentIngestion] ✅ Found episode in PodcastIndex: "${title}"`);
      console.log(`[ContentIngestion] Audio URL: ${audioUrl}`);
      
      if (episode.transcriptUrl || (episode.transcripts && episode.transcripts.length > 0)) {
        console.log(`[ContentIngestion] TIER 2: Fetching creator-provided transcript...`);
        tiersUsed.push('creator-transcript');
        
        const transcriptUrl = episode.transcriptUrl || episode.transcripts?.[0]?.url;
        if (transcriptUrl) {
          const creatorTranscript = await podcastIndexClient.getTranscriptFromUrl(transcriptUrl);
          if (creatorTranscript && creatorTranscript.length > 100) {
            transcript = creatorTranscript;
            extractionMethod = 'creator-transcript';
            console.log(`[ContentIngestion] ✅ TIER 2 SUCCESS: Got creator transcript (${transcript.length} chars)`);
          }
        }
      }
    }
  }

  if (!episode) {
    console.log(`[ContentIngestion] TIER 1: Scraping podcast page metadata...`);
    tiersUsed.push('page-scrape');
    
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PodBrew/1.0)' }
      });
      
      if (response.ok) {
        const html = await response.text();
        
        const titleMatch = html.match(/<title>([^<]+)<\/title>/) ||
                           html.match(/og:title[^>]+content="([^"]+)"/) ||
                           html.match(/twitter:title[^>]+content="([^"]+)"/);
        title = titleMatch ? titleMatch[1].trim() : 'Podcast Episode';
        
        const imageMatch = html.match(/og:image[^>]+content="([^"]+)"/);
        thumbnailUrl = imageMatch ? imageMatch[1] : undefined;
        
        const audioMatch = html.match(/type=["']audio\/(?:mpeg|mp3|m4a)["'][^>]*src=["']([^"']+)["']/) ||
                           html.match(/src=["']([^"']+\.mp3(?:\?[^"']*)?)["']/) ||
                           html.match(/enclosure[^>]+url=["']([^"']+)["']/);
        audioUrl = audioMatch ? audioMatch[1] : undefined;
        
        console.log(`[ContentIngestion] Scraped: "${title}"`);
        if (audioUrl) {
          console.log(`[ContentIngestion] Found audio URL: ${audioUrl}`);
        }
      }
    } catch (scrapeError) {
      console.log(`[ContentIngestion] Page scrape failed: ${scrapeError instanceof Error ? scrapeError.message : 'Unknown error'}`);
    }
  }

  if ((!transcript || transcript.length < 100) && audioUrl && enableWhisper && audioTranscriptionService.isAvailable()) {
    const durationMinutes = durationSeconds ? durationSeconds / 60 : 30;
    
    if (durationMinutes <= maxWhisperMinutes) {
      console.log(`[ContentIngestion] TIER 3: Transcribing audio with Whisper API...`);
      tiersUsed.push('whisper-transcription');
      
      const estimatedCost = audioTranscriptionService.estimateCost(durationSeconds || 1800);
      console.log(`[ContentIngestion] Estimated Whisper cost: $${estimatedCost.toFixed(3)}`);
      
      try {
        const transcriptionResult = await audioTranscriptionService.transcribeFromUrl(audioUrl);
        transcript = transcriptionResult.text;
        durationSeconds = transcriptionResult.duration || durationSeconds;
        extractionMethod = transcriptionResult.method;
        
        console.log(`[ContentIngestion] ✅ TIER 3 SUCCESS: Whisper transcribed ${transcript.length} characters`);
      } catch (whisperError) {
        console.log(`[ContentIngestion] Whisper transcription failed: ${whisperError instanceof Error ? whisperError.message : 'Unknown error'}`);
      }
    } else {
      console.log(`[ContentIngestion] Skipping Whisper: episode duration (${durationMinutes.toFixed(0)} min) exceeds max (${maxWhisperMinutes} min)`);
    }
  }

  if ((!transcript || transcript.length < 100) && isGrokAvailable()) {
    console.log(`[ContentIngestion] TIER 4: Using Grok AI for podcast analysis...`);
    tiersUsed.push('grok-analysis');
    
    try {
      let pageContent = '';
      
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PodBrew/1.0)' }
      });
      
      if (response.ok) {
        const html = await response.text();
        
        const descMatch = html.match(/og:description[^>]+content="([^"]+)"/) ||
                          html.match(/meta[^>]+name="description"[^>]+content="([^"]+)"/);
        pageContent = descMatch ? descMatch[1] : '';
        
        const bodyText = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 10000);
        
        pageContent += '\n\n' + bodyText;
      }
      
      const analysisPrompt = `Analyze this podcast episode and create a detailed summary:

Title: ${title}
${show ? `Show: ${show}` : ''}
Page content (partial):
${pageContent.slice(0, 8000)}

Create a comprehensive transcript-like summary (at least 500 words) covering the main topics, key insights, notable quotes, and important conclusions.`;

      const grokResponse = await grok.chat.completions.create({
        model: GROK_MODEL,
        messages: [
          { role: 'system', content: 'You are an expert podcast analyst. Create detailed, engaging summaries that capture the essence of podcast episodes.' },
          { role: 'user', content: analysisPrompt }
        ],
        temperature: 0.7,
        max_tokens: 3000
      });
      
      transcript = grokResponse.choices[0].message.content || '';
      extractionMethod = 'grok-analysis';
      
      console.log(`[ContentIngestion] ✅ TIER 4 SUCCESS: Grok generated ${transcript.length} characters`);
    } catch (grokError) {
      console.error('[ContentIngestion] Grok analysis failed:', grokError);
    }
  }

  if (!transcript || transcript.length < 100) {
    throw new Error('Failed to extract podcast content: All methods failed');
  }

  const wordCount = transcript.split(/\s+/).length;
  console.log(`[ContentIngestion] Podcast extraction complete: ${wordCount} words (method: ${extractionMethod})`);

  transcriptCache.set(sourceType, url, {
    title,
    transcript,
    duration: durationSeconds,
    method: extractionMethod,
    metadata: {
      show,
      thumbnailUrl,
      audioUrl
    }
  });

  return {
    sourceType,
    title,
    transcript,
    wordCount,
    duration: durationSeconds,
    extractionMethod,
    tiersUsed,
    metadata: {
      show,
      thumbnailUrl,
      audioUrl,
      episodeGuid: episode?.guid
    },
    cached: false
  };
}

export async function summarizeContent(
  ingestionResult: UnifiedIngestionResult,
  targetDurationMinutes: number,
  options: {
    analysisType?: 'summary' | 'highlights' | 'educational' | 'discussion';
    includeQuotes?: boolean;
    includeTimeline?: boolean;
  } = {}
): Promise<SummarizationResult> {
  const {
    analysisType = 'summary',
    includeQuotes = true,
    includeTimeline = true
  } = options;

  const targetWords = targetDurationMinutes * 42;
  const originalWordCount = ingestionResult.wordCount;
  
  console.log(`[ContentIngestion] Summarizing ${originalWordCount} words to ~${targetWords} words for ${targetDurationMinutes} minute podcast (42 WPM calibration)`);

  const combinedContent = ingestionResult.enrichment?.perplexityResearch
    ? `TRANSCRIPT:\n${ingestionResult.transcript}\n\nADDITIONAL RESEARCH:\n${ingestionResult.enrichment.perplexityResearch}`
    : ingestionResult.transcript;

  if (!isGrokAvailable()) {
    console.log('[ContentIngestion] Grok not available, using basic summarization');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are an expert content summarizer. Create a podcast-ready summary of approximately ${targetWords} words.`
        },
        {
          role: 'user',
          content: `Summarize this content for a ${targetDurationMinutes}-minute podcast:\n\n${combinedContent.slice(0, 100000)}`
        }
      ],
      temperature: 0.7,
      max_tokens: Math.min(16000, targetWords * 2)
    });

    const summary = response.choices[0].message.content || '';
    const condensedWordCount = summary.split(/\s+/).length;

    return {
      summary,
      keyPoints: [],
      themes: [],
      quotes: [],
      condensedTranscript: summary,
      targetDurationMinutes,
      originalWordCount,
      condensedWordCount,
      compressionRatio: originalWordCount / condensedWordCount,
      citations: ingestionResult.enrichment?.citations
    };
  }

  const analysisPrompts = {
    summary: `Create a comprehensive summary that captures the essence of this content.`,
    highlights: `Extract the most interesting, surprising, or impactful highlights from this content. Focus on moments that would engage listeners.`,
    educational: `Create an educational breakdown of this content, explaining key concepts and providing learning insights.`,
    discussion: `Analyze this content and create discussion points, different perspectives, and thought-provoking questions.`
  };

  const systemPrompt = `You are an expert content analyst and podcast scriptwriter. Create engaging podcast-ready summaries.

Guidelines:
- Target approximately ${targetWords} words for the main summary
- Be thorough but concise
- Highlight the most interesting and important points
- Use conversational language suitable for audio
- Include specific examples and quotes where relevant

Return your analysis as JSON with this structure:
{
  "summary": "The main summary text (${targetWords} words target)",
  "keyPoints": ["Key point 1", "Key point 2", ...],
  "themes": ["Theme 1", "Theme 2", ...],
  "quotes": [{"text": "Notable quote", "context": "Why it matters"}, ...]${includeTimeline ? ',\n  "timeline": [{"timestamp": "Beginning/Middle/End", "event": "What happens"}, ...]' : ''}
}`;

  const response = await grok.chat.completions.create({
    model: GROK_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `${analysisPrompts[analysisType]}\n\nContent to analyze:\n\n${combinedContent.slice(0, 100000)}` }
    ],
    temperature: 0.7,
    max_tokens: Math.min(16000, targetWords * 2),
    response_format: { type: 'json_object' }
  });

  const resultText = response.choices[0].message.content || '{}';
  const result = JSON.parse(resultText);

  const condensedWordCount = (result.summary || '').split(/\s+/).length;

  console.log(`[ContentIngestion] Summarization complete: ${originalWordCount} → ${condensedWordCount} words (${(originalWordCount / condensedWordCount).toFixed(1)}x compression)`);

  return {
    summary: result.summary || '',
    keyPoints: result.keyPoints || [],
    themes: result.themes || [],
    quotes: includeQuotes ? (result.quotes || []) : [],
    condensedTranscript: result.summary || '',
    targetDurationMinutes,
    originalWordCount,
    condensedWordCount,
    compressionRatio: originalWordCount / condensedWordCount,
    citations: ingestionResult.enrichment?.citations
  };
}

export async function extractYouTubeTranscript(videoUrl: string): Promise<{
  title: string;
  transcript: string;
  metadata: {
    channel?: string;
    duration?: string;
    publishedAt?: string;
    thumbnailUrl?: string;
    videoId: string;
  };
}> {
  const result = await ingestContent(videoUrl, { enablePerplexityResearch: false });
  
  return {
    title: result.title,
    transcript: result.transcript,
    metadata: {
      videoId: result.metadata.videoId || '',
      channel: result.metadata.channel,
      duration: result.duration ? formatDuration(result.duration) : undefined,
      thumbnailUrl: result.metadata.thumbnailUrl
    }
  };
}

export async function extractPodcastTranscript(episodeUrl: string): Promise<{
  title: string;
  transcript: string;
  metadata: {
    show?: string;
    duration?: string;
    publishedAt?: string;
    thumbnailUrl?: string;
  };
}> {
  const result = await ingestContent(episodeUrl, { enablePerplexityResearch: false });
  
  return {
    title: result.title,
    transcript: result.transcript,
    metadata: {
      show: result.metadata.show,
      duration: result.duration ? formatDuration(result.duration) : undefined,
      thumbnailUrl: result.metadata.thumbnailUrl
    }
  };
}

export async function analyzeContentWithGrok(
  content: string,
  targetDurationMinutes: number,
  analysisType: 'summary' | 'highlights' | 'educational' | 'discussion' = 'summary'
): Promise<DeepAnalysisResult> {
  const mockIngestion: UnifiedIngestionResult = {
    sourceType: 'document',
    title: 'Content Analysis',
    transcript: content,
    wordCount: content.split(/\s+/).length,
    extractionMethod: 'direct',
    tiersUsed: ['direct'],
    metadata: {},
    cached: false
  };

  const result = await summarizeContent(mockIngestion, targetDurationMinutes, { analysisType });

  return {
    summary: result.summary,
    keyPoints: result.keyPoints,
    themes: result.themes,
    quotes: result.quotes,
    tokenCount: estimateTokens(content),
    analysisMethod: 'grok-deep'
  };
}

export function getContentStats() {
  const sources = Array.from(contentCache.values());
  const cacheStats = transcriptCache.getStats();
  
  return {
    totalItems: sources.length,
    byType: {
      document: sources.filter(s => s.type === 'document').length,
      youtube: sources.filter(s => s.type === 'youtube').length,
      podcast: sources.filter(s => s.type === 'podcast').length,
      spotify: sources.filter(s => s.type === 'spotify').length,
      url: sources.filter(s => s.type === 'url').length
    },
    totalTokens: sources.reduce((sum, s) => sum + s.tokenEstimate, 0),
    transcriptCache: cacheStats,
    items: sources.map(s => ({
      id: s.id,
      type: s.type,
      title: s.title,
      wordCount: s.wordCount,
      tokenEstimate: s.tokenEstimate,
      createdAt: s.createdAt
    }))
  };
}

export function getServiceStatus() {
  return {
    podcastIndex: podcastIndexClient.isAvailable(),
    whisper: audioTranscriptionService.isAvailable(),
    grok: isGrokAvailable(),
    perplexity: !!process.env.PERPLEXITY_API_KEY,
    openai: !!process.env.OPENAI_API_KEY
  };
}
