/**
 * Script Builder - Simple podcast script generation
 * 
 * Clean implementation:
 * - Single GPT-4o call for script generation
 * - Duration control via character target
 * - Simple JSON output format
 */

import OpenAI from 'openai';
import { getLanguageName } from './languageUtils';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Default words per second for TTS voices (calibrated for Gemini TTS)
// Typical speaking rate: ~2.5 words/second = 150 words/min
const DEFAULT_WPS = 2.5;
// Average characters per word
const CHARS_PER_WORD = 6;

export interface ScriptSegment {
  speaker: string;
  text: string;
}

export interface GeneratedScript {
  title: string;
  segments: ScriptSegment[];
  totalChars: number;
  estimatedMinutes: number;
}

export interface ScriptOptions {
  topic: string;
  durationMinutes: number;
  hostName?: string;
  coHostName?: string;
  style?: 'conversational' | 'narrative' | 'educational';
  // Extended settings for full customization
  mood?: string;
  languageComplexity?: number; // 1-10 scale
  coHostPersonality?: string;
  language?: string;
  // Voice-calibrated WPS for accurate duration targeting
  voiceWps?: number;
}

/**
 * Generate a podcast script for the given topic and duration
 * Uses voice-calibrated WPS for accurate duration targeting with 5% buffer
 * For very long podcasts (>25 min), uses chunked generation to hit target
 */
export async function generateScript(options: ScriptOptions): Promise<GeneratedScript> {
  const {
    topic,
    durationMinutes,
    hostName = 'Host',
    coHostName,
    style = 'conversational',
    mood,
    languageComplexity = 5,
    coHostPersonality,
    language = 'en',
    voiceWps = DEFAULT_WPS
  } = options;

  // Calculate target with 5% buffer to guarantee meeting duration
  const bufferMultiplier = 1.05;
  const targetChars = Math.round(durationMinutes * bufferMultiplier * 60 * voiceWps * CHARS_PER_WORD);
  const targetWords = Math.round(targetChars / CHARS_PER_WORD);
  const charsPerMinute = voiceWps * 60 * CHARS_PER_WORD;
  const isSingleHost = !coHostName;

  console.log(`[Script] Generating ${durationMinutes}-min ${style} script for: "${topic.substring(0, 50)}..."`);
  console.log(`[Script] Voice WPS: ${voiceWps}, Target: ${targetChars} chars (${targetWords} words) with 5% buffer`);
  console.log(`[Script] Settings: mood=${mood || 'default'}, complexity=${languageComplexity}, personality=${coHostPersonality || 'default'}, lang=${language}`);

  const systemPrompt = isSingleHost
    ? buildSingleHostPrompt(hostName, style, mood, languageComplexity, language)
    : buildTwoHostPrompt(hostName, coHostName!, style, mood, languageComplexity, coHostPersonality, language);

  // Podcasts >10 min use CHUNKED generation with 7-min sections.
  // GPT-4o reliably generates ~7 min of content per call; single-call attempts at 15-20 min
  // produce only ~50% of target (GPT stops when the script "feels complete"). Chunked mode
  // with 7-min sections (3 calls for 20 min) hits the full target.
  // Continuity rules in generateChunkedScript prevent double-episode re-introduction seams.
  const CHUNK_MINUTES = 7; // Generate in 7-minute sections for reliable full-length output

  if (durationMinutes > 10) {
    console.log(`[Script] Long podcast detected (${durationMinutes} min) - using CHUNKED generation`);
    return await generateChunkedScript(
      topic, durationMinutes, targetChars, charsPerMinute,
      hostName, coHostName, isSingleHost, systemPrompt, style, mood, languageComplexity, language
    );
  }

  // Short podcasts: use standard generation
  const minSegments = Math.ceil(durationMinutes * 4);
  let script = await generateInitialScript(
    topic, durationMinutes, targetWords, targetChars, minSegments,
    hostName, coHostName, isSingleHost, systemPrompt
  );

  // Expand script if too short — single targeted call for the full deficit, one retry if still short
  const minChars = Math.round(targetChars * 0.95);

  if (script.totalChars < minChars) {
    const deficit = targetChars - script.totalChars;
    const deficitWords = Math.round(deficit / CHARS_PER_WORD);
    console.log(`[Script] Script too short (${script.totalChars}/${minChars} chars). Expanding by ${deficitWords} words in one shot...`);
    script = await expandScript(script, deficitWords, topic, hostName, coHostName, isSingleHost, systemPrompt);

    // One retry if still short
    if (script.totalChars < minChars) {
      const remainingDeficit = targetChars - script.totalChars;
      const remainingDeficitWords = Math.round(remainingDeficit / CHARS_PER_WORD);
      console.log(`[Script] Still short after expansion (${script.totalChars}/${minChars} chars). Retry expanding by ${remainingDeficitWords} words...`);
      script = await expandScript(script, remainingDeficitWords, topic, hostName, coHostName, isSingleHost, systemPrompt);
    }
  }

  const estimatedMinutes = script.totalChars / charsPerMinute;
  const percentOfTarget = ((script.totalChars / targetChars) * 100).toFixed(1);
  console.log(`[Script] Final: "${script.title}" - ${script.segments.length} segments, ${script.totalChars} chars (~${estimatedMinutes.toFixed(1)} min, ${percentOfTarget}% of target)`);

  return {
    title: script.title,
    segments: script.segments,
    totalChars: script.totalChars,
    estimatedMinutes
  };
}

/**
 * Generate a long podcast script by creating multiple sections and combining them
 * Each section is generated independently with context from previous sections
 */
async function generateChunkedScript(
  topic: string,
  totalMinutes: number,
  targetChars: number,
  charsPerMinute: number,
  hostName: string,
  coHostName: string | undefined,
  isSingleHost: boolean,
  systemPrompt: string,
  style: string,
  mood: string | undefined,
  languageComplexity: number,
  language: string
): Promise<GeneratedScript> {
  const SECTION_MINUTES = 7; // Each section targets 7 minutes — GPT-4o reliably fills this
  const numSections = Math.ceil(totalMinutes / SECTION_MINUTES);
  const charsPerSection = Math.round(targetChars / numSections);
  const wordsPerSection = Math.round(charsPerSection / CHARS_PER_WORD);
  
  console.log(`[Script] Chunked generation: ${numSections} sections × ${SECTION_MINUTES} min = ${totalMinutes} min target`);
  console.log(`[Script] Each section: ${charsPerSection} chars (~${wordsPerSection} words)`);

  // Generate outline first to ensure coherent structure
  const outline = await generateOutline(topic, numSections, hostName, coHostName, isSingleHost, style);
  console.log(`[Script] Generated outline with ${outline.length} sections`);

  const allSegments: ScriptSegment[] = [];
  let podcastTitle = '';
  let previousSectionSummary = '';

  for (let i = 0; i < numSections; i++) {
    const sectionTopic = outline[i] || `Section ${i + 1}: Continue exploring ${topic}`;
    const isFirst = i === 0;
    const isLast = i === numSections - 1;
    
    console.log(`[Script] Generating section ${i + 1}/${numSections}: "${sectionTopic.substring(0, 50)}..."`);

    const sectionScript = await generateSection(
      topic, sectionTopic, SECTION_MINUTES, wordsPerSection, charsPerSection,
      hostName, coHostName, isSingleHost, systemPrompt,
      isFirst, isLast, previousSectionSummary
    );

    if (isFirst && sectionScript.title) {
      podcastTitle = sectionScript.title;
    }

    allSegments.push(...sectionScript.segments);
    
    // Create summary of this section for context in next section
    const sectionText = sectionScript.segments.map(s => s.text).join(' ');
    previousSectionSummary = sectionText.substring(sectionText.length - 500); // Last 500 chars as context

    console.log(`[Script] Section ${i + 1} complete: ${sectionScript.segments.length} segments, ${sectionScript.totalChars} chars`);
  }

  const totalCharsGenerated = allSegments.reduce((sum, seg) => sum + seg.text.length, 0);
  const estimatedMinutes = totalCharsGenerated / charsPerMinute;
  const percentOfTarget = ((totalCharsGenerated / targetChars) * 100).toFixed(1);

  console.log(`[Script] Chunked generation complete: ${allSegments.length} total segments, ${totalCharsGenerated} chars (~${estimatedMinutes.toFixed(1)} min, ${percentOfTarget}% of target)`);

  return {
    title: podcastTitle || `Deep Dive: ${topic.substring(0, 40)}`,
    segments: allSegments,
    totalChars: totalCharsGenerated,
    estimatedMinutes
  };
}

/**
 * Generate an outline for a multi-section podcast
 */
async function generateOutline(
  topic: string,
  numSections: number,
  hostName: string,
  coHostName: string | undefined,
  isSingleHost: boolean,
  style: string
): Promise<string[]> {
  const outlinePrompt = `Create a ${numSections}-part outline for a detailed podcast about: ${topic}

Each part should be a distinct subtopic or angle that builds on the previous parts.
The outline should create a natural narrative flow through the entire podcast.

Format: Return a JSON array of ${numSections} strings, each describing one section's focus.
Example: ["Introduction and hook about the topic", "Deep dive into first aspect", "Exploring second angle", "Real-world examples and stories", "Key takeaways and conclusion"]

Return ONLY valid JSON array, no explanation.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a podcast outline generator. Return only valid JSON arrays.' },
        { role: 'user', content: outlinePrompt }
      ],
      max_tokens: 1000,
      temperature: 0.7,
      response_format: { type: 'json_object' }
    });

    const content = response.choices[0].message.content?.trim() || '{}';
    const parsed = JSON.parse(content);
    
    // Handle both array and object with sections property
    if (Array.isArray(parsed)) {
      return parsed;
    } else if (parsed.sections && Array.isArray(parsed.sections)) {
      return parsed.sections;
    } else if (parsed.outline && Array.isArray(parsed.outline)) {
      return parsed.outline;
    }
    
    // Fallback: generate generic sections
    return Array.from({ length: numSections }, (_, i) => 
      i === 0 ? `Introduction to ${topic}` :
      i === numSections - 1 ? `Conclusion and key takeaways` :
      `Exploring aspect ${i + 1} of ${topic}`
    );
  } catch (error: any) {
    console.error('[Script] Outline generation failed:', error.message);
    // Fallback outline
    return Array.from({ length: numSections }, (_, i) => 
      i === 0 ? `Introduction to ${topic}` :
      i === numSections - 1 ? `Conclusion and key takeaways` :
      `Exploring aspect ${i + 1} of ${topic}`
    );
  }
}

/**
 * Generate a single section of a multi-part podcast
 */
async function generateSection(
  mainTopic: string,
  sectionFocus: string,
  sectionMinutes: number,
  targetWords: number,
  targetChars: number,
  hostName: string,
  coHostName: string | undefined,
  isSingleHost: boolean,
  systemPrompt: string,
  isFirst: boolean,
  isLast: boolean,
  previousContext: string
): Promise<GeneratedScript> {
  const minSegments = Math.ceil(sectionMinutes * 4);
  
  let contextInstruction = '';
  if (isFirst) {
    contextInstruction = `This is the OPENING section. Start with an engaging hook and introduction.\n\n⚠️ NO CLOSING ALLOWED:\n- Do NOT end with any sign-off, goodbye, outro, wrap-up, "thanks for listening", or conclusion.\n- The conversation CONTINUES in the next section — end mid-discussion or mid-point as if more is coming.\n- Leave the listener wanting to hear what comes next.`;
  } else if (isLast) {
    contextInstruction = `This is the FINAL section. Wrap up with conclusions, key takeaways, and a satisfying ending.\n\n⚠️ CONTINUITY RULES (CRITICAL):\n- Do NOT open with a new episode introduction, welcome, or title sequence.\n- Do NOT say "Welcome back", "Today on…", "In this episode", or any episode-opening phrase.\n- Jump straight into the conversation as a seamless continuation — the listener is already mid-episode.\nPrevious context: "${previousContext.substring(0, 300)}..."`;
  } else {
    contextInstruction = `This is a MIDDLE section. Continue naturally from the previous discussion.\n\n⚠️ CONTINUITY RULES (CRITICAL — read carefully):\n- Do NOT open with a new episode introduction, welcome, or title sequence.\n- Do NOT say "Welcome back", "Today on…", "In this episode", or any episode-opening phrase.\n- Jump straight into the conversation as a seamless continuation — the listener is already mid-episode.\n- Do NOT end with any sign-off, goodbye, outro, wrap-up, "thanks for listening", or conclusion.\n- The conversation CONTINUES in the next section — end mid-discussion or mid-point as if more is coming.\nPrevious context: "${previousContext.substring(0, 300)}..."`;
  }

  const sectionPrompt = `Create a ${sectionMinutes}-minute podcast section about: ${sectionFocus}

MAIN TOPIC: ${mainTopic}

${contextInstruction}

⚠️ CRITICAL LENGTH REQUIREMENTS:
- MINIMUM word count: ${targetWords} words (${targetChars} characters)
- MINIMUM segments: ${minSegments} dialogue exchanges
- Each segment: 40-80 words of rich, detailed dialogue
- TTS speaks at ~150 words/minute, so ${sectionMinutes} minutes = ${targetWords} words MINIMUM

HOW TO ACHIEVE LENGTH:
- Include detailed examples with specific names, dates, statistics
- Add personal anecdotes and illustrative stories
- Explore multiple perspectives on each point
- Use descriptive language and vivid details
- Include follow-up questions and deeper exploration
- Reference related interesting facts and connections

Output valid JSON only:
{
  ${isFirst ? '"title": "Catchy podcast title (max 8 words)",' : ''}
  "segments": [
    {"speaker": "${hostName}", "text": "Full dialogue for this turn..."}${!isSingleHost ? `,
    {"speaker": "${coHostName}", "text": "Full response and reaction..."}` : ''}
  ]
}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: sectionPrompt }
      ],
      max_tokens: 8000,
      temperature: 0.8,
      response_format: { type: 'json_object' }
    });

    const content = response.choices[0].message.content?.trim() || '{}';
    const parsed = JSON.parse(content);

    const segments: ScriptSegment[] = parsed.segments || [];
    const totalChars = segments.reduce((sum, seg) => sum + seg.text.length, 0);

    return {
      title: parsed.title || '',
      segments,
      totalChars,
      estimatedMinutes: 0
    };

  } catch (error: any) {
    console.error('[Script] Section generation error:', error.message);
    throw new Error(`Section generation failed: ${error.message}`);
  }
}

/**
 * Generate initial script with strong length enforcement
 */
async function generateInitialScript(
  topic: string,
  durationMinutes: number,
  targetWords: number,
  targetChars: number,
  minSegments: number,
  hostName: string,
  coHostName: string | undefined,
  isSingleHost: boolean,
  systemPrompt: string
): Promise<GeneratedScript> {
  
  const userPrompt = `Create a ${durationMinutes}-minute podcast script about: ${topic}

⚠️ CRITICAL LENGTH REQUIREMENTS - YOU MUST MEET THESE EXACTLY:
- MINIMUM word count: ${targetWords} words (${targetChars} characters)
- MINIMUM segments: ${minSegments} segments
- Each segment: 30-60 words of rich, detailed dialogue
- This is NON-NEGOTIABLE. Scripts shorter than ${targetWords} words will be REJECTED.
- TTS speaks at ~150 words/minute, so ${durationMinutes} minutes = ${targetWords} words MINIMUM.

HOW TO ACHIEVE LENGTH:
- Include detailed examples with specific names, dates, and numbers
- Add personal anecdotes and stories
- Explain concepts thoroughly with multiple perspectives
- Use descriptive language and vivid details
- Include follow-up questions and deeper exploration
- Add interesting tangents and related insights

CONTENT REQUIREMENTS:
- Cover the topic thoroughly with specific examples, anecdotes, and details
- Include an engaging introduction and satisfying conclusion
- Make it informative, entertaining, and conversational

Output valid JSON only:
{
  "title": "Catchy podcast title (max 8 words)",
  "segments": [
    {"speaker": "${hostName}", "text": "Full dialogue for this turn..."}${!isSingleHost ? `,
    {"speaker": "${coHostName}", "text": "Full dialogue for this turn..."}` : ''}
  ]
}`;

  try {
    // Set max_tokens to 3x target chars to ensure room for full generation
    const maxTokens = Math.max(8000, Math.min(16000, targetChars * 3));
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: maxTokens,
      temperature: 0.8,
      response_format: { type: 'json_object' }
    });

    const content = response.choices[0].message.content?.trim() || '{}';
    const parsed = JSON.parse(content);

    const segments: ScriptSegment[] = parsed.segments || [];
    const totalChars = segments.reduce((sum, seg) => sum + seg.text.length, 0);

    console.log(`[Script] Initial generation: "${parsed.title}" - ${segments.length} segments, ${totalChars} chars`);

    return {
      title: parsed.title || topic.substring(0, 50),
      segments,
      totalChars,
      estimatedMinutes: 0 // Will be calculated by caller
    };

  } catch (error: any) {
    console.error('[Script] Generation error:', error.message);
    throw new Error(`Script generation failed: ${error.message}`);
  }
}

/**
 * Expand an existing script by adding more content
 */
async function expandScript(
  currentScript: GeneratedScript,
  additionalWords: number,
  topic: string,
  hostName: string,
  coHostName: string | undefined,
  isSingleHost: boolean,
  systemPrompt: string
): Promise<GeneratedScript> {
  
  const expansionPrompt = `The following podcast script is TOO SHORT. Add approximately ${additionalWords} more words of content.

CURRENT SCRIPT (expand this):
${JSON.stringify(currentScript.segments, null, 2)}

TOPIC: ${topic}

EXPANSION REQUIREMENTS:
- Add ${additionalWords} words of NEW content
- Insert new segments throughout the script (not just at the end)
- Expand existing segments with more details, examples, and anecdotes
- Maintain natural conversation flow
- Keep the same title

Output the COMPLETE expanded script as valid JSON:
{
  "title": "${currentScript.title}",
  "segments": [
    {"speaker": "${hostName}", "text": "..."}${!isSingleHost ? `,
    {"speaker": "${coHostName}", "text": "..."}` : ''}
  ]
}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt + '\n\nYou are expanding an existing script. Add more detailed content throughout.' },
        { role: 'user', content: expansionPrompt }
      ],
      max_tokens: 12000,
      temperature: 0.8,
      response_format: { type: 'json_object' }
    });

    const content = response.choices[0].message.content?.trim() || '{}';
    const parsed = JSON.parse(content);

    const segments: ScriptSegment[] = parsed.segments || currentScript.segments;
    const totalChars = segments.reduce((sum, seg) => sum + seg.text.length, 0);

    console.log(`[Script] Expansion complete: ${segments.length} segments, ${totalChars} chars (+${totalChars - currentScript.totalChars})`);

    return {
      title: currentScript.title,
      segments,
      totalChars,
      estimatedMinutes: 0
    };

  } catch (error: any) {
    console.error('[Script] Expansion error:', error.message);
    // Return original script if expansion fails
    return currentScript;
  }
}

function buildSingleHostPrompt(hostName: string, style: string, mood?: string, languageComplexity: number = 5, language: string = 'en'): string {
  const complexityGuide = languageComplexity <= 3 
    ? 'Use simple vocabulary, short sentences, and explain concepts clearly. Suitable for general audiences.'
    : languageComplexity <= 6
    ? 'Use moderate vocabulary with some technical terms explained. Balanced for most listeners.'
    : 'Use sophisticated vocabulary and complex ideas. Assume an educated, knowledgeable audience.';
  
  const moodGuide = mood 
    ? `\nTone/Mood: The podcast should feel ${mood}. Let this mood influence word choice, pacing, and delivery style.`
    : '';
  
  const languageName = getLanguageName(language);
  const languageGuide = language !== 'en' 
    ? `\nLanguage: Write the entire script in ${languageName}. Use natural expressions and idioms from that language. Every word of dialogue must be in ${languageName} — do not fall back to English.`
    : '';

  return `You are an expert podcast scriptwriter. Write engaging, natural-sounding scripts for a single host named ${hostName}.

Style: ${style}
- conversational: Warm, friendly, like talking to a friend
- narrative: Storytelling with clear structure and flow
- educational: Clear explanations with examples

Language Complexity (${languageComplexity}/10): ${complexityGuide}${moodGuide}${languageGuide}

Rules:
1. Write natural spoken language (contractions, filler words OK)
2. Include smooth transitions between topics
3. Open with an engaging hook
4. Close with a clear conclusion
5. Output valid JSON only - no markdown, no explanation

⚠️ CRITICAL - TEXT MUST BE CLEAN FOR SPEECH SYNTHESIS:
- NEVER include citation brackets like [1], [2], [3], [citation], [source], or [pause]
- NEVER include parenthetical citations like (1), (Smith, 2023)
- NEVER include angle brackets, SSML tags, or any markup
- Write ONLY natural spoken dialogue that can be read aloud directly

🎭 VOCAL EFFECT TAGS — use these bracket tags when content or mood calls for it:
- [laugh]    — audible laughter (use freely for funny moments)
- [chuckle]  — light amused chuckle
- [giggle]   — bright giggle
- [sigh]     — audible sigh (frustration, relief, exasperation)
- [gasp]     — sharp gasp of surprise or shock
- [breath]   — audible breath (composing oneself)
- [yawn]     — yawn (tiredness, boredom)
- [clear-throat] — throat clearing before making a point
Example: "And then the CEO tripped on the ethernet cable. [laugh] I'm not even kidding."
For humorous, emotional, or dramatic content use these liberally — they produce real audible sounds in the final audio.`;
}

function buildTwoHostPrompt(hostName: string, coHostName: string, style: string, mood?: string, languageComplexity: number = 5, coHostPersonality?: string, language: string = 'en'): string {
  const complexityGuide = languageComplexity <= 3 
    ? 'Use simple vocabulary, short sentences, and explain concepts clearly. Suitable for general audiences.'
    : languageComplexity <= 6
    ? 'Use moderate vocabulary with some technical terms explained. Balanced for most listeners.'
    : 'Use sophisticated vocabulary and complex ideas. Assume an educated, knowledgeable audience.';
  
  const moodGuide = mood 
    ? `\nTone/Mood: The podcast should feel ${mood}. Let this mood influence word choice, pacing, and delivery style.`
    : '';
  
  const personalityGuide = coHostPersonality 
    ? `\nCo-host Personality: ${coHostName} should embody a "${coHostPersonality}" personality - let this shape their reactions, questions, and speaking style.`
    : '';
  
  const languageName = getLanguageName(language);
  const languageGuide = language !== 'en' 
    ? `\nLanguage: Write the entire script in ${languageName}. Use natural expressions and idioms from that language. Every word of dialogue must be in ${languageName} — do not fall back to English.`
    : '';

  return `You are an expert podcast scriptwriter. Write engaging dialogue between two hosts: ${hostName} (main host) and ${coHostName} (co-host).

Style: ${style}
- conversational: Natural banter, questions and reactions
- narrative: Collaborative storytelling
- educational: Teacher and curious learner dynamic

Language Complexity (${languageComplexity}/10): ${complexityGuide}${moodGuide}${personalityGuide}${languageGuide}

Rules:
1. Alternate speakers naturally (not rigidly)
2. Include reactions, questions, and genuine interactions
3. Each speaker should have distinct personality
4. Write natural spoken language
5. Open with engaging hook, close with clear conclusion
6. Output valid JSON only - no markdown, no explanation

⚠️ CRITICAL - TEXT MUST BE CLEAN FOR SPEECH SYNTHESIS:
- NEVER include citation brackets like [1], [2], [3], [citation], [source], or [pause]
- NEVER include parenthetical citations like (1), (Smith, 2023)
- NEVER include angle brackets, SSML tags, or any markup
- Write ONLY natural spoken dialogue that can be read aloud directly

🎭 VOCAL EFFECT TAGS — use these bracket tags when content or mood calls for it:
- [laugh]    — audible laughter (use freely for funny moments)
- [chuckle]  — light amused chuckle
- [giggle]   — bright giggle
- [sigh]     — audible sigh (frustration, relief, exasperation)
- [gasp]     — sharp gasp of surprise or shock
- [breath]   — audible breath (composing oneself)
- [yawn]     — yawn (tiredness, boredom)
- [clear-throat] — throat clearing before making a point
Example: "Oh wow, they deleted the production database by accident. [laugh] Classic Monday morning."
For humorous, emotional, or dramatic content use these liberally — they produce real audible sounds in the final audio.`;
}

/**
 * Generate a simple title for the podcast
 */
export async function generateTitle(topic: string): Promise<string> {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Generate a catchy podcast title in 5-8 words. Output only the title, nothing else.'
        },
        { role: 'user', content: topic }
      ],
      max_tokens: 50,
      temperature: 0.8
    });

    return response.choices[0].message.content?.trim() || topic.substring(0, 50);
  } catch {
    return topic.substring(0, 50);
  }
}
