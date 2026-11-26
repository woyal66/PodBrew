/**
 * Centralized Voice Tier Validation
 * CRITICAL: Standard tier voices are DISABLED platform-wide (November 2025)
 * Only premium, ultra, and cinematic tier voices are allowed
 */

import type { Voice } from '@shared/schema';

/**
 * Allowed voice tiers (standard tier is DISABLED)
 */
const ALLOWED_TIERS = ['premium', 'ultra', 'cinematic'] as const;

/**
 * Check if a single voice tier is allowed
 */
export function isVoiceTierAllowed(tier: string): boolean {
  return ALLOWED_TIERS.includes(tier as any);
}

/**
 * Filter voices to only include allowed tiers (premium, ultra, cinematic)
 */
export function filterAllowedTierVoices(voices: Voice[]): Voice[] {
  return voices.filter(voice => isVoiceTierAllowed(voice.tier));
}

/**
 * Validate voice IDs against catalog - throws if any standard tier voices found
 * @param voiceIds - Array of voice IDs to validate
 * @param voices - Voice catalog to check against
 * @throws Error if any standard tier voices are found
 */
export function validateVoiceTiers(voiceIds: string[], voices: Voice[]): void {
  const voiceMap = new Map(voices.map(v => [v.id, v]));
  const standardVoices: string[] = [];

  for (const voiceId of voiceIds) {
    const voice = voiceMap.get(voiceId);
    if (voice && voice.tier === 'standard') {
      standardVoices.push(voice.displayName);
    }
  }

  if (standardVoices.length > 0) {
    const names = standardVoices.join(', ');
    throw new Error(
      `Standard tier voices are not supported. Please select premium, ultra, or cinematic voices only. Standard voices selected: ${names}`
    );
  }
}

/**
 * Get error message for standard tier voice rejection
 */
export function getStandardTierErrorMessage(voiceNames: string[]): string {
  const names = voiceNames.join(', ');
  return `Standard tier voices are not supported. Please select premium, ultra, or cinematic voices only. Standard voices selected: ${names}`;
}
