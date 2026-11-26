/**
 * SSML Prosody Templates for Emotional Expression (Phase 0.3 & Phase 2)
 * 
 * These templates define how different emotions and tones are expressed
 * through voice adjustments (pitch, rate, volume, emphasis) using Google TTS SSML.
 * 
 * Reference: https://cloud.google.com/text-to-speech/docs/ssml
 */

import { escapeSSML } from '../emotionProsody';

export interface ProsodyTemplate {
  name: string;
  displayName: string;
  description: string;
  pitchAdjustment: string; // e.g., "+2st", "-1st" (semitones)
  rateAdjustment: string; // e.g., "110%", "90%"
  volumeAdjustment: string; // e.g., "+2dB", "-1dB"
  emphasisLevel: 'none' | 'reduced' | 'moderate' | 'strong';
  emotionMarkers?: Record<string, {
    pitch: string;
    rate: string;
    volume?: string;
    emphasis?: string;
  }>;
}

/**
 * Tone Presets for Overall Podcast Style (Phase 2.5)
 */
export const TONE_PRESETS: Record<string, ProsodyTemplate> = {
  neutral: {
    name: 'neutral',
    displayName: 'Neutral',
    description: 'Balanced, professional delivery with natural rhythm',
    pitchAdjustment: '+0st',
    rateAdjustment: '100%',
    volumeAdjustment: '+0dB',
    emphasisLevel: 'moderate',
    emotionMarkers: {
      excited: { pitch: '+1st', rate: '105%', emphasis: 'moderate' },
      concerned: { pitch: '-1st', rate: '95%', emphasis: 'moderate' },
      curious: { pitch: '+0.5st', rate: '100%', emphasis: 'moderate' },
    },
  },

  warm: {
    name: 'warm',
    displayName: 'Warm & Friendly',
    description: 'Conversational, approachable tone with gentle pacing',
    pitchAdjustment: '+1st',
    rateAdjustment: '95%',
    volumeAdjustment: '+1dB',
    emphasisLevel: 'moderate',
    emotionMarkers: {
      excited: { pitch: '+2st', rate: '100%', emphasis: 'strong' },
      laughing: { pitch: '+2st', rate: '110%', emphasis: 'strong' },
      empathetic: { pitch: '+0.5st', rate: '90%', emphasis: 'moderate' },
      encouraging: { pitch: '+1.5st', rate: '100%', emphasis: 'strong' },
    },
  },

  excited: {
    name: 'excited',
    displayName: 'Excited & Energetic',
    description: 'High-energy delivery with dynamic range and enthusiasm',
    pitchAdjustment: '+2st',
    rateAdjustment: '110%',
    volumeAdjustment: '+2dB',
    emphasisLevel: 'strong',
    emotionMarkers: {
      thrilled: { pitch: '+3st', rate: '115%', emphasis: 'strong' },
      amazed: { pitch: '+2.5st', rate: '105%', emphasis: 'strong' },
      passionate: { pitch: '+2st', rate: '110%', volume: '+3dB', emphasis: 'strong' },
      surprised: { pitch: '+3st', rate: '120%', emphasis: 'strong' },
    },
  },

  investigative: {
    name: 'investigative',
    displayName: 'Investigative & Analytical',
    description: 'Thoughtful, measured pace with authoritative tone',
    pitchAdjustment: '-1st',
    rateAdjustment: '90%',
    volumeAdjustment: '+0dB',
    emphasisLevel: 'moderate',
    emotionMarkers: {
      skeptical: { pitch: '-1.5st', rate: '85%', emphasis: 'moderate' },
      intrigued: { pitch: '-0.5st', rate: '95%', emphasis: 'moderate' },
      analytical: { pitch: '-1st', rate: '88%', emphasis: 'reduced' },
      probing: { pitch: '-1st', rate: '92%', emphasis: 'moderate' },
    },
  },

  dramatic: {
    name: 'dramatic',
    displayName: 'Dramatic & Intense',
    description: 'Powerful delivery with strong emotional contrasts',
    pitchAdjustment: '+0st',
    rateAdjustment: '95%',
    volumeAdjustment: '+3dB',
    emphasisLevel: 'strong',
    emotionMarkers: {
      intense: { pitch: '+1st', rate: '100%', volume: '+4dB', emphasis: 'strong' },
      tense: { pitch: '-2st', rate: '90%', volume: '+2dB', emphasis: 'strong' },
      urgent: { pitch: '+2st', rate: '115%', volume: '+3dB', emphasis: 'strong' },
      ominous: { pitch: '-3st', rate: '85%', volume: '+1dB', emphasis: 'moderate' },
      triumphant: { pitch: '+2st', rate: '105%', volume: '+4dB', emphasis: 'strong' },
    },
  },
};

/**
 * Emotion Markers - Specific emotional states that can be tagged in scripts (Phase 2.1)
 * Format: [emotion] in script text triggers these SSML adjustments
 */
export const EMOTION_MARKERS: Record<string, {
  pitch: string;
  rate: string;
  volume?: string;
  emphasis?: string;
  description: string;
}> = {
  // Positive emotions
  excited: {
    pitch: '+2st',
    rate: '110%',
    emphasis: 'strong',
    description: 'High energy, enthusiastic delivery',
  },
  happy: {
    pitch: '+1.5st',
    rate: '105%',
    emphasis: 'moderate',
    description: 'Cheerful, upbeat tone',
  },
  laughing: {
    pitch: '+2st',
    rate: '115%',
    volume: '+2dB',
    emphasis: 'strong',
    description: 'Lighthearted, amused delivery',
  },
  proud: {
    pitch: '+1st',
    rate: '95%',
    volume: '+1dB',
    emphasis: 'moderate',
    description: 'Confident, satisfied tone',
  },

  // Negative/concerned emotions
  concerned: {
    pitch: '-1st',
    rate: '95%',
    emphasis: 'moderate',
    description: 'Worried, cautious delivery',
  },
  sad: {
    pitch: '-2st',
    rate: '85%',
    volume: '-1dB',
    emphasis: 'reduced',
    description: 'Melancholy, subdued tone',
  },
  frustrated: {
    pitch: '+0.5st',
    rate: '105%',
    emphasis: 'strong',
    description: 'Exasperated, tense delivery',
  },
  angry: {
    pitch: '+1st',
    rate: '110%',
    volume: '+3dB',
    emphasis: 'strong',
    description: 'Intense, forceful tone',
  },

  // Neutral/analytical emotions
  curious: {
    pitch: '+0.5st',
    rate: '100%',
    emphasis: 'moderate',
    description: 'Inquisitive, interested tone',
  },
  thoughtful: {
    pitch: '-0.5st',
    rate: '90%',
    emphasis: 'reduced',
    description: 'Reflective, contemplative delivery',
  },
  skeptical: {
    pitch: '-1st',
    rate: '95%',
    emphasis: 'moderate',
    description: 'Doubtful, questioning tone',
  },
  analytical: {
    pitch: '-1st',
    rate: '88%',
    emphasis: 'reduced',
    description: 'Methodical, measured delivery',
  },

  // Dramatic emotions
  shocked: {
    pitch: '+3st',
    rate: '120%',
    volume: '+2dB',
    emphasis: 'strong',
    description: 'Startled, surprised reaction',
  },
  whisper: {
    pitch: '-1st',
    rate: '85%',
    volume: '-4dB',
    emphasis: 'reduced',
    description: 'Quiet, intimate delivery',
  },
  urgent: {
    pitch: '+1st',
    rate: '115%',
    volume: '+2dB',
    emphasis: 'strong',
    description: 'Time-sensitive, pressing tone',
  },
  mysterious: {
    pitch: '-2st',
    rate: '85%',
    volume: '-1dB',
    emphasis: 'moderate',
    description: 'Enigmatic, suspenseful delivery',
  },

  // Conversational dynamics
  emphasize: {
    pitch: '+1st',
    rate: '95%',
    emphasis: 'strong',
    description: 'Stress important points',
  },
  casual: {
    pitch: '+0st',
    rate: '100%',
    emphasis: 'moderate',
    description: 'Relaxed, informal delivery',
  },
  professional: {
    pitch: '-0.5st',
    rate: '95%',
    emphasis: 'moderate',
    description: 'Polished, formal tone',
  },
};

/**
 * Generate SSML markup for a text segment with prosody adjustments
 */
export function generateSSML(
  text: string,
  prosody: {
    pitch?: string;
    rate?: string;
    volume?: string;
  } = {},
  options: {
    emphasis?: 'none' | 'reduced' | 'moderate' | 'strong';
    breakBefore?: string; // e.g., "300ms"
    breakAfter?: string;
  } = {}
): string {
  let ssml = '';

  // Add break before
  if (options.breakBefore) {
    ssml += `<break time="${options.breakBefore}"/>`;
  }

  // Build prosody tag
  const prosodyAttrs: string[] = [];
  if (prosody.pitch) prosodyAttrs.push(`pitch="${prosody.pitch}"`);
  if (prosody.rate) prosodyAttrs.push(`rate="${prosody.rate}"`);
  if (prosody.volume) prosodyAttrs.push(`volume="${prosody.volume}"`);

  // Wrap in emphasis if needed
  if (options.emphasis && options.emphasis !== 'none') {
    ssml += `<emphasis level="${options.emphasis}">`;
  }

  // Escape special characters for SSML
  const escapedText = escapeSSML(text);
  
  // Add prosody wrapper if we have adjustments
  if (prosodyAttrs.length > 0) {
    ssml += `<prosody ${prosodyAttrs.join(' ')}>${escapedText}</prosody>`;
  } else {
    ssml += escapedText;
  }

  // Close emphasis
  if (options.emphasis && options.emphasis !== 'none') {
    ssml += '</emphasis>';
  }

  // Add break after
  if (options.breakAfter) {
    ssml += `<break time="${options.breakAfter}"/>`;
  }

  return ssml;
}

/**
 * Apply emotion marker to text (used by Phase 2.1 emotion parser)
 * Example: applyEmotionMarker("That's incredible!", "excited")
 */
export function applyEmotionMarker(text: string, emotion: string): string {
  const marker = EMOTION_MARKERS[emotion];
  if (!marker) {
    console.warn(`Unknown emotion marker: ${emotion}`);
    return text;
  }

  return generateSSML(
    text,
    {
      pitch: marker.pitch,
      rate: marker.rate,
      volume: marker.volume,
    },
    {
      emphasis: marker.emphasis as 'none' | 'reduced' | 'moderate' | 'strong',
    }
  );
}

/**
 * Apply tone preset baseline adjustments to entire script
 */
export function applyTonePreset(text: string, tonePresetName: string): string {
  const preset = TONE_PRESETS[tonePresetName];
  if (!preset) {
    console.warn(`Unknown tone preset: ${tonePresetName}`);
    return text;
  }

  return generateSSML(
    text,
    {
      pitch: preset.pitchAdjustment,
      rate: preset.rateAdjustment,
      volume: preset.volumeAdjustment,
    },
    {
      emphasis: preset.emphasisLevel,
    }
  );
}

/**
 * Seed prosody presets into database (Phase 0.3)
 */
export function getProsodyPresetSeeds() {
  return Object.values(TONE_PRESETS).map((preset) => ({
    name: preset.name,
    displayName: preset.displayName,
    description: preset.description,
    pitchAdjustment: preset.pitchAdjustment,
    rateAdjustment: preset.rateAdjustment,
    volumeAdjustment: preset.volumeAdjustment,
    emphasisLevel: preset.emphasisLevel,
    emotionMarkers: preset.emotionMarkers || {},
    isActive: true,
  }));
}
