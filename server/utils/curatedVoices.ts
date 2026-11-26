/**
 * Curated Voice Catalog - 30 Premium Gemini Voices (Phase 1.2)
 * 
 * All voices are Gemini 2.5 Flash TTS premium voices with:
 * - Professional quality audio (24kHz)
 * - Natural emotion control
 * - Multi-language support
 * - Advanced vocal realism features
 */

export interface CuratedVoice {
  googleVoiceName: string;
  displayName: string;
  aliasName: string;
  description: string;
  accent: string;
  gender: string;
  modelType: string;
  tier: 'standard' | 'premium' | 'ultra' | 'cinematic';
  category: 'core' | 'regional' | 'specialty' | 'news';
  toneArchetype?: string;
  sortOrder: number;
  calibratedWps?: number; // Words-per-second from calibration test (Dec 2025)
}

/**
 * Core Collection (30 Gemini Voices) - All premium tier, Gemini 2.5 Flash TTS
 * Gemini voices are named after stars and celestial bodies
 */
export const CORE_VOICES: CuratedVoice[] = [
  // Male Voices (13 voices)
  {
    googleVoiceName: 'kore',
    displayName: 'Kore',
    aliasName: 'Emma',
    description: 'Firm and confident, professional female voice with presence',
    accent: 'American',
    gender: 'FEMALE',
    modelType: 'Gemini',
    tier: 'premium',
    category: 'core',
    toneArchetype: 'professional',
    sortOrder: 1,
    calibratedWps: 2.79,  // Calibrated Dec 8, 2025: rescaled 3.4x + 1.1x, then +15% Dec 9
  },
  {
    googleVoiceName: 'charon',
    displayName: 'Charon',
    aliasName: 'Victor',
    description: 'Deep authoritative voice, informative and clear',
    accent: 'British',
    gender: 'MALE',
    modelType: 'Gemini',
    tier: 'premium',
    category: 'core',
    toneArchetype: 'authoritative',
    sortOrder: 2,
    calibratedWps: 2.78,  // Calibrated Dec 8, 2025: rescaled 3.4x + 1.1x, then +15% Dec 9
  },
  {
    googleVoiceName: 'fenrir',
    displayName: 'Fenrir',
    aliasName: 'Felix',
    description: 'Warm and approachable, excitable and dynamic',
    accent: 'American',
    gender: 'MALE',
    modelType: 'Gemini',
    tier: 'premium',
    category: 'core',
    toneArchetype: 'warm',
    sortOrder: 3,
    calibratedWps: 2.67,  // Calibrated Dec 8, 2025: rescaled 3.4x + 1.1x, then +15% Dec 9
  },
  {
    googleVoiceName: 'algenib',
    displayName: 'Algenib',
    aliasName: 'Drake',
    description: 'Gravelly texture voice with character',
    accent: 'Southern American',
    gender: 'MALE',
    modelType: 'Gemini',
    tier: 'premium',
    category: 'core',
    toneArchetype: 'authoritative',
    sortOrder: 4,
    calibratedWps: 2.48,  // Calibrated Dec 8, 2025: rescaled 3.4x + 1.1x, then +15% Dec 9
  },
  {
    googleVoiceName: 'alnilam',
    displayName: 'Alnilam',
    aliasName: 'Ryan',
    description: 'Firm and strong, commanding presence',
    accent: 'American',
    gender: 'MALE',
    modelType: 'Gemini',
    tier: 'premium',
    category: 'core',
    toneArchetype: 'professional',
    sortOrder: 5,
    calibratedWps: 2.83,  // Calibrated Dec 8, 2025: rescaled 3.4x + 1.1x, then +15% Dec 9
  },
  {
    googleVoiceName: 'enceladus',
    displayName: 'Enceladus',
    aliasName: 'Owen',
    description: 'Breathy and soft, intimate delivery',
    accent: 'British',
    gender: 'MALE',
    modelType: 'Gemini',
    tier: 'premium',
    category: 'core',
    toneArchetype: 'calm',
    sortOrder: 6,
    calibratedWps: 2.75,  // Calibrated Dec 8, 2025: rescaled 3.4x + 1.1x, then +15% Dec 9
  },
  {
    googleVoiceName: 'gacrux',
    displayName: 'Gacrux',
    aliasName: 'Grace',
    description: 'Mature and experienced, authoritative female voice with warmth',
    accent: 'British',
    gender: 'FEMALE',
    modelType: 'Gemini',
    tier: 'premium',
    category: 'core',
    toneArchetype: 'authoritative',
    sortOrder: 7,
    calibratedWps: 2.31,  // Calibrated Dec 8, 2025: rescaled 3.4x + 1.1x, then +15% Dec 9
  },
  {
    googleVoiceName: 'iapetus',
    displayName: 'Iapetus',
    aliasName: 'Ethan',
    description: 'Clear and articulate, precise delivery',
    accent: 'American',
    gender: 'MALE',
    modelType: 'Gemini',
    tier: 'premium',
    category: 'core',
    toneArchetype: 'professional',
    sortOrder: 8,
    calibratedWps: 2.54,  // Calibrated Dec 8, 2025: rescaled 3.4x + 1.1x, then +15% Dec 9
  },
  {
    googleVoiceName: 'orus',
    displayName: 'Orus',
    aliasName: 'Mason',
    description: 'Firm and decisive, clear determination',
    accent: 'American',
    gender: 'MALE',
    modelType: 'Gemini',
    tier: 'premium',
    category: 'core',
    toneArchetype: 'professional',
    sortOrder: 9,
    calibratedWps: 2.93,  // Calibrated Dec 8, 2025: rescaled 3.4x + 1.1x, then +15% Dec 9
  },
  {
    googleVoiceName: 'rasalgethi',
    displayName: 'Rasalgethi',
    aliasName: 'Samuel',
    description: 'Informative and professional, knowledgeable',
    accent: 'British',
    gender: 'MALE',
    modelType: 'Gemini',
    tier: 'premium',
    category: 'core',
    toneArchetype: 'professional',
    sortOrder: 10,
    calibratedWps: 2.74,  // Calibrated Dec 8, 2025: rescaled 3.4x + 1.1x, then +15% Dec 9
  },
  {
    googleVoiceName: 'sadaltager',
    displayName: 'Sadaltager',
    aliasName: 'Derek',
    description: 'Knowledgeable and authoritative, expert tone',
    accent: 'American',
    gender: 'MALE',
    modelType: 'Gemini',
    tier: 'premium',
    category: 'core',
    toneArchetype: 'authoritative',
    sortOrder: 11,
    calibratedWps: 2.52,  // Calibrated Dec 8, 2025: rescaled 3.4x + 1.1x, then +15% Dec 9
  },
  {
    googleVoiceName: 'umbriel',
    displayName: 'Umbriel',
    aliasName: 'Henry',
    description: 'Calm and measured, composed delivery',
    accent: 'British',
    gender: 'MALE',
    modelType: 'Gemini',
    tier: 'premium',
    category: 'core',
    toneArchetype: 'calm',
    sortOrder: 12,
    calibratedWps: 2.66,  // Calibrated Dec 8, 2025: rescaled 3.4x + 1.1x, then +15% Dec 9
  },
  {
    googleVoiceName: 'zubenelgenubi',
    displayName: 'Zubenelgenubi',
    aliasName: 'Robert',
    description: 'Steady and reliable, consistent quality',
    accent: 'American',
    gender: 'MALE',
    modelType: 'Gemini',
    tier: 'premium',
    category: 'core',
    toneArchetype: 'professional',
    sortOrder: 13,
    calibratedWps: 2.92,  // Calibrated Dec 8, 2025: rescaled 3.4x + 1.1x, then +15% Dec 9
  },

  // Additional Male/Female Voices
  {
    googleVoiceName: 'puck',
    displayName: 'Puck',
    aliasName: 'Marcus',
    description: 'Upbeat and energetic, conversational and friendly',
    accent: 'American',
    gender: 'MALE',
    modelType: 'Gemini',
    tier: 'premium',
    category: 'core',
    toneArchetype: 'energetic',
    sortOrder: 14,
    calibratedWps: 2.70,  // Calibrated Dec 8, 2025: rescaled 3.4x + 1.1x, then +15% Dec 9
  },
  {
    googleVoiceName: 'aoede',
    displayName: 'Aoede',
    aliasName: 'Sophie',
    description: 'Melodic and expressive, musical delivery',
    accent: 'British',
    gender: 'FEMALE',
    modelType: 'Gemini',
    tier: 'premium',
    category: 'core',
    toneArchetype: 'warm',
    sortOrder: 15,
    calibratedWps: 2.86,  // Calibrated Dec 8, 2025: rescaled 3.4x + 1.1x, then +15% Dec 9
  },
  {
    googleVoiceName: 'achernar',
    displayName: 'Achernar',
    aliasName: 'Lily',
    description: 'Soft and gentle voice with warmth',
    accent: 'British',
    gender: 'FEMALE',
    modelType: 'Gemini',
    tier: 'premium',
    category: 'core',
    toneArchetype: 'warm',
    sortOrder: 16,
    calibratedWps: 2.92,  // Calibrated Dec 8, 2025: rescaled 3.4x + 1.1x, then +15% Dec 9
  },
  {
    googleVoiceName: 'algieba',
    displayName: 'Algieba',
    aliasName: 'Victor',
    description: 'Smooth and pleasant, flowing delivery',
    accent: 'American',
    gender: 'MALE',
    modelType: 'Gemini',
    tier: 'premium',
    category: 'core',
    toneArchetype: 'professional',
    sortOrder: 17,
    calibratedWps: 2.47,  // Calibrated Dec 8, 2025: rescaled 3.4x + 1.1x, then +15% Dec 9
  },
  {
    googleVoiceName: 'autonoe',
    displayName: 'Autonoe',
    aliasName: 'Mia',
    description: 'Bright and optimistic, positive energy',
    accent: 'Australian',
    gender: 'FEMALE',
    modelType: 'Gemini',
    tier: 'premium',
    category: 'core',
    toneArchetype: 'energetic',
    sortOrder: 18,
    calibratedWps: 3.20,  // Calibrated Dec 8, 2025: rescaled 3.4x + 1.1x, then +15% Dec 9
  },
  {
    googleVoiceName: 'callirrhoe',
    displayName: 'Callirrhoe',
    aliasName: 'Maya',
    description: 'Easy-going and relaxed, comfortable tone',
    accent: 'Australian',
    gender: 'FEMALE',
    modelType: 'Gemini',
    tier: 'premium',
    category: 'core',
    toneArchetype: 'calm',
    sortOrder: 19,
    calibratedWps: 2.96,  // Calibrated Dec 8, 2025: rescaled 3.4x + 1.1x, then +15% Dec 9
  },
  {
    googleVoiceName: 'despina',
    displayName: 'Despina',
    aliasName: 'Alexandra',
    description: 'Smooth and flowing, elegant delivery',
    accent: 'British',
    gender: 'FEMALE',
    modelType: 'Gemini',
    tier: 'premium',
    category: 'core',
    toneArchetype: 'professional',
    sortOrder: 20,
    calibratedWps: 2.77,  // Calibrated Dec 8, 2025: rescaled 3.4x + 1.1x, then +15% Dec 9
  },
  {
    googleVoiceName: 'erinome',
    displayName: 'Erinome',
    aliasName: 'Iris',
    description: 'Clear and precise, sharp articulation',
    accent: 'American',
    gender: 'FEMALE',
    modelType: 'Gemini',
    tier: 'premium',
    category: 'core',
    toneArchetype: 'professional',
    sortOrder: 21,
    calibratedWps: 2.74,  // Calibrated Dec 8, 2025: rescaled 3.4x + 1.1x, then +15% Dec 9
  },
  {
    googleVoiceName: 'laomedeia',
    displayName: 'Laomedeia',
    aliasName: 'Sofia',
    description: 'Upbeat and lively, energetic presence',
    accent: 'American',
    gender: 'FEMALE',
    modelType: 'Gemini',
    tier: 'premium',
    category: 'core',
    toneArchetype: 'energetic',
    sortOrder: 22,
    calibratedWps: 3.01,  // Calibrated Dec 8, 2025: rescaled 3.4x + 1.1x, then +15% Dec 9
  },
  {
    googleVoiceName: 'leda',
    displayName: 'Leda',
    aliasName: 'Natasha',
    description: 'Youthful and energetic, dynamic delivery',
    accent: 'American',
    gender: 'FEMALE',
    modelType: 'Gemini',
    tier: 'premium',
    category: 'core',
    toneArchetype: 'energetic',
    sortOrder: 23,
    calibratedWps: 2.50,  // Calibrated Dec 8, 2025: rescaled 3.4x + 1.1x, then +15% Dec 9
  },
  {
    googleVoiceName: 'pulcherrima',
    displayName: 'Pulcherrima',
    aliasName: 'Thomas',
    description: 'Forward and expressive, confident delivery',
    accent: 'British',
    gender: 'MALE',
    modelType: 'Gemini',
    tier: 'premium',
    category: 'core',
    toneArchetype: 'professional',
    sortOrder: 24,
    calibratedWps: 2.60,  // Calibrated Dec 8, 2025: rescaled 3.4x + 1.1x, then +15% Dec 9
  },
  {
    googleVoiceName: 'sadachbia',
    displayName: 'Sadachbia',
    aliasName: 'Morpheus',
    description: 'Deep and wise, guiding philosophical voice',
    accent: 'American',
    gender: 'MALE',
    modelType: 'Gemini',
    tier: 'premium',
    category: 'core',
    toneArchetype: 'authoritative',
    sortOrder: 25,
    calibratedWps: 2.58,  // Calibrated Dec 8, 2025: rescaled 3.4x + 1.1x, then +15% Dec 9
  },
  {
    googleVoiceName: 'schedar',
    displayName: 'Schedar',
    aliasName: 'Benjamin',
    description: 'Professional and composed, confident tone',
    accent: 'British',
    gender: 'MALE',
    modelType: 'Gemini',
    tier: 'premium',
    category: 'core',
    toneArchetype: 'professional',
    sortOrder: 26,
    calibratedWps: 2.76,  // Calibrated Dec 8, 2025: rescaled 3.4x + 1.1x, then +15% Dec 9
  },
  {
    googleVoiceName: 'sulafat',
    displayName: 'Sulafat',
    aliasName: 'Sarah',
    description: 'Warm and welcoming, friendly presence',
    accent: 'American',
    gender: 'FEMALE',
    modelType: 'Gemini',
    tier: 'premium',
    category: 'core',
    toneArchetype: 'warm',
    sortOrder: 27,
    calibratedWps: 2.69,  // Calibrated Dec 8, 2025: rescaled 3.4x + 1.1x, then +15% Dec 9
  },
  {
    googleVoiceName: 'vindemiatrix',
    displayName: 'Vindemiatrix',
    aliasName: 'Violet',
    description: 'Gentle and kind, compassionate delivery',
    accent: 'British',
    gender: 'FEMALE',
    modelType: 'Gemini',
    tier: 'premium',
    category: 'core',
    toneArchetype: 'warm',
    sortOrder: 28,
    calibratedWps: 3.17,  // Calibrated Dec 8, 2025: rescaled 3.4x + 1.1x, then +15% Dec 9
  },
  {
    googleVoiceName: 'zephyr',
    displayName: 'Zephyr',
    aliasName: 'Zoe',
    description: 'Bright and cheerful, optimistic tone',
    accent: 'Australian',
    gender: 'FEMALE',
    modelType: 'Gemini',
    tier: 'premium',
    category: 'core',
    toneArchetype: 'energetic',
    sortOrder: 29,
    calibratedWps: 2.98,  // Calibrated Dec 8, 2025: rescaled 3.4x + 1.1x, then +15% Dec 9
  },

  // Neutral Voice (1 voice)
  {
    googleVoiceName: 'achird',
    displayName: 'Achird',
    aliasName: 'Jordan',
    description: 'Friendly and approachable, conversational',
    accent: 'American',
    gender: 'NEUTRAL',
    modelType: 'Gemini',
    tier: 'premium',
    category: 'core',
    toneArchetype: 'warm',
    sortOrder: 30,
    calibratedWps: 2.62,  // Calibrated Dec 8, 2025: rescaled 3.4x + 1.1x, then +15% Dec 9
  },
];

// Regional, Specialty, and News voices are empty - all 30 voices are in Core
export const REGIONAL_VOICES: CuratedVoice[] = [];
export const SPECIALTY_VOICES: CuratedVoice[] = [];
export const NEWS_VOICES: CuratedVoice[] = [];

// Export all voices for seeding
export const ALL_CURATED_VOICES = [
  ...CORE_VOICES,
  ...REGIONAL_VOICES,
  ...SPECIALTY_VOICES,
  ...NEWS_VOICES,
];

// Helper function used by admin routes
export function getAllCuratedVoices(): CuratedVoice[] {
  return ALL_CURATED_VOICES;
}
