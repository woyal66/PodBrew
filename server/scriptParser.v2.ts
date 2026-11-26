import type { VoiceId } from '@shared/schema';
import { podcastScriptSchema, type PodcastScript, type ScriptSegment } from '@shared/podcastScript';
import type { TTS_SpeakerSegment } from '@shared/podcastScript';

/**
 * JSON-based script parser - replaces regex-based parsing
 * Includes robust JSON repair for truncated GPT-4o responses
 */

/**
 * Attempt to repair truncated JSON by closing unclosed structures
 * Handles: unterminated strings, unclosed arrays, unclosed objects
 */
function repairTruncatedJSON(jsonStr: string): string {
  let repaired = jsonStr.trim();
  
  // Track open structures
  let inString = false;
  let escapeNext = false;
  const openBrackets: string[] = [];
  
  for (let i = 0; i < repaired.length; i++) {
    const char = repaired[i];
    
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    
    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }
    
    if (!inString) {
      if (char === '{' || char === '[') {
        openBrackets.push(char);
      } else if (char === '}') {
        if (openBrackets.length > 0 && openBrackets[openBrackets.length - 1] === '{') {
          openBrackets.pop();
        }
      } else if (char === ']') {
        if (openBrackets.length > 0 && openBrackets[openBrackets.length - 1] === '[') {
          openBrackets.pop();
        }
      }
    }
  }
  
  // Close unterminated string
  if (inString) {
    // Find last complete segment by looking for last complete text field
    const lastCompleteSegment = repaired.lastIndexOf('"},');
    const lastCompleteSegment2 = repaired.lastIndexOf('"}');
    const cutPoint = Math.max(lastCompleteSegment, lastCompleteSegment2);
    
    if (cutPoint > 0) {
      // Truncate to last complete segment
      repaired = repaired.substring(0, cutPoint + 2);
      console.log(`[JSONRepair] Truncated to last complete segment at position ${cutPoint}`);
    } else {
      // Last resort: close the string
      repaired += '"';
    }
  }
  
  // Recount open brackets after potential truncation
  inString = false;
  escapeNext = false;
  openBrackets.length = 0;
  
  for (let i = 0; i < repaired.length; i++) {
    const char = repaired[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (char === '\\') { escapeNext = true; continue; }
    if (char === '"' && !escapeNext) { inString = !inString; continue; }
    if (!inString) {
      if (char === '{' || char === '[') openBrackets.push(char);
      else if (char === '}' && openBrackets[openBrackets.length - 1] === '{') openBrackets.pop();
      else if (char === ']' && openBrackets[openBrackets.length - 1] === '[') openBrackets.pop();
    }
  }
  
  // Close remaining open brackets in reverse order
  while (openBrackets.length > 0) {
    const bracket = openBrackets.pop();
    if (bracket === '{') {
      // Check if we need to close a partial property
      if (repaired.match(/,\s*$/)) {
        repaired = repaired.replace(/,\s*$/, '');
      }
      repaired += '}';
    } else if (bracket === '[') {
      if (repaired.match(/,\s*$/)) {
        repaired = repaired.replace(/,\s*$/, '');
      }
      repaired += ']';
    }
  }
  
  return repaired;
}

/**
 * Extract valid segments from potentially truncated JSON
 * Uses regex to find complete segment objects
 */
function extractSegmentsFromPartialJSON(jsonStr: string): any[] {
  const segments: any[] = [];
  
  // Pattern to match complete segment objects
  const segmentPattern = /\{\s*"speaker"\s*:\s*"([^"]+)"\s*,\s*"text"\s*:\s*"([^"]*(?:\\.[^"]*)*)"\s*,\s*"emotion"\s*:\s*"([^"]+)"\s*,\s*"speakerIndex"\s*:\s*(\d+)\s*\}/g;
  
  let match;
  while ((match = segmentPattern.exec(jsonStr)) !== null) {
    segments.push({
      speaker: match[1],
      text: match[2].replace(/\\n/g, '\n').replace(/\\"/g, '"'),
      emotion: match[3],
      speakerIndex: parseInt(match[4], 10)
    });
  }
  
  // Also try alternative ordering (some GPT responses vary field order)
  const altPattern = /\{\s*"speaker"\s*:\s*"([^"]+)"\s*,\s*"speakerIndex"\s*:\s*(\d+)\s*,\s*"text"\s*:\s*"([^"]*(?:\\.[^"]*)*)"\s*,\s*"emotion"\s*:\s*"([^"]+)"\s*\}/g;
  
  while ((match = altPattern.exec(jsonStr)) !== null) {
    segments.push({
      speaker: match[1],
      text: match[3].replace(/\\n/g, '\n').replace(/\\"/g, '"'),
      emotion: match[4],
      speakerIndex: parseInt(match[2], 10)
    });
  }
  
  return segments;
}

export interface ParseResult {
  segments: TTS_SpeakerSegment[];
  parseMethod: 'json' | 'legacy_fallback';
}

/**
 * Infer speakerIndex from speaker names when GPT-4o omits them
 * Builds a mapping of speaker name → index based on order of appearance
 */
function inferSpeakerIndices(segments: any[], numHosts: number): any[] {
  const speakerToIndex = new Map<string, number>();
  let nextIndex = 0;
  
  return segments.map((segment: any) => {
    // If speakerIndex already exists and is valid, keep it
    if (typeof segment.speakerIndex === 'number' && segment.speakerIndex >= 0) {
      return segment;
    }
    
    // Get or assign index based on speaker name
    const speakerName = segment.speaker?.toLowerCase().trim();
    if (!speakerToIndex.has(speakerName)) {
      speakerToIndex.set(speakerName, nextIndex % numHosts);
      nextIndex++;
    }
    
    return {
      ...segment,
      speakerIndex: speakerToIndex.get(speakerName) ?? 0
    };
  });
}

/**
 * Parse structured JSON podcast script from GPT-4o
 * Now supports both VoiceId (legacy) and Google voice names (custom voices)
 */
export function parseJSONScript(
  jsonScript: string | PodcastScript,
  assignedVoices: (VoiceId | string)[]
): ParseResult {
  // Validate voices array
  if (!assignedVoices || assignedVoices.length === 0) {
    throw new Error('At least one voice must be assigned for podcast generation');
  }
  
  if (!assignedVoices[0]) {
    throw new Error('Primary voice cannot be null or undefined');
  }
  
  try {
    let scriptData: any;
    
    if (typeof jsonScript === 'string') {
      // First attempt: direct JSON parse
      try {
        scriptData = JSON.parse(jsonScript);
      } catch (parseError) {
        // Second attempt: repair truncated JSON
        console.log('[JSONParser] Initial parse failed, attempting JSON repair...');
        const repaired = repairTruncatedJSON(jsonScript);
        
        try {
          scriptData = JSON.parse(repaired);
          console.log('[JSONParser] Successfully parsed repaired JSON');
        } catch (repairError) {
          // Third attempt: extract segments directly via regex
          console.log('[JSONParser] Repair failed, extracting segments via regex...');
          const extractedSegments = extractSegmentsFromPartialJSON(jsonScript);
          
          if (extractedSegments.length >= 3) {
            // We have enough segments to make a podcast
            console.log(`[JSONParser] Extracted ${extractedSegments.length} segments from truncated response`);
            scriptData = { segments: extractedSegments };
          } else {
            throw parseError; // Re-throw original error
          }
        }
      }
    } else {
      scriptData = jsonScript;
    }
    
    // Pre-process: Infer missing speakerIndex from speaker names
    if (scriptData.segments && Array.isArray(scriptData.segments)) {
      const needsInference = scriptData.segments.some(
        (seg: any) => typeof seg.speakerIndex !== 'number'
      );
      if (needsInference) {
        console.log('[ScriptParsing] Inferring missing speakerIndex from speaker names');
        scriptData.segments = inferSpeakerIndices(scriptData.segments, assignedVoices.length);
      }
    }
    
    // Validate against schema
    const validated = podcastScriptSchema.parse(scriptData);
    
    // Convert to TTS segments
    // Note: voice is always a Gemini voice name from the database (November 2025)
    const segments: TTS_SpeakerSegment[] = validated.segments.map((segment: ScriptSegment) => {
      const assignedVoice = assignedVoices[segment.speakerIndex % assignedVoices.length];
      return {
        speaker: segment.speaker,
        text: segment.text.trim(),
        voice: assignedVoice as any, // Cast needed for string Google voice names
        speakerIndex: segment.speakerIndex,
        emotion: segment.emotion
      };
    });
    
    // Merge consecutive segments from same speaker
    const merged = mergeConsecutiveSpeakers(segments);
    
    console.log(`[JSONParser] Parsed ${validated.segments.length} segments, merged to ${merged.length} segments`);
    
    return {
      segments: merged,
      parseMethod: 'json'
    };
    
  } catch (error) {
    console.error('[JSONParser] Failed to parse JSON script:', error);
    throw new Error(`Invalid JSON podcast script: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Merge consecutive segments from the same speaker to optimize TTS calls
 */
function mergeConsecutiveSpeakers(segments: TTS_SpeakerSegment[]): TTS_SpeakerSegment[] {
  if (segments.length === 0) return segments;
  
  const merged: TTS_SpeakerSegment[] = [];
  let current = { ...segments[0] };
  
  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i];
    
    // Merge if same speaker and voice
    if (segment.speakerIndex === current.speakerIndex && segment.voice === current.voice) {
      current.text += ' ' + segment.text;
      // Keep the emotion of the first segment in the merge
    } else {
      merged.push(current);
      current = { ...segment };
    }
  }
  
  merged.push(current);
  
  return merged;
}

/**
 * Legacy fallback: Parse old text-based format
 * Only used if JSON parsing fails (backward compatibility)
 * Now supports both VoiceId (legacy) and Google voice names (custom voices)
 */
export async function parseLegacyTextScript(
  script: string,
  assignedVoices: (VoiceId | string)[]
): Promise<ParseResult> {
  const { parseScriptSegments, mergeConsecutiveSegments } = await import('./scriptParser');
  
  // Legacy parser now supports both VoiceId and Google voice names
  const legacySegments = parseScriptSegments(script, assignedVoices);
  const merged = mergeConsecutiveSegments(legacySegments);
  
  // Convert to new format
  const segments: TTS_SpeakerSegment[] = merged.map(seg => ({
    speaker: seg.speaker,
    text: seg.text,
    voice: seg.voice as any, // Cast needed for string Google voice names
    speakerIndex: seg.speakerIndex
  }));
  
  console.log(`[LegacyParser] Used legacy parser. Parsed ${merged.length} segments`);
  
  return {
    segments,
    parseMethod: 'legacy_fallback'
  };
}
