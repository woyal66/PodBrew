import type { VoiceId } from './schema';

/**
 * Maps voice IDs to human names for display purposes
 * These names are used when showing host assignments in the UI
 */
export const VOICE_HUMAN_NAMES: Record<VoiceId, string> = {
  // Premium US Collection - Professional & Strong Tones
  'ash': 'Marcus',
  'coral': 'Aria',
  'sage': 'Ethan',
  'river': 'River',
  'sky': 'Skylar',
  
  // Premium UK Collection - Elegant & Refined Tones
  'ember': 'Emma',
  'luna': 'Morpheus',
  'sol': 'Leo',
  'iris': 'Iris',
  
  // Australian Collection - Energetic & Warm Tones
  'jade': 'Jade',
  'ruby': 'Ruby',
  'amber': 'Amber',
  'atlas': 'Atlas',
  
  // Cinematic Collection - Artistic & Expressive Tones
  'lyra': 'Lyra',
};

/**
 * Additional mapping for special voice names (news anchors, etc.)
 */
const SPECIAL_VOICE_NAMES: Record<string, string> = {
  'anchor-k': 'Katherine',
  'anchor-l': 'Lauren',
  'anchor-n': 'Nicholas',
};

/**
 * Get human name for a voice ID, with fallback
 */
export function getVoiceHumanName(voiceId: VoiceId | string): string {
  // Check regular voice IDs first
  if (voiceId in VOICE_HUMAN_NAMES) {
    return VOICE_HUMAN_NAMES[voiceId as VoiceId];
  }
  
  // Check special voice names (news anchors, etc.)
  if (voiceId in SPECIAL_VOICE_NAMES) {
    return SPECIAL_VOICE_NAMES[voiceId];
  }
  
  // Fallback: capitalize first letter and return
  return voiceId.charAt(0).toUpperCase() + voiceId.slice(1);
}
