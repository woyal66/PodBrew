/**
 * Mood-to-Voice Matching System
 * 
 * Maps podcast moods to suitable voice archetypes for optimal emotional delivery.
 * This ensures that the selected voices naturally align with the podcast's intended mood.
 */

import type { Voice } from '@shared/schema';

export type PodcastMood = 'uplifting' | 'serious' | 'humorous' | 'mysterious' | 'balanced' | 'energetic';

// Voice archetype constants
export const VOICE_ARCHETYPES = ['warm', 'professional', 'energetic', 'calm', 'authoritative'] as const;
export type VoiceArchetype = typeof VOICE_ARCHETYPES[number];

// Scoring constants (exposed for future tuning)
export const MOOD_SCORE_WEIGHTS = {
  PRIMARY_MATCH: 2,
  SECONDARY_MATCH: 1,
  NO_MATCH: 0,
  FAVORITE_BOOST: 0.5, // Optional future enhancement
  GENDER_BOOST: 0.3, // Optional future enhancement
} as const;

/**
 * Mood-to-Voice Archetype Mapping
 * Each mood is associated with preferred voice archetypes (primary) and acceptable alternatives (secondary)
 */
export const MOOD_VOICE_MAPPING: Record<PodcastMood, { primary: VoiceArchetype[]; secondary: VoiceArchetype[] }> = {
  // Uplifting: Optimistic & inspiring
  uplifting: {
    primary: ['warm', 'energetic'],
    secondary: ['professional', 'calm'],
  },
  
  // Serious: Professional & thoughtful
  serious: {
    primary: ['professional', 'authoritative'],
    secondary: ['calm'],
  },
  
  // Humorous: Light & entertaining
  humorous: {
    primary: ['energetic', 'warm'],
    secondary: ['professional'],
  },
  
  // Mysterious: Intriguing & suspenseful
  mysterious: {
    primary: ['calm', 'authoritative'],
    secondary: ['professional'],
  },
  
  // Balanced: Even & neutral (default)
  balanced: {
    primary: ['professional', 'calm', 'warm'],
    secondary: ['authoritative', 'energetic'],
  },
  
  // Energetic: Dynamic & enthusiastic
  energetic: {
    primary: ['energetic', 'warm'],
    secondary: ['professional'],
  },
};

/**
 * Score a voice based on how well it matches the selected mood
 * Higher score = better match
 */
export function getVoiceMoodScore(voice: Voice, mood: PodcastMood): number {
  if (!voice.toneArchetype) {
    return MOOD_SCORE_WEIGHTS.NO_MATCH; // Voices without tone archetype get neutral score
  }

  const mapping = MOOD_VOICE_MAPPING[mood];
  const archetype = voice.toneArchetype as VoiceArchetype;
  
  // Primary match: highest score
  if (mapping.primary.includes(archetype)) {
    return MOOD_SCORE_WEIGHTS.PRIMARY_MATCH;
  }
  
  // Secondary match: moderate score
  if (mapping.secondary.includes(archetype)) {
    return MOOD_SCORE_WEIGHTS.SECONDARY_MATCH;
  }
  
  // No match: neutral score
  return MOOD_SCORE_WEIGHTS.NO_MATCH;
}

/**
 * Filter and sort voices by mood compatibility
 * Returns voices sorted by mood match score (best matches first)
 */
export function filterVoicesByMood(voices: Voice[], mood: PodcastMood): Voice[] {
  // Score all voices
  const scoredVoices = voices.map(voice => ({
    voice,
    score: getVoiceMoodScore(voice, mood),
  }));
  
  // Sort by score (descending), then by original sortOrder
  scoredVoices.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return (a.voice.sortOrder || 0) - (b.voice.sortOrder || 0);
  });
  
  // Return sorted voices
  return scoredVoices.map(sv => sv.voice);
}

/**
 * Get the best voice match for a mood from a list of voices
 * Useful for auto-selecting a voice based on mood
 */
export function getBestVoiceForMood(voices: Voice[], mood: PodcastMood, gender?: string): Voice | null {
  if (voices.length === 0) return null;
  
  // Filter by gender if specified
  let candidates = gender 
    ? voices.filter(v => v.gender?.toUpperCase() === gender.toUpperCase())
    : voices;
  
  // Sort by mood compatibility
  const sorted = filterVoicesByMood(candidates, mood);
  
  // Return the best match
  return sorted[0] || null;
}

/**
 * Get recommended voices for a specific mood and host count
 * Returns a diverse set of voices that match the mood
 */
export function getRecommendedVoicesForMood(
  voices: Voice[],
  mood: PodcastMood,
  hostCount: number = 1
): Voice[] {
  // Sort voices by mood compatibility
  const sorted = filterVoicesByMood(voices, mood);
  
  // For single host, return top match
  if (hostCount === 1) {
    return sorted.slice(0, 1);
  }
  
  // For multiple hosts, ensure gender diversity
  const recommendations: Voice[] = [];
  const usedGenders = new Set<string>();
  
  // First pass: Get best match for each gender
  for (const voice of sorted) {
    if (recommendations.length >= hostCount) break;
    
    const gender = voice.gender?.toUpperCase() || 'NEUTRAL';
    if (!usedGenders.has(gender)) {
      recommendations.push(voice);
      usedGenders.add(gender);
    }
  }
  
  // Second pass: Fill remaining slots with top-scored voices
  if (recommendations.length < hostCount) {
    for (const voice of sorted) {
      if (recommendations.length >= hostCount) break;
      if (!recommendations.includes(voice)) {
        recommendations.push(voice);
      }
    }
  }
  
  return recommendations;
}

/**
 * Get mood compatibility description for a voice
 * Returns a user-friendly description of how well the voice matches the mood
 */
export function getVoiceMoodCompatibility(voice: Voice, mood: PodcastMood): string {
  const score = getVoiceMoodScore(voice, mood);
  
  switch (score) {
    case 2:
      return 'Perfect match';
    case 1:
      return 'Good match';
    default:
      return 'Compatible';
  }
}
