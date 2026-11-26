import { z } from 'zod';

/**
 * Structured JSON format for podcast scripts
 * Eliminates regex parsing and the "three-layer defense"
 */

export const emotionSchema = z.enum([
  // Core emotions
  'neutral',
  'cheerful',
  'serious',
  'tense',
  'dramatic',
  'calm',
  'excited',
  'warm',
  'playful',
  'contemplative',
  'questioning',
  'investigative',
  'conclusive',
  'empathetic',
  
  // Extended emotions for richer expression
  'confident',
  'surprised',
  'fearful',
  'angry',
  'sarcastic',
  'mocking',
  'witty',
  
  // Vocal effects (Gemini TTS supported)
  'whisper',
  'laugh',
  'giggle',
  'chuckle',
  'sigh',
  'gasp',
  'breath'
]);

export type Emotion = z.infer<typeof emotionSchema>;

export const scriptSegmentSchema = z.object({
  speaker: z.string().describe("Speaker name (e.g., 'Alex', 'Sarah Johnson')"),
  text: z.string().describe("The exact spoken text - natural language only, no markup"),
  emotion: emotionSchema.optional().describe("Primary emotion for this segment"),
  speakerIndex: z.number().min(0).max(4).describe("0-indexed speaker position (0-4)")
});

export type ScriptSegment = z.infer<typeof scriptSegmentSchema>;

export const podcastScriptSchema = z.object({
  segments: z.array(scriptSegmentSchema).min(1),
  metadata: z.object({
    totalSpeakers: z.number().min(1).max(5),
    estimatedDuration: z.string().optional().describe("Rough estimate like '5 minutes'"),
  }).optional()
});

export type PodcastScript = z.infer<typeof podcastScriptSchema>;

/**
 * Convert structured script to speaker segments for TTS
 */
export interface TTS_SpeakerSegment {
  speaker: string;
  text: string;
  voice: string;
  speakerIndex: number;
  emotion?: Emotion;
}
