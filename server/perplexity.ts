import type { GenerationParams } from '@shared/schema';

interface PerplexityMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface PerplexityResponse {
  id: string;
  model: string;
  object: string;
  created: number;
  citations: string[];
  choices: Array<{
    index: number;
    finish_reason: string;
    message: {
      role: string;
      content: string;
    };
    delta: {
      role: string;
      content: string;
    };
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface ResearchResult {
  content: string;
  citations: string[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface ExpertPersona {
  role: string;
  approach: string;
}

/**
 * Auto-detect the most appropriate expert persona based on topic keywords
 * This ensures research is conducted through the right analytical lens
 */
function detectExpertPersona(topic: string): ExpertPersona {
  const topicLower = topic.toLowerCase();
  
  // Investment/Finance topics
  if (topicLower.match(/\b(invest|stock|crypto|bitcoin|forex|trading|portfolio|dividend|bond|etf|real estate|property|capital|growth|yield|roi|market|financial|wealth|retirement|401k|ira)\b/)) {
    return {
      role: 'Senior Investment Analyst & Financial Strategist',
      approach: 'Data-driven analysis with risk/reward assessment, market trends, valuation metrics, and actionable investment insights. Apply fundamental and technical analysis where relevant.'
    };
  }
  
  // Technology topics
  if (topicLower.match(/\b(ai|artificial intelligence|machine learning|software|programming|tech|startup|app|saas|cloud|blockchain|cybersecurity|data science|automation|robotics)\b/)) {
    return {
      role: 'Technology Industry Analyst & Innovation Expert',
      approach: 'Technical feasibility analysis, market adoption curves, competitive landscape, and innovation trajectory. Balance technical depth with practical applications.'
    };
  }
  
  // Health/Medical topics
  if (topicLower.match(/\b(health|medical|disease|treatment|therapy|doctor|medicine|pharmaceutical|drug|clinical|patient|diagnosis|symptom|wellness|nutrition|diet|fitness|mental health)\b/)) {
    return {
      role: 'Healthcare Research Analyst & Medical Information Specialist',
      approach: 'Evidence-based analysis prioritizing peer-reviewed research, clinical trial data, and expert medical consensus. Clearly distinguish established medicine from emerging treatments.'
    };
  }
  
  // Business/Strategy topics
  if (topicLower.match(/\b(business|strategy|management|leadership|startup|entrepreneur|company|ceo|marketing|sales|growth|revenue|profit|customer|brand|acquisition|merger)\b/)) {
    return {
      role: 'Business Strategy Consultant & Market Analyst',
      approach: 'Strategic framework analysis with competitive positioning, market dynamics, and operational insights. Apply proven business models and case study comparisons.'
    };
  }
  
  // Science/Research topics
  if (topicLower.match(/\b(science|research|study|experiment|physics|chemistry|biology|climate|environment|space|quantum|genetics|evolution|discovery)\b/)) {
    return {
      role: 'Science Correspondent & Research Analyst',
      approach: 'Rigorous analysis of scientific methodology, peer-reviewed findings, and research consensus. Explain complex concepts accessibly while maintaining accuracy.'
    };
  }
  
  // Politics/Policy topics
  if (topicLower.match(/\b(politics|policy|government|election|congress|senate|president|legislation|law|regulation|democracy|vote|campaign|party)\b/)) {
    return {
      role: 'Political Analyst & Policy Expert',
      approach: 'Non-partisan analysis of political dynamics, policy implications, and stakeholder perspectives. Present multiple viewpoints and historical context.'
    };
  }
  
  // Education/Learning topics
  if (topicLower.match(/\b(education|learn|teach|school|university|student|course|training|skill|knowledge|study|academic|curriculum)\b/)) {
    return {
      role: 'Education Specialist & Learning Expert',
      approach: 'Pedagogical analysis with focus on learning outcomes, best practices, and practical application. Balance theory with actionable learning strategies.'
    };
  }
  
  // Default: Generalist Expert
  return {
    role: 'Senior Research Analyst & Subject Matter Expert',
    approach: 'Comprehensive multi-disciplinary analysis with emphasis on verified facts, expert perspectives, and practical applications. Apply critical thinking and source evaluation rigorously.'
  };
}

export async function gatherRealTimeContent(
  topic: string,
  params: GenerationParams,
  searchDepth?: 'low' | 'medium' | 'high'
): Promise<ResearchResult> {
  // Normalise aliases and derive depth when not explicitly provided
  const deepResearchCategories = ['documents', 'document', 'research'];
  const effectiveDepth: 'low' | 'medium' | 'high' = searchDepth
    ?? (deepResearchCategories.includes(params.templateCategory || '') ? 'high' : 'medium');
  const apiKey = process.env.PERPLEXITY_API_KEY;
  
  if (!apiKey) {
    console.warn('PERPLEXITY_API_KEY not found, skipping real-time content sourcing');
    return {
      content: '',
      citations: [],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    };
  }

  const currentDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  // Map timeframe to search_recency_filter
  // Supports both legacy format (24h, week) and new TimeFrame format (past24h, pastWeek, next24h, etc.)
  const recencyFilterMap: Record<string, string> = {
    '24h': 'day',
    'week': 'week',
    'month': 'month',
    'year': 'year',
    'all': 'year',
    'past24h': 'day',
    'pastWeek': 'week',
    'pastMonth': 'month',
    'pastYear': 'year',
    'allTime': 'year',
    'next24h': 'month',
    'nextWeek': 'month',
    'nextMonth': 'month',
    'nextYear': 'year'
  };
  
  const searchRecency = recencyFilterMap[params.timeFrame || 'month'] || 'month';
  
  const isFutureTimeframe = ['next24h', 'nextWeek', 'nextMonth', 'nextYear'].includes(params.timeFrame || '');
  const isAllTime = ['all', 'allTime'].includes(params.timeFrame || '');
  
  // Convert TimeFrame to natural language time periods
  const timeframeToNaturalLanguage: Record<string, string> = {
    '24h': '24 hours',
    'week': 'week',
    'month': 'month',
    'year': 'year',
    'all': 'all available time',
    'allTime': 'all available time',
    'past24h': '24 hours',
    'pastWeek': 'week',
    'pastMonth': 'month',
    'pastYear': 'year',
    'next24h': '24 hours',
    'nextWeek': 'week',
    'nextMonth': 'month',
    'nextYear': 'year'
  };
  const naturalTimeframe = timeframeToNaturalLanguage[params.timeFrame || 'month'] || 'month';
  const isPastTimeframe = ['24h', 'week', 'month', 'year', 'past24h', 'pastWeek', 'pastMonth', 'pastYear'].includes(params.timeFrame || '');
  
  // Compute explicit date range for future timeframes
  const now = new Date();
  const currentDateISO = now.toISOString().split('T')[0];
  let futureEndDate = '';
  if (isFutureTimeframe) {
    switch (params.timeFrame) {
      case 'next24h':
        futureEndDate = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        break;
      case 'nextWeek':
        futureEndDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        break;
      case 'nextMonth':
        const nextMonth = new Date(now);
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        futureEndDate = nextMonth.toISOString().split('T')[0];
        break;
      case 'nextYear':
        const nextYear = new Date(now);
        nextYear.setFullYear(nextYear.getFullYear() + 1);
        futureEndDate = nextYear.toISOString().split('T')[0];
        break;
    }
  }
  const futureDateRange = isFutureTimeframe ? `between ${currentDateISO} and ${futureEndDate}` : '';

  // Determine template-specific research focus
  const templateCategory = params.templateCategory || 'custom';
  let researchPrompt = '';
  
  // Build location context string if enabled
  const locationContext = params.locationEnabled && params.locationCity
    ? `\n\nLocation Context: The listener is based in ${params.locationCity}. When relevant, include local news, weather conditions, nearby events, local businesses, regional developments, and location-specific information that would be interesting to someone in ${params.locationCity}.`
    : '';
  
  // Determine tense for events (past for recap, future for preview/guide)
  const isEventRecap = templateCategory === 'events' && params.eventFormat === 'recap';
  const isEventPreview = templateCategory === 'events' && (params.eventFormat === 'preview' || params.eventFormat === 'guide');
  
  if (templateCategory === 'news') {
    // Calculate explicit date cutoffs for stricter time enforcement
    const nowDate = new Date();
    const cutoffDate = new Date(nowDate);
    let newsTimeframeText: string;
    let strictDateCutoff: string = '';
    
    // Get current time with hours for precise recency
    const currentTimeWithHours = nowDate.toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short'
    });
    
    if (isAllTime) {
      newsTimeframeText = `Gather information from all available time periods, prioritizing the most significant and impactful developments`;
    } else if (isFutureTimeframe) {
      newsTimeframeText = `Focus on UPCOMING news developments, scheduled announcements, and anticipated events ${futureDateRange}. Include press releases, scheduled hearings, planned legislation, product launches, and anticipated developments.`;
    } else {
      // Calculate explicit date cutoff based on timeframe
      if (params.timeFrame === '24h' || params.timeFrame === 'past24h') {
        cutoffDate.setHours(cutoffDate.getHours() - 24);
        strictDateCutoff = cutoffDate.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
        newsTimeframeText = `BREAKING NEWS PRIORITY: Prioritize news published in the LAST 24 HOURS (after ${strictDateCutoff}). 
PRIORITY ORDER: 
1. Stories published in the last 6 hours (HIGHEST priority)
2. Stories published in the last 12 hours (HIGH priority)  
3. Stories published in the last 24 hours (acceptable)
4. FALLBACK ONLY: If NO stories exist from the past 24 hours, you MAY include 2-4 key headlines from the past 7 days as a "weekly recap" section.
Mark any weekly recap content clearly as "From this week:" to distinguish from breaking news.`;
      } else if (params.timeFrame === 'week' || params.timeFrame === 'pastWeek') {
        cutoffDate.setDate(cutoffDate.getDate() - 7);
        strictDateCutoff = cutoffDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        newsTimeframeText = `STRICT REQUIREMENT: ONLY include news from the past 7 days (since ${strictDateCutoff}). DO NOT include any news older than one week.`;
      } else if (params.timeFrame === 'month' || params.timeFrame === 'pastMonth') {
        cutoffDate.setMonth(cutoffDate.getMonth() - 1);
        strictDateCutoff = cutoffDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        newsTimeframeText = `Focus on developments from the past month (since ${strictDateCutoff}). Prioritize more recent news.`;
      } else {
        newsTimeframeText = `Focus on developments within the past ${naturalTimeframe}`;
      }
    }
    researchPrompt = `CURRENT DATE AND TIME: ${currentTimeWithHours}

🚨 BREAKING NEWS SEARCH: Gather ONLY the LATEST news about: ${topic}${locationContext}

=== CRITICAL RECENCY REQUIREMENTS ===
${newsTimeframeText}

=== SOURCE PRIORITY (for breaking news) ===
1. Wire services: AP, Reuters, AFP (most up-to-date)
2. Major news outlets: BBC, CNN, NYT, Guardian, WSJ, Bloomberg
3. Specialized news: Industry-specific outlets relevant to the topic
4. Social media: Verified journalist tweets, official announcements
5. Press releases: Official statements from involved parties

=== VERIFICATION REQUIREMENTS ===
- CHECK PUBLICATION TIMESTAMPS: Every story must include when it was published
- CROSS-VERIFY: Major claims need 2+ independent sources
- REJECT STALE NEWS: If a story's timestamp is older than allowed, DO NOT include it
- PREFER LIVE UPDATES: Prioritize stories marked as "breaking", "just in", "developing", "updated"

=== CONTENT REQUIREMENTS ===
- Include: Key facts, latest developments, expert quotes, official statements
- Balance: Multiple viewpoints when applicable
- Flag: Clearly mark unconfirmed reports vs verified facts
${params.locationEnabled && params.locationCity ? `- Local angle: Include impact on ${params.locationCity} if relevant` : ''}

=== OUTPUT FORMAT ===
For each major story, note:
- Publication time/date of the source
- Source credibility (wire service, major outlet, official statement, etc.)

=== FALLBACK FOR LIMITED BREAKING NEWS ===
If insufficient breaking news exists in the last 24 hours for a topic, DO NOT just say "no news available". Instead:
1. State briefly: "No major breaking news on [topic] in the past 24 hours."
2. THEN provide a "WEEKLY RECAP" section with 2-4 key headlines/developments from the PAST 7 DAYS
3. Format: "However, here's what happened this week on [topic]: [2-4 bullet points of key developments from past week]"
This ensures the coverage remains engaging and informative even when breaking news is sparse.`;
  } else if (templateCategory === 'sports') {
    // Calculate explicit date cutoffs for stricter time enforcement
    const sportsNowDate = new Date();
    const sportsCutoffDate = new Date(sportsNowDate);
    let sportsTimeframeText: string;
    let sportsDateCutoff: string = '';
    
    if (isAllTime) {
      sportsTimeframeText = `Gather information from all available time periods, focusing on the most significant games, stats, and storylines`;
    } else if (isFutureTimeframe) {
      sportsTimeframeText = `Focus on UPCOMING games, matches, and sporting events scheduled ${futureDateRange}. Include scheduled matchups, player availability, injury updates, predictions, and anticipated storylines.`;
    } else {
      // Calculate explicit date cutoff based on timeframe
      if (params.timeFrame === '24h' || params.timeFrame === 'past24h') {
        sportsCutoffDate.setDate(sportsCutoffDate.getDate() - 1);
        sportsDateCutoff = sportsCutoffDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        sportsTimeframeText = `PRIORITY: Focus on sports news and game results from the LAST 24 HOURS (since ${sportsDateCutoff}). Prioritize games played today/yesterday, breaking news, and latest updates. FALLBACK: If NO games or major updates exist from the past 24 hours, include 2-4 key developments from the past 7 days as a "this week" recap section.`;
      } else if (params.timeFrame === 'week' || params.timeFrame === 'pastWeek') {
        sportsCutoffDate.setDate(sportsCutoffDate.getDate() - 7);
        sportsDateCutoff = sportsCutoffDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        sportsTimeframeText = `STRICT REQUIREMENT: ONLY include sports from the past 7 days (since ${sportsDateCutoff}). Focus on this week's games, standings changes, and recent developments.`;
      } else if (params.timeFrame === 'month' || params.timeFrame === 'pastMonth') {
        sportsCutoffDate.setMonth(sportsCutoffDate.getMonth() - 1);
        sportsDateCutoff = sportsCutoffDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        sportsTimeframeText = `Focus on sports developments from the past month (since ${sportsDateCutoff}). Prioritize more recent games and news.`;
      } else {
        sportsTimeframeText = `Focus on recent ${naturalTimeframe}`;
      }
    }
    researchPrompt = `TODAY'S DATE: ${currentDate}

Gather the latest sports information about: ${topic}${locationContext}

Research Requirements:
- Source Distribution: 30% major sports media (ESPN, The Athletic, SI), 20% team/league official sources, 20% social media/fan discussions, 15% player/coach quotes, 15% statistical databases
- TIMEFRAME ENFORCEMENT: ${sportsTimeframeText}
- VERIFY DATES: Confirm each game/event occurred within the required timeframe. Include game dates in your research.
- Include: Game results, player stats, injury reports, team standings, playoff implications, expert analysis${params.locationEnabled && params.locationCity ? `, local team updates and fan events in ${params.locationCity}` : ''}
- Cross-verify scores and statistics from multiple sources
- Include fan reactions and trending storylines

=== FALLBACK FOR LIMITED SPORTS NEWS ===
If no games or major sports news exists in the last 24 hours for this topic, DO NOT just say "no news available". Instead:
1. State briefly: "No games or major updates on [team/sport] in the past 24 hours."
2. THEN provide a "THIS WEEK IN [SPORT/TEAM]" section with 2-4 key developments from the PAST 7 DAYS
3. Format: "However, here's what happened this week: [2-4 bullet points of recent games, trades, injuries, or storylines]"
This ensures sports coverage remains engaging even during quiet news periods.

Provide comprehensive sports research with citations, noting dates of games and events.`;
  } else if (templateCategory === 'events') {
    if (isEventRecap) {
      // Event recaps should only use past timeframes; guard against future timeframe selection
      let recapTimeframeText: string;
      if (isAllTime) {
        recapTimeframeText = `Coverage from all available time periods, prioritizing the most significant moments`;
      } else if (isFutureTimeframe) {
        console.warn(`[Perplexity] Event recap requested with future timeframe '${params.timeFrame}'; falling back to 'past month'`);
        recapTimeframeText = `Coverage from the past month`; // Fallback for invalid future+recap combo
      } else {
        recapTimeframeText = `Coverage from the past ${naturalTimeframe}`;
      }
      researchPrompt = `As of ${currentDate}, gather information about what happened at: ${topic}${locationContext}

Research Requirements:
- Focus: Post-event coverage, highlights, outcomes, attendance, attendee reactions, and impact
- Source Distribution: 30% news outlets, 25% social media/Reddit discussions, 20% event coverage sites, 15% official event sources, 10% attendee reviews/comments
- Timeframe: ${recapTimeframeText}
- Include: Key highlights, memorable moments, attendee feedback, media reviews, interesting statistics, interesting stories from attendees
- Cross-verify major claims with multiple sources
- Include diverse perspectives (critics vs fans, different attendee experiences)

Provide comprehensive post-event analysis with citations.`;
    } else if (isEventPreview) {
      // Event previews are inherently forward-looking
      let timeframeText: string;
      if (isAllTime) {
        timeframeText = `Gather all available information about upcoming dates, schedule, and expectations`;
      } else if (isFutureTimeframe && futureDateRange) {
        timeframeText = `Find information about events scheduled ${futureDateRange}`;
      } else if (isPastTimeframe) {
        console.warn(`[Perplexity] Event preview requested with past timeframe '${params.timeFrame}'; falling back to 'next month'`);
        timeframeText = `Current information about what's coming in the next month`;
      } else {
        timeframeText = `Current information about what's coming in the next ${naturalTimeframe}`;
      }
      researchPrompt = `As of ${currentDate}, gather information about the upcoming event: ${topic}${locationContext}

Research Requirements:
- Focus: Pre-event details, schedule, attractions, expectations, attendee anticipation, and practical information
- Source Distribution: 30% official event sources, 25% event planning sites, 20% social media discussions, 15% news coverage, 10% attendee forums/reviews
- Timeframe: ${timeframeText}
- Include: Event schedule, lineup/speakers, tickets/pricing, venue details, expected attendance, what to expect, parking/logistics, practical tips, expert predictions
- Cross-verify key details with official sources
- Include attendee expectations and community buzz

Provide comprehensive pre-event guide with citations.`;
    }
  } else if (templateCategory === 'documents') {
    researchPrompt = `Analyze and gather contextual information about: ${topic}${locationContext}

Research Requirements:
- Source Distribution: 30% academic sources, 20% official documentation, 20% expert analysis, 15% related news, 15% community discussions
- Cross-reference with authoritative sources to verify accuracy
- Provide historical context and recent developments
- Include expert interpretations and practical applications

Provide comprehensive analysis with citations.`;
  } else {
    // Custom topics, events, storytelling, teachme, medical
    // ENHANCED: Auto-detect expert persona and apply deep analysis framework
    // Calculate explicit date cutoffs for stricter time enforcement
    const customNowDate = new Date();
    const customCutoffDate = new Date(customNowDate);
    let customDateCutoff: string = '';
    
    let timeframeGuidance: string;
    if (isAllTime) {
      timeframeGuidance = `Gather information from all available time periods, prioritizing the most relevant and impactful content`;
    } else if (isFutureTimeframe) {
      timeframeGuidance = `Focus on UPCOMING events, scheduled announcements, planned releases, and anticipated developments scheduled ${futureDateRange}. Look for event schedules, release dates, and forward-looking announcements within this date range.`;
    } else {
      // Calculate explicit date cutoff based on timeframe
      if (params.timeFrame === '24h' || params.timeFrame === 'past24h') {
        customCutoffDate.setDate(customCutoffDate.getDate() - 1);
        customDateCutoff = customCutoffDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        timeframeGuidance = `STRICT TIMEFRAME: ONLY use information from the LAST 24 HOURS (since ${customDateCutoff}). Prioritize breaking news and latest developments. REJECT sources older than 24 hours.`;
      } else if (params.timeFrame === 'week' || params.timeFrame === 'pastWeek') {
        customCutoffDate.setDate(customCutoffDate.getDate() - 7);
        customDateCutoff = customCutoffDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        timeframeGuidance = `STRICT TIMEFRAME: ONLY use information from the past 7 days (since ${customDateCutoff}). Focus on this week's developments.`;
      } else if (params.timeFrame === 'month' || params.timeFrame === 'pastMonth') {
        customCutoffDate.setMonth(customCutoffDate.getMonth() - 1);
        customDateCutoff = customCutoffDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        timeframeGuidance = `Focus on information from the past month (since ${customDateCutoff}). Prioritize recent content.`;
      } else {
        timeframeGuidance = `Prioritize recent information from past ${naturalTimeframe}`;
      }
    }
    
    // Auto-detect expert persona based on topic keywords
    const expertPersona = detectExpertPersona(topic);
    
    researchPrompt = `As of ${currentDate}, conduct DEEP ANALYSIS research about: ${topic}${locationContext}

=== EXPERT ANALYSIS FRAMEWORK ===
You are acting as: ${expertPersona.role}
Apply this lens: ${expertPersona.approach}

=== MULTI-DIMENSIONAL RESEARCH ===
Break down this topic into these analytical dimensions:
1. FACTUAL FOUNDATION: What are the verified facts, data points, and statistics?
2. EXPERT PERSPECTIVES: What do leading experts and authorities say?
3. CONTRARIAN VIEWS: What are the opposing viewpoints or risks?
4. PRACTICAL IMPLICATIONS: What are the real-world applications and actionable insights?
5. FUTURE OUTLOOK: What are the predictions, trends, and anticipated developments?

=== RESEARCH REQUIREMENTS ===
- Source Distribution: 25% academic/research, 25% industry experts, 20% news/media, 15% official sources, 15% alternative/contrarian views
- Timeframe: ${timeframeGuidance}
- Cross-verify: Each major claim needs 2-3 independent sources
- Include: Key facts, statistics, expert quotes, case studies, data visualizations${params.locationEnabled && params.locationCity ? `, local context in ${params.locationCity}` : ''}

=== CRITICAL THINKING LAYER ===
- Flag SPECULATION vs CONFIRMED FACTS clearly
- Note source credibility (peer-reviewed > news > opinion)
- Identify data gaps or areas of uncertainty
- Highlight consensus vs controversial claims

=== MULTI-PERSPECTIVE ANALYSIS ===
Present balanced analysis including:
- Bull Case: Optimistic scenarios and opportunities
- Bear Case: Risks, challenges, and potential downsides
- Neutral Assessment: Most likely outcomes based on evidence
- Expert Disagreements: Where authorities differ and why

Provide comprehensive, actionable research with clear citations and source credibility notes.`;
  }

  try {
    // Enhanced system prompt for deeper analysis
    const enhancedSystemPrompt = templateCategory === 'custom' || templateCategory === 'teachme' || templateCategory === 'medical'
      ? `You are a world-class research analyst with deep expertise across multiple domains. Your approach:

1. CHAIN-OF-THOUGHT ANALYSIS: Break down complex topics systematically before drawing conclusions
2. EXPERT LENS: Apply domain-specific analytical frameworks appropriate to the subject matter
3. CRITICAL EVALUATION: Distinguish between established facts, emerging consensus, and speculation
4. MULTI-PERSPECTIVE: Present bull/bear cases and expert disagreements objectively
5. ACTIONABLE INSIGHTS: Prioritize practical, applicable information over abstract theory

Gather information from diverse, credible sources. Cross-verify major claims. Flag uncertainty and data gaps. Provide comprehensive summaries with clear source attributions.`
      : 'You are a meticulous, unbiased content curator specializing in hyper-current, fact-checked research. Gather information from diverse sources and provide comprehensive summaries with clear citations.';
    
    const messages: PerplexityMessage[] = [
      {
        role: 'system',
        content: enhancedSystemPrompt
      },
      {
        role: 'user',
        content: researchPrompt
      }
    ];

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'sonar-pro',
        messages,
        temperature: 0.2,
        top_p: 0.9,
        search_recency_filter: searchRecency,
        web_search_options: { search_context_size: effectiveDepth },
        return_images: false,
        return_related_questions: false,
        stream: false,
        presence_penalty: 0,
        frequency_penalty: 1
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Perplexity API error:', response.status, errorText);
      return {
        content: '',
        citations: [],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      };
    }

    const data: PerplexityResponse = await response.json();
    
    return {
      content: data.choices[0]?.message?.content || '',
      citations: data.citations || [],
      usage: data.usage
    };
  } catch (error) {
    console.error('Error calling Perplexity API:', error);
    return {
      content: '',
      citations: [],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    };
  }
}

export type TrendingCategory = 'all' | 'tech' | 'sports' | 'politics' | 'entertainment' | 'science' | 'business' | 'health' | 'world' | 'culture' | 'crime';

export interface TrendingTopic {
  title: string;
  summary: string;
  category: string;
  relevanceScore: number;
  // ISO 8601 timestamp of when the underlying story was published, if the
  // model returned one. Missing means "unknown" — do not drop the topic.
  publishedAt?: string;
}

async function fetchTrendingTopicsFromPerplexity(
  prompt: string,
  searchPhase: string = 'initial'
): Promise<TrendingTopic[]> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return [];

  try {
    const messages: PerplexityMessage[] = [
      {
        role: 'system',
        content: 'You are a real-time news analyst. Your ONLY job is to identify stories that broke within the LAST 24 HOURS. You must STRICTLY REJECT any story older than 24 hours. If a story is more than a day old, do not include it. Focus on breaking news, fresh developments, and stories that are trending RIGHT NOW.'
      },
      {
        role: 'user',
        content: prompt
      }
    ];

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'sonar-pro',
        messages,
        temperature: 0.3,
        top_p: 0.9,
        search_recency_filter: 'day',
        web_search_options: { search_context_size: 'low' },
        return_images: false,
        return_related_questions: false,
        stream: false,
        presence_penalty: 0,
        frequency_penalty: 1
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Perplexity] API error (${searchPhase}):`, response.status, errorText);
      const snippet = errorText ? ` — ${errorText.slice(0, 200)}` : '';
      throw new Error(`Perplexity API ${response.status}${snippet}`);
    }

    const data: PerplexityResponse = await response.json();
    const content = data.choices[0]?.message?.content || '';
    
    console.log(`[Perplexity] ${searchPhase} - Response length:`, content.length);
    console.log(`[Perplexity] ${searchPhase} - First 300 chars:`, content.substring(0, 300));
    
    // Parse the response into structured trending topics. The model is
    // instructed to put each marker on its own line, but in practice Perplexity
    // often collapses them onto a single line per topic
    // (e.g. `1. [TOPIC] X [SUMMARY] Y [CATEGORY] z [PUBLISHED] 2025-...`).
    // Splitting on `[TOPIC]` first and then regex-extracting each field per
    // chunk handles both formats robustly.
    const topics: TrendingTopic[] = [];

    // Strip ASCII/unicode whitespace around markers so the regexes match even
    // when the model crams them with no surrounding space.
    const blocks = content.split(/\[TOPIC\]/i).slice(1);

    const extractField = (block: string, marker: string): string => {
      // Capture everything up to the next known marker, the next numbered list
      // item separated by a blank line (e.g. `\n\n2. `), or end of block. We
      // need the numbered-item terminator because `content.split(/\[TOPIC\]/i)`
      // leaves the trailing `\n\n2.` of the next item glued onto the previous
      // block — without it, the [PUBLISHED] regex would capture trailing junk
      // and `new Date()` would fail. Requiring a *blank* line before the
      // numbered item avoids prematurely truncating summaries that legitimately
      // contain a line starting with a number (e.g. inline "2) ...").
      const re = new RegExp(
        `\\[${marker}\\]([\\s\\S]*?)(?=\\[(?:TOPIC|SUMMARY|CATEGORY|PUBLISHED)\\]|\\n\\s*\\n\\s*\\d+[.)]\\s|$)`,
        'i'
      );
      const m = block.match(re);
      return (m?.[1] || '').trim();
    };

    for (const rawBlock of blocks) {
      const block = rawBlock;

      // Title is whatever sits between [TOPIC] and the first inner marker.
      const titleMatch = block.match(
        /^([\s\S]*?)(?=\[(?:SUMMARY|CATEGORY|PUBLISHED)\]|$)/i
      );
      const title = (titleMatch?.[1] || '')
        .replace(/^\s*\d+[.)]\s*/, '') // strip leading "1. " / "1) "
        .replace(/^[*_]+|[*_]+$/g, '')
        .trim();

      const summary = extractField(block, 'SUMMARY')
        .replace(/^[*_]+|[*_]+$/g, '')
        .trim();
      const category = extractField(block, 'CATEGORY').toLowerCase();
      const rawPublished = extractField(block, 'PUBLISHED');

      let publishedAt: string | undefined;
      // Accept ISO-ish strings; ignore obvious non-dates like "unknown" / "N/A".
      if (rawPublished && !/^(unknown|n\/a|na|none|tbd)$/i.test(rawPublished)) {
        const parsed = new Date(rawPublished);
        if (!isNaN(parsed.getTime())) {
          publishedAt = parsed.toISOString();
        }
      }

      // Require at least title + summary; fill category from a sensible
      // default when the model omits it (the freshness filter still applies).
      if (title && summary) {
        topics.push({
          title,
          summary,
          category: category || 'general',
          relevanceScore: 0.9,
          publishedAt,
        });
      }
    }
    
    // Second try: Look for markdown bold titles with numbered lists
    if (topics.length === 0 && content.length > 100) {
      console.log(`[Perplexity] ${searchPhase} - Trying markdown parsing...`);
      
      const markdownPattern = /(\d+)\.\s*\*{0,2}([^*\n:]+)\*{0,2}[:\s]*\n?([^\n]*)/g;
      let match;
      // Strips any leftover [TOPIC]/[SUMMARY]/[CATEGORY]/[PUBLISHED] markers
      // (and surrounding whitespace) from a string. Used so the markdown
      // fallback doesn't leak the structured-format markers into UI strings
      // when Perplexity mixes the two formats.
      const stripMarkers = (s: string): string =>
        s
          .replace(/\[(?:TOPIC|SUMMARY|CATEGORY|PUBLISHED)\]\s*/gi, '')
          .replace(/\s{2,}/g, ' ')
          .trim();

      while ((match = markdownPattern.exec(content)) !== null) {
        const title = stripMarkers(match[2].trim().replace(/\*+/g, ''));
        let summary = stripMarkers(match[3].trim());

        if (title.toLowerCase().includes("don't have") ||
            title.toLowerCase().includes("search results") ||
            title.toLowerCase().includes("available in") ||
            title.length < 15) {
          continue;
        }
        
        if (!summary || summary.length < 20) {
          const titleIndex = content.indexOf(match[0]);
          const afterTitle = content.substring(titleIndex + match[0].length);
          const summaryMatch = afterTitle.match(/^[^\d\n][^\n]+/);
          if (summaryMatch) {
            summary = stripMarkers(summaryMatch[0].trim());
          }
        }
        
        if (title && title.length >= 15 && title.length < 200) {
          topics.push({
            title,
            summary: summary && summary.length > 10 ? summary : title,
            category: 'general',
            relevanceScore: 0.85
          });
        }
        if (topics.length >= 10) break;
      }
    }
    
    return topics;
  } catch (error) {
    console.error(`[Perplexity] Error in ${searchPhase}:`, error);
    const message = error instanceof Error ? error.message : String(error);
    // Rethrow provider HTTP errors (quota / rate-limit / auth / 5xx) so the
    // cache layer can surface them to the UI. Only swallow non-provider
    // parse/transport hiccups as an empty result.
    if (message.startsWith('Perplexity API ')) {
      throw error;
    }
    return [];
  }
}

export async function getTrendingTopics(category: TrendingCategory = 'all', location?: string): Promise<TrendingTopic[]> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  
  if (!apiKey) {
    console.warn('PERPLEXITY_API_KEY not found, returning empty trending topics');
    return [];
  }

  const nowDate = new Date();
  const currentDate = nowDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  
  // Calculate yesterday's date for explicit cutoff
  const yesterday = new Date(nowDate);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayDate = yesterday.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  
  // Current time for breaking news priority
  const currentTimeFormatted = nowDate.toLocaleString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  });

  const locationContext = location ? ` Focus on news relevant to ${location} and the surrounding region.` : '';
  
  // Enhanced recency requirements for all categories
  const recencyEnforcement = `
🚨 STRICT RECENCY: Current time is ${currentTimeFormatted} on ${currentDate}.
- ONLY include stories published TODAY (${currentDate}) or YESTERDAY (${yesterdayDate})
- PRIORITIZE: Stories from the last 6-12 hours (most valuable)
- CHECK timestamps on every source before including
- ABSOLUTELY REJECT any story published before ${yesterdayDate}`;

  const categoryPrompts: Record<TrendingCategory, string> = {
    all: `${recencyEnforcement}
What are the top 10 BREAKING/TRENDING news stories across all categories RIGHT NOW?${locationContext} Include tech, sports, politics, entertainment, business, health, and science. Priority to stories from the last 12 hours.`,
    tech: `${recencyEnforcement}
What are the top 10 BREAKING technology and AI stories RIGHT NOW?${locationContext} Include product launches, breakthroughs, company news, and industry developments. Priority to announcements from today.`,
    sports: `${recencyEnforcement}
What are the top 10 LATEST sports stories RIGHT NOW?${locationContext} Include today's game results, breaking trades, injury updates, and major announcements. Priority to games played in the last 24 hours.`,
    politics: `${recencyEnforcement}
What are the top 10 BREAKING political news stories RIGHT NOW?${locationContext} Include elections, policy changes, international relations, and government actions. Priority to statements and votes from today.`,
    entertainment: `${recencyEnforcement}
What are the top 10 TRENDING entertainment stories RIGHT NOW?${locationContext} Include movies, TV shows, music, celebrities, and pop culture. Priority to announcements and releases from today.`,
    science: `${recencyEnforcement}
What are the top 10 LATEST science and research stories RIGHT NOW?${locationContext} Include discoveries, breakthroughs, space exploration, and health research. Priority to papers and announcements from today.`,
    business: `${recencyEnforcement}
What are the top 10 BREAKING business and finance stories RIGHT NOW?${locationContext} Include today's stock market moves, CEO news, earnings reports, M&A, economic indicators. Priority to market-moving news from today.`,
    health: `${recencyEnforcement}
What are the top 10 BREAKING health and wellness stories RIGHT NOW?${locationContext} Include medical breakthroughs, public health updates, drug approvals, and healthcare policy. Priority to announcements from today.`,
    world: `${recencyEnforcement}
What are the top 10 BREAKING international news stories RIGHT NOW?${locationContext} Include geopolitics, foreign affairs, conflicts, diplomacy, and global economy. Priority to developments from the last 12 hours.`,
    culture: `${recencyEnforcement}
What are the top 10 TRENDING culture and lifestyle stories RIGHT NOW?${locationContext} Include social trends, food, travel, fashion, and cultural phenomena. Priority to viral stories from today.`,
    crime: `${recencyEnforcement}
What are the top 10 BREAKING crime and true crime stories RIGHT NOW?${locationContext} Include criminal cases, investigations, trials, and law enforcement news. Priority to developments from the last 24 hours.`
  };

  const prompt = `As of ${currentDate}, ${categoryPrompts[category]}

For each trending topic, provide:
1. A clear, compelling headline (10-15 words)
2. A brief 2-sentence summary explaining why it's trending
3. Its primary category (tech/business/health/world/politics/sports/entertainment/culture/crime/science)
4. The publish date/time of the underlying source story, in ISO 8601 (e.g. 2025-04-28T15:30:00Z). Use the most recent source for that story.

Format your response as a numbered list (1-10) with each topic on its own line in this exact format:
[TOPIC] Headline here
[SUMMARY] Two sentence summary here.
[CATEGORY] category_name
[PUBLISHED] 2025-04-28T15:30:00Z

If you genuinely cannot determine a publish time, write [PUBLISHED] unknown — do NOT omit the line.

Focus on stories that would make great podcast topics - interesting, timely, with multiple angles to explore.`;

  // Initial search with location context
  let topics = await fetchTrendingTopicsFromPerplexity(prompt, 'initial');
  
  // If local search returned too few topics (< 3), try newspaper-focused search
  if (location && topics.length < 3) {
    console.log(`[Perplexity] Only ${topics.length} local topics found for "${location}", trying newspaper-focused search...`);
    
    const newspaperPrompt = `As of ${currentDate}, ${categoryPrompts[category]}

IMPORTANT: Prioritize stories from major national and state newspapers and news outlets covering ${location} and its region.

For each trending topic, provide:
1. A clear, compelling headline (10-15 words)
2. A brief 2-sentence summary explaining why it's trending
3. Its primary category (tech/business/health/world/politics/sports/entertainment/culture/crime/science)
4. The publish date/time of the underlying source story, in ISO 8601 (e.g. 2025-04-28T15:30:00Z). Use the most recent source for that story.

Format your response as a numbered list (1-10) with each topic on its own line in this exact format:
[TOPIC] Headline here
[SUMMARY] Two sentence summary here.
[CATEGORY] category_name
[PUBLISHED] 2025-04-28T15:30:00Z

If you genuinely cannot determine a publish time, write [PUBLISHED] unknown — do NOT omit the line.

Focus on stories that would make great podcast topics - interesting, timely, with multiple angles to explore.`;

    const newspaperTopics = await fetchTrendingTopicsFromPerplexity(newspaperPrompt, 'newspaper-focused');
    
    if (newspaperTopics.length >= 3) {
      console.log(`[Perplexity] Newspaper search found ${newspaperTopics.length} topics, using those instead`);
      topics = newspaperTopics;
    } else if (newspaperTopics.length > 0) {
      console.log(`[Perplexity] Newspaper search found ${newspaperTopics.length} topics, combining with initial results`);
      topics = [...topics, ...newspaperTopics].slice(0, 10);
    } else {
      console.log(`[Perplexity] Newspaper search found no results, returning initial results or empty`);
      if (topics.length < 3) {
        return []; // Trigger global fallback if still insufficient
      }
    }
  }
  
  console.log(`[Perplexity] Final result: ${topics.length} trending topics`);
  return topics.slice(0, 10);
}

export interface TopicEnhancement {
  enhancedTopic: string;
  context: string;
  relatedAngles: string[];
  isTimely: boolean;
}

export async function enhanceTopicWithContext(
  userTopic: string,
  category: string = 'custom'
): Promise<TopicEnhancement> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  
  if (!apiKey) {
    console.warn('PERPLEXITY_API_KEY not found, returning basic enhancement');
    return {
      enhancedTopic: userTopic,
      context: '',
      relatedAngles: [],
      isTimely: false
    };
  }

  const currentDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const prompt = `User wants to create a podcast about: "${userTopic}"

Based on today's developments (${currentDate}), help enhance this topic:

1. ENHANCED TOPIC: Provide a more specific, timely version of this topic that incorporates recent developments or current context (keep it 15-20 words max)

2. CURRENT CONTEXT: Explain what's happening with this topic right now (2-3 sentences) - recent news, trends, why it's relevant today

3. RELATED ANGLES: Suggest 3 different angles or perspectives they could explore in the podcast

4. TIMELINESS: Is this topic currently trending or newsworthy? (YES/NO)

Format your response exactly as:
[ENHANCED] your enhanced topic here
[CONTEXT] your context here
[ANGLE1] first angle
[ANGLE2] second angle
[ANGLE3] third angle
[TIMELY] YES or NO`;

  try {
    const messages: PerplexityMessage[] = [
      {
        role: 'system',
        content: 'You are a podcast topic advisor. Help users create more specific, timely, and engaging podcast topics based on current events and trends.'
      },
      {
        role: 'user',
        content: prompt
      }
    ];

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'sonar-pro',
        messages,
        temperature: 0.3,
        top_p: 0.9,
        search_recency_filter: 'week',
        web_search_options: { search_context_size: 'low' },
        return_images: false,
        return_related_questions: false,
        stream: false,
        presence_penalty: 0,
        frequency_penalty: 1
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Perplexity API error:', response.status, errorText);
      return {
        enhancedTopic: userTopic,
        context: '',
        relatedAngles: [],
        isTimely: false
      };
    }

    const data: PerplexityResponse = await response.json();
    const content = data.choices[0]?.message?.content || '';
    
    // Parse the response
    const lines = content.split('\n');
    let enhancedTopic = userTopic;
    let context = '';
    const relatedAngles: string[] = [];
    let isTimely = false;
    
    for (const line of lines) {
      if (line.includes('[ENHANCED]')) {
        enhancedTopic = line.replace('[ENHANCED]', '').trim();
      } else if (line.includes('[CONTEXT]')) {
        context = line.replace('[CONTEXT]', '').trim();
      } else if (line.includes('[ANGLE1]')) {
        relatedAngles.push(line.replace('[ANGLE1]', '').trim());
      } else if (line.includes('[ANGLE2]')) {
        relatedAngles.push(line.replace('[ANGLE2]', '').trim());
      } else if (line.includes('[ANGLE3]')) {
        relatedAngles.push(line.replace('[ANGLE3]', '').trim());
      } else if (line.includes('[TIMELY]')) {
        isTimely = line.toUpperCase().includes('YES');
      }
    }
    
    return {
      enhancedTopic,
      context,
      relatedAngles,
      isTimely
    };
  } catch (error) {
    console.error('Error enhancing topic:', error);
    return {
      enhancedTopic: userTopic,
      context: '',
      relatedAngles: [],
      isTimely: false
    };
  }
}

/**
 * Local Event interface (matches grok.ts for compatibility)
 */
export interface LocalEvent {
  name: string;
  venue: string;
  date: string;
  time?: string;
  description: string;
  category: string;
  ticketInfo?: string;
  sourceUrl?: string;
  engagementLevel: 'viral' | 'trending' | 'rising' | 'upcoming';
}

interface LocalEventResponse {
  events: LocalEvent[];
  city: string;
  lastUpdated: string;
  disclaimer: string;
}

/**
 * Search for UPCOMING local events using Perplexity API
 * This function explicitly searches for future events only, with date filtering
 * to prevent stale/past event data from being returned.
 */
export async function searchUpcomingEvents(
  city: string,
  eventType?: string,
  dateRange: 'today' | 'this_week' | 'this_month' = 'this_week',
  count: number = 15
): Promise<LocalEventResponse> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  
  if (!apiKey) {
    console.warn('[Perplexity Events] API key not found');
    return {
      events: [],
      city,
      lastUpdated: new Date().toISOString(),
      disclaimer: "Event discovery requires Perplexity API configuration"
    };
  }

  const now = new Date();
  const todayStr = now.toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  
  let dateConstraint = '';
  let endDate = new Date(now);
  
  switch (dateRange) {
    case 'today':
      dateConstraint = `happening TODAY (${todayStr}) only`;
      break;
    case 'this_week':
      endDate.setDate(now.getDate() + 7);
      dateConstraint = `happening between ${todayStr} and the next 7 days`;
      break;
    case 'this_month':
      endDate.setMonth(now.getMonth() + 1);
      dateConstraint = `happening between ${todayStr} and the next 30 days`;
      break;
  }

  const eventTypeFilter = eventType && eventType !== 'all' 
    ? `Focus on ${eventType} events.` 
    : 'Include all types of events (concerts, sports, festivals, theater, community, etc.).';

  const prompt = `Find ${count} UPCOMING events in ${city} ${dateConstraint}.

CRITICAL REQUIREMENTS:
- ONLY include events happening in the FUTURE (after ${todayStr})
- Do NOT include any past events or events from previous years
- Each event MUST have a specific date in the future
- Today is ${todayStr} - verify all dates are on or after this date

${eventTypeFilter}

For each event, provide:
- Event name
- Venue/location
- Date (must be in the future)
- Time (if available)
- Brief description (1-2 sentences)
- Category (concert, sports, festival, theater, community, food, art, comedy, etc.)
- Ticket info or how to attend (if available)

Format your response as a JSON array:
[
  {
    "name": "Event Name",
    "venue": "Venue Name, Address",
    "date": "Month Day, Year",
    "time": "7:00 PM",
    "description": "Brief description",
    "category": "concert",
    "ticketInfo": "Tickets at eventbrite.com"
  }
]

Only respond with the JSON array, no other text.`;

  try {
    console.log(`[Perplexity Events] Searching upcoming ${eventType || 'all'} events in ${city} (${dateRange})`);
    
    const messages: PerplexityMessage[] = [
      {
        role: 'system',
        content: `You are a local events researcher. You ONLY report UPCOMING events that are happening in the FUTURE. Today is ${todayStr}. Never include past events. Always verify dates are in the future before including an event.`
      },
      {
        role: 'user',
        content: prompt
      }
    ];

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'sonar-pro',
        messages,
        temperature: 0.2,
        top_p: 0.9,
        search_recency_filter: 'month',
        web_search_options: { search_context_size: 'low' },
        return_images: false,
        return_related_questions: false,
        stream: false,
        presence_penalty: 0,
        frequency_penalty: 1
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Perplexity Events] API error:', response.status, errorText);
      throw new Error(`Perplexity API error: ${response.status}`);
    }

    const data: PerplexityResponse = await response.json();
    const content = data.choices[0]?.message?.content || '[]';
    
    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = content;
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }
    
    let parsed: any[] = [];
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      console.error('[Perplexity Events] Failed to parse JSON response:', e);
      parsed = [];
    }

    // Post-filter: ensure only future dates within the requested timeframe
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const events: LocalEvent[] = parsed
      .filter((event: any) => {
        if (!event.date) return false;
        
        // Allow TBA dates through
        if (event.date.toLowerCase().includes('tba')) return true;
        
        // Try to parse the date
        const eventDate = new Date(event.date);
        
        // Reject if date parsing failed (NaN)
        if (isNaN(eventDate.getTime())) {
          console.log(`[Perplexity Events] Rejecting unparseable date: ${event.date}`);
          return false;
        }
        
        // Reject past events
        if (eventDate < today) {
          console.log(`[Perplexity Events] Rejecting past event: ${event.name} (${event.date})`);
          return false;
        }
        
        // Reject events beyond the requested timeframe
        if (eventDate > endDate) {
          console.log(`[Perplexity Events] Rejecting event beyond timeframe: ${event.name} (${event.date})`);
          return false;
        }
        
        return true;
      })
      .slice(0, count)
      .map((event: any) => ({
        name: event.name || 'Untitled Event',
        venue: event.venue || 'Venue TBA',
        date: event.date || 'Date TBA',
        time: event.time || undefined,
        description: event.description || '',
        category: event.category || 'event',
        ticketInfo: event.ticketInfo || undefined,
        sourceUrl: event.sourceUrl || undefined,
        engagementLevel: 'upcoming' as const
      }));

    console.log(`[Perplexity Events] Found ${events.length} upcoming events in ${city}`);

    return {
      events,
      city,
      lastUpdated: new Date().toISOString(),
      disclaimer: "Event information sourced from web search. Please verify details with official sources before attending."
    };
  } catch (error) {
    console.error('[Perplexity Events] Error:', error);
    return {
      events: [],
      city,
      lastUpdated: new Date().toISOString(),
      disclaimer: "Unable to fetch events at this time."
    };
  }
}
