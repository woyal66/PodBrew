import OpenAI from 'openai';
import type { VoiceId, Voice, TimeFrame } from '@shared/schema';
import { generateOrGetCoverArt } from './services/CoverArtCache';
import { generateTitle as generateTitleWithRouter } from './llmRouter';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type PodcastStyle = 'conversational' | 'narrative' | 'debate' | 'interview' | 'news' | 'executive-briefing' | 'tutor' | 'lecturer' | 'coach';

/**
 * Generate a catchy, concise podcast title (max 8 words) that summarizes the podcast content
 * Uses LLM Router with GPT-4o-mini for 94% cost savings vs GPT-4o
 * @param topic - The original user topic/description
 * @param templateCategory - The podcast template category
 * @returns A catchy title (max 8 words)
 */
export async function generatePodcastTitle(topic: string, templateCategory: string): Promise<string> {
  try {
    console.log('[Title Generation] Generating catchy podcast title via LLM Router (GPT-4o-mini)...');
    
    const title = await generateTitleWithRouter(topic, templateCategory);
    
    // Fallback to truncated topic if title is too short
    if (title.length < 10) {
      const topicWords = topic.split(/\s+/).slice(0, 8).join(' ');
      return topicWords.length > 60 ? topicWords.substring(0, 60) : topicWords;
    }
    
    console.log(`[Title Generation] Generated title: "${title}"`);
    return title;
    
  } catch (error) {
    console.error('[Title Generation] Error generating title:', error);
    // Fallback: Use first 8 words of topic
    const fallbackTitle = topic.split(/\s+/).slice(0, 8).join(' ');
    return fallbackTitle.length > 60 ? fallbackTitle.substring(0, 60) : fallbackTitle;
  }
}

/**
 * Generate a concise podcast description (1-2 sentences) based on template and topic
 * Auto-generates RSS-friendly description without user input
 * @param topic - The original user topic/description
 * @param templateCategory - The podcast template category
 * @returns A 1-2 sentence description
 */
export async function generatePodcastDescription(topic: string, templateCategory: string): Promise<string> {
  try {
    console.log('[Description Generation] Generating podcast description...');
    
    const descriptionPrompts: Record<string, string> = {
      'news': `Create a 1-2 sentence news podcast description for: "${topic.substring(0, 100)}"
Format: "[Topic] - Latest updates and analysis"
Be concise and mention key aspects. Do not exceed 2 sentences.`,
      'sports': `Create a 1-2 sentence sports podcast description for: "${topic.substring(0, 100)}"
Format: "Game recap, player analysis, and season updates"
Focus on the sport/team covered. Do not exceed 2 sentences.`,
      'teachme': `Create a 1-2 sentence educational podcast description for: "${topic.substring(0, 100)}"
Format: "Learn about [topic] with step-by-step instruction"
Emphasize learning value. Do not exceed 2 sentences.`,
      'stories': `Create a 1-2 sentence story/audiobook description for: "${topic.substring(0, 100)}"
Format: "An immersive narrative about [topic]"
Entice listeners with the story premise. Do not exceed 2 sentences.`,
      'medical': `Create a 1-2 sentence medical education description for: "${topic.substring(0, 100)}"
Format: "Educational information about [topic] for informational purposes"
Include that it's educational/informational only. Do not exceed 2 sentences.`,
      'events': `Create a 1-2 sentence event guide description for: "${topic.substring(0, 100)}"
Format: "Complete guide to [event] - Details, highlights, and insider tips"
Cover event details. Do not exceed 2 sentences.`,
      'documents': `Create a 1-2 sentence document summary description for: "${topic.substring(0, 100)}"
Format: "Audio summary of [document] with key insights"
Highlight what's covered. Do not exceed 2 sentences.`,
      'custom': `Create a 1-2 sentence podcast description for: "${topic.substring(0, 100)}"
Make it engaging and informative. Do not exceed 2 sentences.`
    };

    const prompt = descriptionPrompts[templateCategory] || descriptionPrompts['custom'];
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are an expert at writing concise, engaging podcast descriptions (1-2 sentences). Be direct and enticing without fluff.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 150,
      temperature: 0.7,
    });

    let description = response.choices[0].message.content?.trim() || '';
    
    // Ensure it's 1-2 sentences max and under 160 chars (RSS-friendly)
    const sentences = description.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
    description = sentences.length > 160 ? sentences.substring(0, 157) + '...' : sentences;
    
    console.log(`[Description Generation] Generated: "${description}"`);
    return description || topic.substring(0, 160);
    
  } catch (error) {
    console.error('[Description Generation] Error generating description:', error);
    // Fallback: Use first 160 chars of topic
    return topic.substring(0, 160);
  }
}

/**
 * Generates a course syllabus for multi-episode binge courses
 * Splits a main topic into N focused episode outlines
 */
export interface CourseSyllabusEpisode {
  episodeNumber: number;
  title: string;
  focusTopic: string;
  keyPoints: string[];
}

export async function generateCourseSyllabus(
  mainTopic: string, 
  episodeCount: number,
  refinedContext?: string
): Promise<CourseSyllabusEpisode[]> {
  console.log(`[Syllabus] Generating ${episodeCount}-episode course syllabus for: "${mainTopic.substring(0, 50)}..."`);
  
  try {
    const contextAddition = refinedContext ? `\n\nAdditional context from user:\n${refinedContext}` : '';
    
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an expert course designer and curriculum specialist. Create a structured multi-episode course syllabus that progressively teaches a topic across multiple episodes.

Rules:
- Each episode should cover ONE focused subtopic
- Episodes should build on each other logically
- Early episodes cover fundamentals, later episodes go deeper
- Each episode should be self-contained but connected to the series
- Titles should be catchy and descriptive (max 8 words)
- Key points should be specific and actionable

Output ONLY valid JSON array with no markdown or explanation.`
        },
        {
          role: "user",
          content: `Create a ${episodeCount}-episode course syllabus for:

MAIN TOPIC: ${mainTopic}${contextAddition}

Output JSON array format:
[
  {
    "episodeNumber": 1,
    "title": "Episode title (max 8 words)",
    "focusTopic": "Detailed description of what this episode covers (2-3 sentences)",
    "keyPoints": ["Key point 1", "Key point 2", "Key point 3"]
  }
]

Generate exactly ${episodeCount} episodes.`
        }
      ],
      temperature: 0.7,
      max_tokens: 2000,
      response_format: { type: "json_object" }
    });

    const content = completion.choices[0].message.content?.trim() || '{}';
    const parsed = JSON.parse(content);
    
    // Handle both array and object with episodes property
    const episodes: CourseSyllabusEpisode[] = Array.isArray(parsed) ? parsed : (parsed.episodes || parsed.syllabus || []);
    
    if (episodes.length < episodeCount) {
      console.warn(`[Syllabus] Only generated ${episodes.length}/${episodeCount} episodes, padding with generic episodes`);
      for (let i = episodes.length + 1; i <= episodeCount; i++) {
        episodes.push({
          episodeNumber: i,
          title: `${mainTopic} - Part ${i}`,
          focusTopic: `Continue exploring ${mainTopic} with advanced concepts and practical applications.`,
          keyPoints: ["Advanced concepts", "Practical applications", "Real-world examples"]
        });
      }
    } else if (episodes.length > episodeCount) {
      console.warn(`[Syllabus] AI generated ${episodes.length} episodes but only ${episodeCount} requested, truncating`);
      episodes.length = episodeCount;
    }
    
    console.log(`[Syllabus] Generated ${episodes.length} episode outlines:`);
    episodes.forEach((ep, i) => {
      console.log(`  Episode ${i + 1}: "${ep.title}"`);
    });
    
    return episodes;
    
  } catch (error) {
    console.error('[Syllabus] Error generating syllabus:', error);
    // Fallback: Create generic episode structure
    const fallbackEpisodes: CourseSyllabusEpisode[] = [];
    for (let i = 1; i <= episodeCount; i++) {
      fallbackEpisodes.push({
        episodeNumber: i,
        title: `${mainTopic} - Episode ${i}`,
        focusTopic: `Part ${i} of ${episodeCount} covering ${mainTopic}`,
        keyPoints: ["Core concepts", "Key insights", "Practical takeaways"]
      });
    }
    return fallbackEpisodes;
  }
}

// Wrapper function kept for backward compatibility (uses cache)
export async function generateCoverArt(topic: string, template: string = 'news'): Promise<string> {
  return generateOrGetCoverArt(topic, template);
}

export async function enhanceTopic(
  topic: string,
  podcastStyle: PodcastStyle = 'conversational',
  languageComplexity: number,
  numPeople: number = 2,
  timeFrame: TimeFrame = 'pastMonth',
  coHostPersonality: CoHostPersonality = 'casual',
  templateCategory: string = 'custom'
): Promise<string> {
  // Template-specific focus areas to guide the expansion
  const templateContext: Record<string, string> = {
    'news': 'Include latest developments, key stakeholders, and breaking information.',
    'sports': 'Cover team/player analysis, game highlights, statistics, and league context.',
    'teachme': 'Focus on learning objectives, clear explanations, examples, and practical applications.',
    'events': 'Detail event specifics, speakers/performers, attendee experience, and key highlights.',
    'stories': 'Emphasize narrative elements, characters, plot points, and themes.',
    'medical': 'Address medical aspects, patient/provider perspectives, clinical evidence, and health implications.',
    'documents': 'Highlight key themes, main arguments, important sections, and practical takeaways.',
    'custom': 'Include relevant facts, context, and valuable insights.'
  };

  const contextGuidance = templateContext[templateCategory] || templateContext['custom'];

  const enhancementPrompt = `Transform this brief podcast topic into a detailed, compelling 2-3 sentence description that expands keywords into natural language and adds valuable context.

Input: "${topic}"
Template type: ${templateCategory}

Instructions:
- Expand brief keywords or phrases into full natural language sentences
- Add specific context about what the podcast should cover
- Specify the type of valuable information to include
- Keep it to exactly 2-3 complete sentences
- ${contextGuidance}
- Make it actionable and clear what listeners will learn

Examples of good transformations:
- "history, roman, caesar" → "Create a deep dive into Julius Caesar's rise to power in ancient Rome, covering his military campaigns, political alliances, and assassination. Include facts about Roman society and his lasting legacy."
- "ai, latest" → "Explore the latest AI breakthroughs including LLMs, safety research, and real-world applications. Cover major announcements from tech companies and research institutions."
- "climate change" → "Examine climate change with latest scientific data, policy developments, and innovative solutions. Focus on actionable insights and impactful initiatives."

Output only the enhanced topic description (2-3 sentences), nothing else.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are an expert at transforming brief prompts into detailed, compelling podcast topic descriptions. You expand keywords into natural language and add valuable context in exactly 2-3 sentences.'
        },
        {
          role: 'user',
          content: enhancementPrompt
        }
      ],
      max_tokens: 300,
      temperature: 0.7,
    });

    const enhancedTopic = response.choices[0].message.content?.trim() || topic;
    
    // Ensure we don't return something that's too long or looks like it failed
    // Allow up to 700 characters for 2-3 detailed sentences
    if (enhancedTopic.length > 700 || enhancedTopic.includes('I cannot') || enhancedTopic.includes('I apologize')) {
      console.log(`Enhancement produced invalid output for topic: "${topic}". Falling back to original.`);
      return topic;
    }
    
    return enhancedTopic;
  } catch (error) {
    const openAIError = error as { status?: number; error?: { message?: string } };
    if (openAIError?.status === 400 && openAIError?.error?.message?.includes('safety')) {
      console.log(`Enhancement moderation triggered for topic: "${topic}". Returning fallback...`);
      return `Explore ${topic} with in-depth analysis, expert insights, and real-world examples. Cover key developments, important perspectives, and actionable takeaways.`;
    }
    console.error('Error enhancing topic:', error);
    // Return original topic as fallback instead of throwing
    return topic;
  }
}

type CoHostPersonality = 'casual' | 'academic' | 'executive' | 'storyteller' | 'investigative';

function calculateSinceDate(timeFrame: TimeFrame): string | null {
  const now = new Date();
  let targetDate: Date | null = null;

  switch (timeFrame) {
    case 'past24h':
      targetDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case 'pastWeek':
      targetDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case 'pastMonth':
      targetDate = new Date(now);
      targetDate.setMonth(targetDate.getMonth() - 1);
      break;
    case 'pastYear':
      targetDate = new Date(now);
      targetDate.setFullYear(targetDate.getFullYear() - 1);
      break;
    case 'next24h':
    case 'nextWeek':
    case 'nextMonth':
    case 'nextYear':
    case 'allTime':
    default:
      return null;
  }

  return targetDate ? targetDate.toISOString().split('T')[0] : null;
}

function getTimeConstraint(timeFrame: TimeFrame): string {
  const sinceDate = calculateSinceDate(timeFrame);
  const now = new Date();
  const currentDateStr = now.toISOString().split('T')[0];
  
  if (sinceDate) {
    return `Source all facts, examples, headlines, and references exclusively from events/developments since ${sinceDate}. For news/current topics, use real-time information within this timeframe from reliable sources (Reuters, AP, etc.). If limited recent data exists, note "emerging topic" and focus on available insights.`;
  }
  
  switch (timeFrame) {
    case 'next24h': {
      const endDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      return `Focus on UPCOMING events and developments happening between ${currentDateStr} and ${endDate.toISOString().split('T')[0]}. Discuss scheduled events, announcements, previews, and anticipated developments for TODAY and TOMORROW.`;
    }
    case 'nextWeek': {
      const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      return `Focus on UPCOMING events and developments happening between ${currentDateStr} and ${endDate.toISOString().split('T')[0]}. Discuss scheduled events, announcements, previews, and anticipated developments for THIS WEEK.`;
    }
    case 'nextMonth': {
      const endDate = new Date(now);
      endDate.setMonth(endDate.getMonth() + 1);
      return `Focus on UPCOMING events and developments happening between ${currentDateStr} and ${endDate.toISOString().split('T')[0]}. Discuss scheduled events, conferences, releases, and anticipated developments for THIS MONTH.`;
    }
    case 'nextYear': {
      const endDate = new Date(now);
      endDate.setFullYear(endDate.getFullYear() + 1);
      return `Focus on UPCOMING events and developments happening between ${currentDateStr} and ${endDate.toISOString().split('T')[0]}. Discuss major planned releases, events, conferences, and anticipated developments over the COMING YEAR.`;
    }
    case 'allTime':
    default:
      return `Draw from all available information and timeless insights.`;
  }
}

/**
 * Extract personality traits from voice description (Phase 3 Enhancement)
 * Returns descriptive guidance without bracket-based emotion tags
 * (Emotion tags like [excited] cause audio distortion in Gemini TTS)
 */
function extractVoicePersonalityTraits(voiceDescription?: string): string {
  // Disabled: Emotion tags cause Gemini TTS audio distortion
  // The voice description is used for context but no bracket tags are added
  return '';
}

/**
 * Get template-specific emotion palette for realistic podcast delivery
 * Each template type has emotions that feel natural for that content
 * IMPORTANT: Only uses emotions from the approved list in jsonFormatInstructions
 */
function getTemplateEmotionPalette(templateCategory: string): string {
  // Approved emotions: neutral, cheerful, serious, tense, dramatic, calm, excited, warm, playful, 
  // contemplative, questioning, investigative, conclusive, empathetic, laugh, chuckle, sigh, gasp, 
  // whisper, giggle, sarcastic, mocking, witty, angry, fearful, surprised, curious, mysterious, confident, nervous
  
  const palettes: Record<string, string> = {
    news: `
📰 NEWS EMOTION PALETTE:
Primary emotions: serious, calm, questioning, investigative
Supporting emotions: surprised (breaking news), curious (exploring angles), empathetic (human interest)
Vocal effects: gasp (major developments), sigh (acknowledging difficulties)
Avoid: playful, giggle (unless light closing)
Pattern: serious openings → investigative analysis → empathetic human elements → conclusive wrap-ups`,
    
    sports: `
🏆 SPORTS EMOTION PALETTE:
Primary emotions: excited, dramatic, tense, cheerful, confident
Supporting emotions: surprised (upsets), curious (stats), playful (banter)
Vocal effects: gasp (incredible plays), laugh (fun moments), chuckle (great stories)
High energy moments: Use dramatic + excited for game highlights
Analysis mode: contemplative + serious for strategy discussion
Pattern: excited opens → dramatic play-by-play → contemplative analysis → confident predictions`,
    
    teachme: `
📚 TEACHME EMOTION PALETTE:
Primary emotions: warm, curious, excited, calm
Supporting emotions: playful (engaging examples), contemplative (deep concepts), questioning (prompting thought)
Vocal effects: chuckle (relatable moments), sigh (letting concepts sink in)
Tutor style: warm throughout, excited when concepts click
Coach style: excited + confident, dramatic for motivation
Lecturer style: serious + confident, curious for exploration
Pattern: warm welcome → curious exploration → excited discoveries → confident conclusions`,
    
    stories: `
📖 STORIES EMOTION PALETTE:
Primary emotions: dramatic, mysterious, tense, warm
Supporting emotions: fearful (suspense), excited (action), whisper (secrets), contemplative (reflection)
Vocal effects: gasp (plot twists), sigh (emotional beats)
Character emotions: vary based on dialogue - angry, fearful, cheerful, nervous, confident
Narrator emotions: mysterious + dramatic for atmosphere
Pattern: dramatic opening → emotional character moments → tense climax → warm resolution`,
    
    medical: `
🏥 MEDICAL EMOTION PALETTE:
Primary emotions: calm, warm, empathetic, serious
Supporting emotions: curious (exploring conditions), contemplative (considering treatments)
Vocal effects: sigh (acknowledging struggles)
Avoid: dramatic, fearful (could cause anxiety)
Pattern: calm introduction → empathetic understanding → serious information → warm guidance`,
    
    events: `
🎉 EVENTS EMOTION PALETTE:
Primary emotions: excited, curious, cheerful, warm
Supporting emotions: surprised (special announcements), playful (fun elements), dramatic (big reveals)
Vocal effects: laugh (enjoyable moments), gasp (exciting announcements)
Preview mode: curious + excited about what's coming
Recap mode: cheerful + warm about highlights
Pattern: excited open → curious details → cheerful highlights → warm close`,
    
    documents: `
📄 DOCUMENTS EMOTION PALETTE:
Primary emotions: contemplative, serious, curious, investigative, conclusive
Supporting emotions: surprised (key findings), questioning (analysis), empathetic (implications)
Vocal effects: sigh (complex realizations)
Pattern: curious introduction → investigative analysis → contemplative insights → conclusive takeaways`,
    
    custom: `
🎙️ CUSTOM EMOTION PALETTE:
Use full emotional range based on content:
- Information delivery: curious, contemplative, serious
- Engaging moments: excited, surprised, playful
- Connection building: warm, empathetic
- Emphasis: dramatic, confident
Pattern: warm opening → varied content emotions → confident close`
  };
  
  return palettes[templateCategory] || palettes['custom'];
}

/**
 * Generates voice personality descriptions for prompts
 * Uses aliasName from curated voices for personalized host names
 * Phase 3 Enhanced: Includes personality-based emotional marker guidance
 * Example: "HOST (Charlotte - British, female)" instead of "HOST (Ember - British, female)"
 * @internal - Exported for testing
 */
export function generateVoicePersonalities(selectedVoices?: Voice[], assignedVoices?: VoiceId[], numPeople: number = 2): string {
  const personalities: string[] = [];
  const speakerLabels = ['HOST', 'CO-HOST', 'HOST1', 'HOST2', 'HOST3', 'HOST4', 'HOST5'];
  let speakerIndex = 0;
  const personalityEmotionalMarkers: Record<number, string> = {}; // Phase 3: Track markers per speaker
  
  // First, add curated voices (with aliasName) for user-selected voices
  if (selectedVoices && selectedVoices.length > 0) {
    for (let i = 0; i < Math.min(numPeople, selectedVoices.length); i++) {
      const voice = selectedVoices[i];
      const label = numPeople === 2 && speakerIndex === 1 ? 'CO-HOST' : speakerLabels[speakerIndex] || `HOST${speakerIndex + 1}`;
      const accentDesc = voice.accent === 'US' ? 'American' : voice.accent === 'UK' ? 'British' : voice.accent === 'AU' ? 'Australian' : voice.accent === 'IN' ? 'Indian' : voice.accent;
      const genderDesc = voice.gender.toLowerCase() === 'male' ? 'male' : 'female';
      
      // Use aliasName (e.g., Charlotte, Edward) instead of displayName (e.g., WaveNet-C)
      personalities.push(`${label} (${voice.aliasName} - ${accentDesc} accent, ${genderDesc})`);
      
      // Phase 3: Extract personality traits from voice description
      const traitMarkers = extractVoicePersonalityTraits(voice.description || undefined);
      if (traitMarkers) {
        personalityEmotionalMarkers[speakerIndex] = traitMarkers;
      }
      
      speakerIndex++;
    }
  }
  
  // Note: assignedVoices fallback removed (November 2025)
  // All voices now come from Voice Marketplace (database), no legacy voice fallbacks
  
  if (personalities.length > 0) {
    // Log warning if we couldn't fill all speakers
    if (speakerIndex < numPeople) {
      console.warn(`[VoicePersonalities] Only ${speakerIndex} personalities generated for ${numPeople} speakers (selectedVoices: ${selectedVoices?.length || 0}, assignedVoices: ${assignedVoices?.length || 0})`);
    }
    
    // Phase 3: Build personality guidance with emotional markers per speaker
    let personalityText = `\n\nVoice Personalities:\n${personalities.join('\n')}\nWrite dialogue that reflects each speaker's accent and personality. Use regional expressions and speech patterns appropriate to their background. Each speaker maintains their assigned voice throughout the entire podcast.`;
    
    // Phase 3: Add personality-based emotional marker guidance
    if (Object.keys(personalityEmotionalMarkers).length > 0) {
      personalityText += `\n\nPersonality-Based Vocal Delivery (Phase 3 Enhancement):`;
      Object.entries(personalityEmotionalMarkers).forEach(([index, markers]) => {
        const speakerLabel = numPeople === 2 && index === '1' ? 'CO-HOST' : speakerLabels[parseInt(index)] || `HOST${parseInt(index) + 1}`;
        personalityText += `\n- ${speakerLabel} naturally uses markers like: ${markers}`;
      });
    }
    
    return personalityText;
  }
  
  return '';
}

/**
 * Generates natural speech pattern instructions based on podcast style and mood
 * Informed by research of top podcasts (Joe Rogan, The Daily, SmartLess, etc.)
 * IMPORTANT: No bracket-based emotion tags - they cause Gemini TTS audio distortion
 */
function generateNaturalSpeechInstructions(podcastStyle: PodcastStyle, numPeople: number, podcastMood: string = 'balanced'): string {
  // Mood-specific delivery guidance (without bracket tags that cause TTS distortion)
  const moodDeliveryGuidance: Record<string, string> = {
    serious: "Deliver with gravitas and measured pacing. Minimize humor, favor contemplative and authoritative tone.",
    humorous: "Deliver with warmth and playful energy. Include light-hearted moments and natural comedic observations.",
    mysterious: "Build atmospheric suspense with dramatic pacing and questioning inflections.",
    uplifting: "Deliver with positive energy, warmth, and an inspiring tone throughout.",
    energetic: "Fast-paced delivery with high engagement and dynamic vocal intensity.",
    balanced: "Natural conversational delivery appropriate to the content."
  };
  
  const moodGuidance = moodDeliveryGuidance[podcastMood] || moodDeliveryGuidance['balanced'];
  
  // Natural speech patterns without any bracket tags
  const disfluencyGuidance = `
NATURAL SPEECH PATTERNS:
- VERBAL FILLERS (use naturally, 5-10 per 10-minute podcast):
  * "um", "uh", "like", "you know", "so", "basically", "actually", "I mean"
  * Example: "The thing is, um, like, we need to think about this differently, you know?"
  * Use especially before important points: "Um, so here's the thing..."
- NATURAL HESITATIONS: "Well...", "Let me think about that...", "That's like... interesting"
- FALSE STARTS (occasional): "That doesn't... well, actually it totally does make sense"
- INTERJECTIONS: "Right?", "Yeah", "Exactly", "I know", "For real?" scattered naturally
- CONTRACTIONS EVERYWHERE: "don't", "can't", "it's", "there's", "we're", "that's"`;
  
  // Multi-host guidance
  const multiHostGuidance = numPeople > 1 ? `
MULTI-HOST DYNAMICS:
- Active listening: "yeah", "mm-hmm", "right", "absolutely", "totally"
- Natural interruptions: occasionally finish each other's sentences
- Brief interjections: "Right?" / "Exactly!" / "I totally agree" scattered naturally
- Complete thoughts before switching speakers (usually 3-5 sentences per turn)
- Natural pacing that feels like friends talking, not a scripted interview` : '';
  
  // News/Professional styles
  if (podcastStyle === 'news') {
    return `\n\nNATURAL SPEECH (Professional):
- Use CONTRACTIONS: "don't", "can't", "we're", "it's" (not "do not", "cannot")
- Vary emotional delivery to keep audience engaged - serious for key developments, calmer for transitions
- MOOD: ${moodGuidance}
${disfluencyGuidance.replace('5-10 per 10-minute', '3-5 per 10-minute (professional style)')}
- Active transitions: "Now,", "So,", "But here's the thing..."
- ${numPeople > 1 ? 'Respectful handoffs: "Over to you", "What do you think?", "Right, exactly"' : ''}
- Keep delivery smooth, authoritative, with natural emotional variation`;
  }
  
  // Conversational/Casual styles
  const casualInstructions = `\n\nNATURAL SPEECH PATTERNS (inspired by top podcasts like Joe Rogan, SmartLess):
- CONTRACTIONS everywhere: "don't", "can't", "we're", "it's" (never "do not", "cannot")
- Trailing thoughts: occasional incomplete sentences that shift mid-stream
- Vary emotional delivery naturally - excited for discoveries, serious for important points, warm for personal moments
- MOOD: ${moodGuidance}
${disfluencyGuidance}${multiHostGuidance}
- Spontaneous reactions: "Oh wow", "Wait, what?", "That's incredible", "No way", "Really?"
- Conversational connectors (use sparingly): "I mean", "actually", "honestly", "basically"
- Vary sentence structure and length to avoid robotic cadence
- Make it sound like real friends chatting, NOT a scripted interview`;
  
  return podcastStyle === 'conversational' || podcastStyle === 'interview' 
    ? casualInstructions
    : podcastStyle === 'debate'
    ? `\n\nNATURAL SPEECH (Debate):
- CONTRACTIONS: "don't", "can't", "that's", "won't", "shouldn't"
- Vary emotional delivery based on argument flow - excited for agreements, tense for disagreements, serious for key claims
- MOOD: ${moodGuidance}
${disfluencyGuidance}${multiHostGuidance}
- ${numPeople > 1 ? 'Active disagreement: "But hold on", "That\'s not quite right", "With respect, I disagree"' : ''}
- Vary pacing and pitch to emphasize different argument strengths`
    : `\n\nNATURAL SPEECH:
- Use CONTRACTIONS: "don't", "can't", "we're", "it's", "there's"
- Vary emotional delivery naturally based on content - warm for welcoming, serious for important info, excited for discoveries
- MOOD: ${moodGuidance}
${disfluencyGuidance}${multiHostGuidance}
- Vary sentence rhythm and delivery to sound like real human conversation`;
}

