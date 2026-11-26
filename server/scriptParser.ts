import type { VoiceId } from '@shared/schema';

export interface SpeakerSegment {
  speaker: string;         // Speaker name (e.g., "Alex", "Sarah Johnson")
  text: string;           // The text to be spoken
  voice: VoiceId | string; // Assigned voice ID or Google voice name
  speakerIndex: number;   // Index for this speaker (0-4)
}

/**
 * Gemini 2.5 TTS supported emotion and vocalization tags
 * These tags are natively understood by Gemini TTS and should be preserved
 * Reference: https://cloud.google.com/text-to-speech/docs/gemini-tts
 */
const GEMINI_TTS_EMOTION_TAGS = new Set([
  // Vocalizations
  'laughter', 'laugh', 'laughing',
  'giggle', 'giggling',
  'chuckle', 'chuckling',
  'sigh', 'sighing',
  'gasp', 'gasping',
  'whisper', 'whispering',
  'shout', 'shouting',
  'scream', 'screaming',
  'cry', 'crying', 'sob', 'sobbing',
  'yawn', 'yawning',
  'cough', 'coughing',
  'sniff', 'sniffing',
  'hum', 'humming',
  'groan', 'groaning',
  'moan', 'moaning',
  
  // Emotions
  'happy', 'sad', 'angry', 'fearful', 'surprised', 'disgusted',
  'excited', 'nervous', 'calm', 'frustrated', 'scornful', 'melancholic',
  'cheerful', 'somber', 'dramatic', 'optimistic', 'serious', 'sarcastic',
  'confident', 'shy', 'embarrassed', 'proud', 'relieved', 'anxious',
  'hopeful', 'disappointed', 'amused', 'bored', 'curious', 'confused',
  'playful', 'tender', 'nostalgic', 'wistful', 'determined', 'defiant',
  
  // Tones and delivery styles
  'breathless', 'trembling', 'hesitant', 'enthusiastic',
  'matter-of-fact', 'deadpan', 'ironic', 'sincere', 'apologetic',
  'reassuring', 'warning', 'threatening', 'pleading', 'demanding',
  
  // Speech modifiers
  'speaking slowly', 'speaking fast', 'speaking softly', 'speaking loudly',
  'slowly', 'fast', 'softly', 'loudly', 'quietly',
  'extremely fast', 'very slow', 'dramatic pause',
  
  // Sound effects
  'clears throat', 'deep breath', 'exhale', 'inhale'
]);

/**
 * Check if a bracketed tag is a Gemini TTS emotion/vocalization tag
 * Supports exact matches, prefix matches with modifiers (e.g., "laugh softly"),
 * and tags with separators (e.g., "whisper - stage", "laugh: softly")
 */
function isEmotionTag(content: string): boolean {
  const normalized = content.toLowerCase().trim();
  
  // Exact match first
  if (GEMINI_TTS_EMOTION_TAGS.has(normalized)) {
    return true;
  }
  
  // Check if the content STARTS with a known emotion tag (handles modifiers like "laugh softly")
  // Split on common separators: space, colon, dash, comma
  const firstToken = normalized.split(/[\s:\-,]+/)[0];
  if (firstToken && GEMINI_TTS_EMOTION_TAGS.has(firstToken)) {
    return true;
  }
  
  // Check if any emotion tag is contained as a word boundary match
  // This handles cases like "soft laugh" or "nervous giggle"
  const emotionTagsArray = Array.from(GEMINI_TTS_EMOTION_TAGS);
  for (let i = 0; i < emotionTagsArray.length; i++) {
    const emotionTag = emotionTagsArray[i];
    // Use word boundary regex to avoid false positives
    const regex = new RegExp(`\\b${emotionTag}\\b`, 'i');
    if (regex.test(normalized)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Sanitizes text by removing non-verbal content, structural markup, and formatting
 * that should not be spoken aloud by TTS engines.
 * 
 * PRESERVES Gemini TTS emotion/vocalization tags like [laughter], [whisper], [excited]
 * 
 * Removes:
 * - Markdown symbols (*, _, #, etc.)
 * - Structural bracketed content: [HOST:], [INTRO], etc. (but NOT emotion tags)
 * - Parenthetical content and curly braces
 * - Speaker role labels (only common uppercase speaker names at start of line)
 * - Section headers and formatting
 * - Excessive whitespace
 * 
 * @param text - The raw text from the script
 * @returns Clean text with emotion tags preserved, ready for Gemini TTS
 */
export function sanitizeTextForSpeech(text: string): string {
  if (!text) return '';
  
  let cleanText = text;
  
  // Process square brackets: preserve emotion tags, remove structural markup
  cleanText = cleanText.replace(/\[([^\]]*)\]/g, (match, content) => {
    // Check if this is an emotion/vocalization tag to preserve
    if (isEmotionTag(content)) {
      return match; // Keep the emotion tag as-is
    }
    // Remove structural markup like [HOST:], [INTRO], [SECTION 1], etc.
    return '';
  });
  
  // Remove parenthetical and curly brace content (these are never emotion tags)
  cleanText = cleanText.replace(/\(.*?\)/g, '');
  cleanText = cleanText.replace(/\{.*?\}/g, '');
  
  // Remove ONLY known speaker role labels at start of lines (uppercase common names)
  // This prevents removing natural dialogue like "Breaking news: markets rally"
  const speakerLabels = [
    'HOST', 'CO-HOST', 'COHOST', 'NARRATOR', 'NARRATOR1', 'NARRATOR2',
    'SPEAKER', 'SPEAKER1', 'SPEAKER2', 'SPEAKER3', 'SPEAKER4',
    'ANCHOR', 'CORRESPONDENT', 'REPORTER', 'COMMENTATOR', 'COMMENTATOR1', 'COMMENTATOR2',
    'CHARACTER', 'CHARACTER1', 'CHARACTER2', 'GUEST', 'GUEST1', 'GUEST2',
    'MODERATOR', 'INTERVIEWER', 'INTERVIEWEE', 'EDUCATOR', 'GUIDE',
    'MARK', 'ALEX', 'SARAH', 'JOHN', 'EMMA', 'MICHAEL', 'LISA'
  ];
  
  const speakerPattern = new RegExp(`^(${speakerLabels.join('|')})\\s*:\\s*`, 'gim');
  cleanText = cleanText.replace(speakerPattern, '');
  
  // Remove markdown symbols
  cleanText = cleanText.replace(/\*+/g, ''); // Remove *, **, ***, etc.
  cleanText = cleanText.replace(/_+/g, ''); // Remove _, __, ___, etc.
  cleanText = cleanText.replace(/#{1,6}\s*/g, ''); // Remove #, ##, ###, etc.
  cleanText = cleanText.replace(/`+/g, ''); // Remove backticks
  cleanText = cleanText.replace(/~+/g, ''); // Remove strikethrough
  cleanText = cleanText.replace(/^[\-=]{3,}$/gm, ''); // Remove horizontal rules (---, ===)
  
  // Remove section markers and metadata
  cleanText = cleanText.replace(/^>\s*/gm, ''); // Remove blockquote markers
  cleanText = cleanText.replace(/^\s*[\-\*\+]\s+/gm, ''); // Remove list markers at line start
  cleanText = cleanText.replace(/^\s*\d+\.\s+/gm, ''); // Remove numbered list markers
  
  // Clean up excessive whitespace
  cleanText = cleanText.replace(/\s{2,}/g, ' '); // Replace multiple spaces with single space
  cleanText = cleanText.replace(/\n{3,}/g, '\n\n'); // Replace 3+ newlines with 2
  cleanText = cleanText.trim();
  
  return cleanText;
}

/**
 * Normalizes speaker names to consistent capitalization
 * Examples: "alex" -> "Alex", "sarah johnson" -> "Sarah Johnson"
 */
function normalizeSpeakerName(name: string): string {
  return name
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
    .trim();
}

/**
 * Parses a podcast script and splits it into speaker segments with assigned voices.
 * 
 * Supports TWO formats:
 * 1. Natural dialogue: "Alex:", "Sarah Johnson:", "Dr. Mike:"
 * 2. Legacy bracket format: [HOST:], [CO-HOST:]
 * 
 * Each speaker gets ONE consistent voice throughout the entire podcast.
 * Now supports both VoiceId (legacy) and Google voice names (custom voices)
 * 
 * @param script - The full podcast script with speaker labels
 * @param assignedVoices - Array of voice IDs (VoiceId or Google voice names) assigned to speakers in order
 * @returns Array of speaker segments with text and assigned voice
 */
export function parseScriptSegments(
  script: string,
  assignedVoices: (VoiceId | string)[]
): SpeakerSegment[] {
  if (!script) {
    throw new Error('Script is required for parsing');
  }
  
  if (assignedVoices.length === 0) {
    throw new Error('At least one voice must be assigned for podcast generation');
  }
  
  if (!assignedVoices[0]) {
    throw new Error('Primary voice cannot be null or undefined');
  }

  const segments: SpeakerSegment[] = [];
  
  // NEW: Natural dialogue format - "Alex:", "Sarah Johnson:", "Dr. Mike (Host):"
  // Detects speaker labels like "Alex:", "Alex Harper:", "Dr. Sarah Johnson:", "Sam (Host):"
  const naturalSpeakerPattern = /^([A-Za-z]+(?:\s+[A-Za-z]+){0,2})(?:\s*\([^)]*\)|\s*-\s*[^:]*)?:\s*/im;
  
  // LEGACY: Bracket format - [HOST:], [CO-HOST:]
  const bracketSpeakerPattern = /\[([A-Z][A-Z0-9\s-]*?)\s*:\s*\]/gi;
  
  // Try natural format first (preferred)
  const lines = script.split('\n');
  let hasNaturalFormat = false;
  
  // Check if script uses natural speaker format
  for (const line of lines) {
    if (line.trim().match(naturalSpeakerPattern)) {
      hasNaturalFormat = true;
      break;
    }
  }
  
  if (hasNaturalFormat) {
    // Use NEW natural dialogue parser
    return parseNaturalDialogue(script, assignedVoices);
  } else {
    // Use LEGACY bracket parser for backward compatibility
    return parseBracketFormat(script, assignedVoices);
  }
}

/**
 * Parses natural dialogue format: "Alex: Hello there", "Sarah: Great point!"
 * Each speaker gets ONE consistent voice throughout the entire podcast.
 * Now supports both VoiceId and Google voice names
 */
function parseNaturalDialogue(
  script: string,
  assignedVoices: (VoiceId | string)[]
): SpeakerSegment[] {
  const segments: SpeakerSegment[] = [];
  
  // Pattern detects speaker labels like "Alex:", "Alex Harper:", "Dr. Sarah Johnson:"
  const speakerPattern = /^([A-Za-z]+(?:\s+[A-Za-z]+){0,2})(?:\s*\([^)]*\)|\s*-\s*[^:]*)?:\s*/im;
  
  const lines = script.split('\n');
  
  // Map to track speaker name -> speaker index (for consistent voice assignment)
  const speakerToIndex = new Map<string, number>();
  let nextSpeakerIndex = 0;
  
  let currentSpeaker: string | null = null;
  let currentText = "";
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;
    
    const match = trimmedLine.match(speakerPattern);
    
    if (match) {
      // Found a new speaker label
      if (currentSpeaker && currentText) {
        // Save the previous segment
        const speakerIndex = speakerToIndex.get(currentSpeaker)!;
        const voice = assignedVoices[speakerIndex % assignedVoices.length];
        const cleanText = sanitizeTextForSpeech(currentText.trim());
        
        if (cleanText) {
          segments.push({
            speaker: currentSpeaker,
            text: cleanText,
            voice: voice as any, // Cast needed for Google voice names
            speakerIndex
          });
        }
        currentText = "";
      }
      
      // Normalize and register speaker
      const rawSpeakerName = match[1];
      currentSpeaker = normalizeSpeakerName(rawSpeakerName);
      
      // Assign index if this is a new speaker
      if (!speakerToIndex.has(currentSpeaker)) {
        speakerToIndex.set(currentSpeaker, nextSpeakerIndex);
        nextSpeakerIndex++;
      }
      
      // Get text after the speaker label
      currentText = trimmedLine.replace(speakerPattern, "");
    } else {
      // Continue current speaker's text
      currentText += (currentText ? " " : "") + trimmedLine;
    }
  }
  
  // Add the last segment
  if (currentSpeaker && currentText) {
    const speakerIndex = speakerToIndex.get(currentSpeaker)!;
    const voice = assignedVoices[speakerIndex % assignedVoices.length];
    const cleanText = sanitizeTextForSpeech(currentText.trim());
    
    if (cleanText) {
      segments.push({
        speaker: currentSpeaker,
        text: cleanText,
        voice: voice as any,
        speakerIndex
      });
    }
  }
  
  // If no speakers were found, treat entire script as single speaker
  if (segments.length === 0) {
    return [{
      speaker: 'Host',
      text: sanitizeTextForSpeech(script.trim()),
      voice: assignedVoices[0] as any,
      speakerIndex: 0
    }];
  }
  
  return segments;
}

/**
 * Parses legacy bracket format: [HOST:], [CO-HOST:]
 * Maintains backward compatibility with existing scripts.
 * Now supports both VoiceId and Google voice names
 */
function parseBracketFormat(
  script: string,
  assignedVoices: (VoiceId | string)[]
): SpeakerSegment[] {
  const segments: SpeakerSegment[] = [];
  const speakerPattern = /\[([A-Z][A-Z0-9\s-]*?)\s*:\s*\]/gi;
  
  // Map to track speaker name -> speaker index
  const speakerToIndex = new Map<string, number>();
  let nextSpeakerIndex = 0;
  
  let lastIndex = 0;
  let currentSpeaker = 'Host';
  let currentSpeakerIndex = 0;
  
  // Find all speaker markers
  const matches = Array.from(script.matchAll(speakerPattern));
  
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const speakerLabel = match[1];
    const matchIndex = match.index!;
    
    // Extract text from last match to this match
    if (i > 0) {
      const text = script.substring(lastIndex, matchIndex).trim();
      if (text) {
        const cleanText = sanitizeTextForSpeech(text);
        
        if (cleanText) {
          const voice = assignedVoices[currentSpeakerIndex % assignedVoices.length];
          
          segments.push({
            speaker: currentSpeaker,
            text: cleanText,
            voice: voice as any,
            speakerIndex: currentSpeakerIndex
          });
        }
      }
    }
    
    // Normalize speaker and assign index
    currentSpeaker = normalizeSpeakerName(speakerLabel);
    
    if (!speakerToIndex.has(currentSpeaker)) {
      speakerToIndex.set(currentSpeaker, nextSpeakerIndex);
      currentSpeakerIndex = nextSpeakerIndex;
      nextSpeakerIndex++;
    } else {
      currentSpeakerIndex = speakerToIndex.get(currentSpeaker)!;
    }
    
    lastIndex = matchIndex + match[0].length;
  }
  
  // Handle remaining text after last speaker marker
  if (lastIndex < script.length && matches.length > 0) {
    const text = script.substring(lastIndex).trim();
    if (text) {
      const cleanText = sanitizeTextForSpeech(text);
      
      if (cleanText) {
        const voice = assignedVoices[currentSpeakerIndex % assignedVoices.length];
        
        segments.push({
          speaker: currentSpeaker,
          text: cleanText,
          voice: voice as any,
          speakerIndex: currentSpeakerIndex
        });
      }
    }
  }
  
  // If no speaker markers found, treat entire script as single speaker
  if (segments.length === 0) {
    return [{
      speaker: 'Host',
      text: sanitizeTextForSpeech(script),
      voice: assignedVoices[0] as any,
      speakerIndex: 0
    }];
  }
  
  return segments;
}

/**
 * Merges consecutive segments from the same speaker to optimize TTS calls
 */
export function mergeConsecutiveSegments(segments: SpeakerSegment[]): SpeakerSegment[] {
  if (segments.length === 0) return segments;
  
  const merged: SpeakerSegment[] = [];
  let current = { ...segments[0] };
  
  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i];
    
    // If same speaker, merge the text
    if (segment.speakerIndex === current.speakerIndex && segment.voice === current.voice) {
      current.text += ' ' + segment.text;
    } else {
      // Different speaker, push current and start new
      merged.push(current);
      current = { ...segment };
    }
  }
  
  // Push the last segment
  merged.push(current);
  
  return merged;
}
