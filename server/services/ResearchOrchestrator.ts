import { ingestContent, type UnifiedIngestionResult } from './ContentIngestion';
import { gatherRealTimeContent } from '../perplexity';
import { isGrokAvailable, getNewsContextFromGrok } from '../grok';
import type { GenerationParams } from '@shared/schema';
import crypto from 'crypto';

export interface DetectedSource {
  type: 'youtube' | 'podcast' | 'spotify' | 'rss' | 'url' | 'generic';
  url: string;
  detected: boolean;
}

export interface ResearchContext {
  topic: string;
  templateCategory: string;
  detectedSources: DetectedSource[];
  ingestedContent: Array<{
    sourceType: string;
    title: string;
    transcript: string;
    wordCount: number;
    extractionMethod: string;
    citations?: string[];
  }>;
  perplexityResearch?: {
    content: string;
    citations: string[];
    query: string;
  };
  grokSocialContext?: {
    content: string;
    citations: string[];
  };
  compiledContext: string;
  totalWordCount: number;
  researchComplete: boolean;
  stages: ResearchStage[];
}

export interface ResearchStage {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'skipped' | 'failed';
  startedAt?: number;
  completedAt?: number;
  result?: string;
}

export interface ResearchOptions {
  enablePerplexityResearch?: boolean;
  enableContentIngestion?: boolean;
  targetDurationMinutes?: number;
  locationCity?: string | null;
  locationEnabled?: boolean;
  timeFrame?: string;
}

function isPerplexityConfigured(): boolean {
  return !!process.env.PERPLEXITY_API_KEY;
}

const TEMPLATE_RESEARCH_PROMPTS: Record<string, (topic: string, location?: string | null) => string> = {
  news: (topic, location) => {
    const locationContext = location ? ` Focus on developments relevant to ${location} and surrounding areas.` : '';
    return `Latest breaking news and developments about "${topic}" as of today. Include key facts, important quotes, recent updates, and credible sources.${locationContext} Provide comprehensive coverage with multiple perspectives.`;
  },
  sports: (topic, location) => {
    const locationContext = location ? ` Include local team news and standings for ${location}.` : '';
    return `Current sports news about "${topic}". Include latest scores, standings, player statistics, injury updates, trade rumors, and upcoming games.${locationContext} Cover recent performances and expert analysis.`;
  },
  events: (topic, location) => {
    const locationContext = location ? ` Focus on events in and around ${location}.` : '';
    return `Upcoming and recent events related to "${topic}".${locationContext} Include dates, venues, ticket information, notable speakers/performers, and what attendees can expect. Cover both major and community events.`;
  },
  teachme: (topic) => {
    return `Educational content about "${topic}". Explain the concept clearly with definitions, key principles, real-world examples, common misconceptions, and practical applications. Include learning resources and expert insights.`;
  },
  medical: (topic) => {
    return `Medical and health information about "${topic}". Include symptoms, causes, treatments, prevention strategies, latest research, and expert recommendations. Note: This is for educational purposes only and not medical advice.`;
  },
  stories: (topic) => {
    return `Background and context for a story about "${topic}". Include genre conventions, narrative elements, character archetypes, setting details, and thematic elements that would make this story compelling.`;
  },
  documents: (topic) => {
    return `Context and background for understanding "${topic}". Include key themes, important concepts, related topics, and practical implications of the content.`;
  },
  custom: (topic, location) => {
    const locationContext = location ? ` Include information relevant to ${location} where applicable.` : '';
    return `Comprehensive information about "${topic}".${locationContext} Include key facts, recent developments, expert opinions, statistics, and relevant context. Provide a thorough overview from multiple angles.`;
  }
};

const URL_PATTERNS = {
  youtube: /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/g,
  spotify: /(?:www\.)?open\.spotify\.com\/(episode|show)\/([a-zA-Z0-9]+)/g,
  podcast: /(?:www\.)?(?:podcasts?\.apple\.com|overcast\.fm|pocketcasts\.com|castbox\.fm|stitcher\.com|anchor\.fm|podcasts\.google\.com|podbean\.com|buzzsprout\.com|spreaker\.com|libsyn\.com|simplecast\.com|transistor\.fm|megaphone\.fm|omny\.fm|acast\.com|podchaser\.com|listen\.com|iheart\.com\/podcast|tunein\.com\/podcasts?|podtail\.com|player\.fm|podcastaddict\.com)/g,
  rss: /(?:https?:\/\/[^\s]+(?:\.rss|\/feed\/?|\/rss\/?|atom\.xml|feed\.xml|rss\.xml|podcast\.xml))/g,
  genericUrl: /https?:\/\/[^\s]+/g
};

export function detectUrlsInTopic(topic: string): DetectedSource[] {
  const sources: DetectedSource[] = [];
  const seenUrls = new Set<string>();
  
  const youtubeRegex = new RegExp(URL_PATTERNS.youtube.source, 'g');
  let match;
  while ((match = youtubeRegex.exec(topic)) !== null) {
    const url = match[0];
    if (!seenUrls.has(url)) {
      seenUrls.add(url);
      sources.push({ type: 'youtube', url, detected: true });
    }
  }
  
  const spotifyRegex = new RegExp(URL_PATTERNS.spotify.source, 'g');
  while ((match = spotifyRegex.exec(topic)) !== null) {
    const url = match[0];
    if (!seenUrls.has(url)) {
      seenUrls.add(url);
      sources.push({ type: 'spotify', url, detected: true });
    }
  }
  
  const podcastRegex = new RegExp(URL_PATTERNS.podcast.source, 'g');
  while ((match = podcastRegex.exec(topic)) !== null) {
    const url = match[0];
    if (!seenUrls.has(url)) {
      seenUrls.add(url);
      sources.push({ type: 'podcast', url, detected: true });
    }
  }
  
  const rssRegex = new RegExp(URL_PATTERNS.rss.source, 'g');
  while ((match = rssRegex.exec(topic)) !== null) {
    const url = match[0];
    if (!seenUrls.has(url)) {
      seenUrls.add(url);
      sources.push({ type: 'rss', url, detected: true });
    }
  }
  
  return sources;
}

export function getCleanTopic(topic: string): string {
  let cleanTopic = topic;
  
  for (const [, pattern] of Object.entries(URL_PATTERNS)) {
    cleanTopic = cleanTopic.replace(new RegExp(pattern.source, 'g'), '');
  }
  
  return cleanTopic.replace(/\s+/g, ' ').trim();
}

export async function orchestrateResearch(
  topic: string,
  templateCategory: string,
  options: ResearchOptions = {}
): Promise<ResearchContext> {
  const {
    enablePerplexityResearch = true,
    enableContentIngestion = true,
    targetDurationMinutes = 10,
    locationCity = null,
    locationEnabled = false,
    timeFrame = 'pastMonth'
  } = options;
  
  const stages: ResearchStage[] = [
    { name: 'URL Detection', status: 'pending' },
    { name: 'Content Ingestion', status: 'pending' },
    { name: 'Deep Research', status: 'pending' },
    { name: 'Context Compilation', status: 'pending' }
  ];
  
  const context: ResearchContext = {
    topic,
    templateCategory,
    detectedSources: [],
    ingestedContent: [],
    compiledContext: '',
    totalWordCount: 0,
    researchComplete: false,
    stages
  };
  
  console.log(`[ResearchOrchestrator] Starting research for template: ${templateCategory}`);
  console.log(`[ResearchOrchestrator] Topic: "${topic.substring(0, 100)}..."`);
  
  stages[0].status = 'running';
  stages[0].startedAt = Date.now();
  
  const detectedSources = detectUrlsInTopic(topic);
  context.detectedSources = detectedSources;
  const cleanTopic = getCleanTopic(topic);
  
  stages[0].status = 'completed';
  stages[0].completedAt = Date.now();
  stages[0].result = `Detected ${detectedSources.length} source(s)`;
  
  console.log(`[ResearchOrchestrator] Detected ${detectedSources.length} URLs in topic`);
  
  stages[1].status = 'running';
  stages[1].startedAt = Date.now();
  stages[2].status = 'running';
  stages[2].startedAt = Date.now();

  const ingestionTask = (async () => {
    if (enableContentIngestion && detectedSources.length > 0) {
      const ingestionPromises = detectedSources.map(async (source) => {
        try {
          console.log(`[ResearchOrchestrator] Ingesting ${source.type}: ${source.url}`);
          const result = await ingestContent(source.url, { enablePerplexityResearch: false });
          
          if (result) {
            return {
              sourceType: result.sourceType,
              title: result.title,
              transcript: result.transcript,
              wordCount: result.wordCount,
              extractionMethod: result.extractionMethod,
              citations: result.enrichment?.citations
            };
          }
        } catch (error) {
          console.error(`[ResearchOrchestrator] Failed to ingest ${source.url}:`, error);
        }
        return null;
      });
      
      const results = await Promise.all(ingestionPromises);
      context.ingestedContent = results.filter(Boolean) as typeof context.ingestedContent;
      
      stages[1].status = 'completed';
      stages[1].completedAt = Date.now();
      stages[1].result = `Ingested ${context.ingestedContent.length} source(s)`;
    } else {
      stages[1].status = 'skipped';
      stages[1].result = 'No URLs detected';
    }
  })();

  const perplexityTask = (async () => {
    if (enablePerplexityResearch && isPerplexityConfigured()) {
      const researchPromptFn = TEMPLATE_RESEARCH_PROMPTS[templateCategory] || TEMPLATE_RESEARCH_PROMPTS.custom;
      const location = locationEnabled ? locationCity : null;
      const researchQuery = researchPromptFn(cleanTopic || topic, location);
      
      try {
        console.log(`[ResearchOrchestrator] Running Perplexity research for: ${templateCategory}`);
        
        const generationParams: GenerationParams = {
          topic: cleanTopic || topic,
          durationMinutes: targetDurationMinutes,
          languageComplexity: 5,
          numPeople: 2,
          podcastStyle: 'conversational',
          timeFrame: timeFrame as any,
          coHostPersonality: 'casual',
          podcastMood: 'balanced',
          language: 'en',
          templateCategory,
          assignedVoices: []
        };
        
        const deepResearchTemplates = ['documents', 'document', 'research'];
        const researchSearchDepth: 'high' | 'medium' = deepResearchTemplates.includes(templateCategory || '') ? 'high' : 'medium';
        const research = await gatherRealTimeContent(researchQuery, generationParams, researchSearchDepth);
        
        if (research) {
          context.perplexityResearch = {
            content: research.content || '',
            citations: research.citations || [],
            query: researchQuery
          };
          
          stages[2].status = 'completed';
          stages[2].completedAt = Date.now();
          stages[2].result = `${(research.content || '').split(/\s+/).length} words, ${(research.citations || []).length} citations`;
        }
      } catch (error) {
        console.error('[ResearchOrchestrator] Perplexity research failed:', error);
        stages[2].status = 'failed';
        stages[2].result = 'Research unavailable';
      }
    } else {
      if (!isPerplexityConfigured()) {
        stages[2].status = 'skipped';
        stages[2].result = 'Perplexity API key not configured';
        console.log('[ResearchOrchestrator] Perplexity research skipped: API key not configured');
      } else {
        stages[2].status = 'skipped';
        stages[2].result = 'Research disabled by options';
      }
    }
  })();

  // Grok Live Search: independent of Perplexity — runs for news template whenever Grok is available
  // Set up the stage slot synchronously before Promise.all so index is stable
  let grokTask: Promise<void> = Promise.resolve();
  if (templateCategory === 'news') {
    const grokStage: ResearchStage = { name: 'Grok Social Pulse', status: 'pending' };
    stages.push(grokStage);
    const grokStageIdx = stages.length - 1;

    grokTask = (async () => {
      if (isGrokAvailable()) {
        stages[grokStageIdx].status = 'running';
        stages[grokStageIdx].startedAt = Date.now();
        try {
          console.log('[ResearchOrchestrator] Fetching Grok live social context for news topic...');
          const timeframeLabel = options.timeFrame === 'day' || options.timeFrame === 'past24h' || options.timeFrame === '24h'
            ? 'past 24 hours'
            : options.timeFrame === 'week' || options.timeFrame === 'pastWeek'
              ? 'past week'
              : 'past 24 hours';
          const grokResult = await getNewsContextFromGrok(topic, timeframeLabel);
          if (grokResult.content) {
            context.grokSocialContext = {
              content: grokResult.content,
              citations: grokResult.citations
            };
            stages[grokStageIdx].status = 'completed';
            stages[grokStageIdx].completedAt = Date.now();
            stages[grokStageIdx].result = `${grokResult.content.length} chars, ${grokResult.citations.length} citations`;
            console.log(`[ResearchOrchestrator] Grok social context added: ${grokResult.content.length} chars, ${grokResult.citations.length} citations`);
          } else {
            stages[grokStageIdx].status = 'completed';
            stages[grokStageIdx].completedAt = Date.now();
            stages[grokStageIdx].result = 'No social context returned';
          }
        } catch (error) {
          console.error('[ResearchOrchestrator] Grok social context failed (non-critical):', error);
          stages[grokStageIdx].status = 'failed';
          stages[grokStageIdx].result = 'Grok live search unavailable';
        }
      } else {
        stages[grokStageIdx].status = 'skipped';
        stages[grokStageIdx].result = 'XAI_API_KEY not configured';
      }
    })();
  }

  await Promise.all([ingestionTask, perplexityTask, grokTask]);
  
  stages[3].status = 'running';
  stages[3].startedAt = Date.now();
  
  const contextParts: string[] = [];
  
  contextParts.push(`TOPIC: ${cleanTopic || topic}`);
  contextParts.push(`TEMPLATE: ${templateCategory}`);
  contextParts.push(`TARGET DURATION: ${targetDurationMinutes} minutes`);
  contextParts.push('');
  
  if (context.ingestedContent.length > 0) {
    contextParts.push('=== INGESTED SOURCES ===');
    for (const content of context.ingestedContent) {
      contextParts.push(`\n--- ${content.title} (${content.sourceType}) ---`);
      contextParts.push(`[Extraction: ${content.extractionMethod}, ${content.wordCount} words]`);
      contextParts.push(content.transcript);
      if (content.citations && content.citations.length > 0) {
        contextParts.push(`Sources: ${content.citations.join(', ')}`);
      }
    }
    contextParts.push('');
  }
  
  if (context.perplexityResearch) {
    contextParts.push('=== RESEARCH & CONTEXT ===');
    contextParts.push(context.perplexityResearch.content);
    if (context.perplexityResearch.citations.length > 0) {
      contextParts.push('\nSources:');
      context.perplexityResearch.citations.forEach((citation, i) => {
        contextParts.push(`[${i + 1}] ${citation}`);
      });
    }
    contextParts.push('');
  }

  if (context.grokSocialContext?.content) {
    contextParts.push('=== SOCIAL PULSE FROM X & WEB (Grok Live Search) ===');
    contextParts.push(context.grokSocialContext.content);
    if (context.grokSocialContext.citations.length > 0) {
      contextParts.push('\nSocial Sources:');
      context.grokSocialContext.citations.forEach((citation, i) => {
        contextParts.push(`[S${i + 1}] ${citation}`);
      });
    }
    contextParts.push('');
  }
  
  context.compiledContext = contextParts.join('\n');
  context.totalWordCount = context.compiledContext.split(/\s+/).length;
  context.researchComplete = true;
  
  stages[3].status = 'completed';
  stages[3].completedAt = Date.now();
  stages[3].result = `${context.totalWordCount} total words compiled`;
  
  console.log(`[ResearchOrchestrator] Research complete: ${context.totalWordCount} words from ${context.ingestedContent.length} ingested + research`);
  
  return context;
}

export function getResearchCacheKey(topic: string, templateCategory: string, timeFrame?: string, locationCity?: string | null): string {
  return crypto
    .createHash('sha256')
    .update(`${topic}|${templateCategory}|${timeFrame || ''}|${locationCity || ''}`)
    .digest('hex')
    .substring(0, 16);
}

const researchCache = new Map<string, { context: ResearchContext; cachedAt: number }>();
const RESEARCH_CACHE_TTL = 30 * 60 * 1000;

export async function orchestrateResearchCached(
  topic: string,
  templateCategory: string,
  options: ResearchOptions = {}
): Promise<ResearchContext> {
  const cacheKey = getResearchCacheKey(topic, templateCategory, options.timeFrame, options.locationEnabled ? options.locationCity : undefined);
  const cached = researchCache.get(cacheKey);
  
  if (cached && Date.now() - cached.cachedAt < RESEARCH_CACHE_TTL) {
    console.log(`[ResearchOrchestrator] Cache HIT for: ${cacheKey}`);
    return cached.context;
  }
  
  console.log(`[ResearchOrchestrator] Cache MISS for: ${cacheKey}`);
  const context = await orchestrateResearch(topic, templateCategory, options);
  
  researchCache.set(cacheKey, {
    context,
    cachedAt: Date.now()
  });
  
  if (researchCache.size > 50) {
    const oldest = Array.from(researchCache.entries())
      .sort((a, b) => a[1].cachedAt - b[1].cachedAt)[0];
    researchCache.delete(oldest[0]);
  }
  
  return context;
}

export function clearResearchCache(): void {
  researchCache.clear();
  console.log('[ResearchOrchestrator] Cache cleared');
}

export function getResearchCacheStats(): { size: number; keys: string[] } {
  return {
    size: researchCache.size,
    keys: Array.from(researchCache.keys())
  };
}

export function getAvailableServices(): {
  perplexity: boolean;
  grok: boolean;
  contentIngestion: boolean;
} {
  return {
    perplexity: isPerplexityConfigured(),
    grok: isGrokAvailable(),
    contentIngestion: true
  };
}
