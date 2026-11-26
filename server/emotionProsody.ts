import { enhanceSSML, moodToVoiceStyle, type GoogleVoiceStyle, type SSMLEnhancementOptions } from './ssmlEnhancer';

export type EmotionType =
  // Core emotions
  | 'neutral'
  | 'excited'
  | 'calm'
  | 'tense'
  | 'warm'
  | 'dramatic'
  | 'investigative'
  | 'cheerful'
  | 'serious'
  | 'empathetic'
  | 'questioning'
  | 'conclusive'
  | 'contemplative'
  | 'playful'
  // Extended emotions
  | 'confident'
  | 'surprised'
  | 'fearful'
  | 'angry'
  | 'sarcastic'
  | 'mocking'
  | 'witty'
  // Vocal effects
  | 'whisper'
  | 'laugh'
  | 'giggle'
  | 'chuckle'
  | 'sigh'
  | 'gasp'
  | 'breath';

export interface ProsodySettings {
  rate?: string;
  pitch?: string;
  volume?: string;
}

export interface SSMLOptions {
  podcastMood?: string;
  enableAdvancedFeatures?: boolean;
  supportsGoogleStyle?: boolean; // Whether the target voice supports <google:style> tags
  supportsProsody?: boolean; // Whether the target voice supports <prosody> tags
}

export interface EmotionMarker {
  emotion: EmotionType;
  text: string;
  startIndex: number;
  endIndex: number;
}

export interface ParsedSegment {
  text: string;
  emotion: EmotionType;
  hasEmotionMarker: boolean;
}

const EMOTION_PROSODY_MAP: Record<EmotionType, ProsodySettings> = {
  // Core emotions
  neutral: {
    rate: '100%',
    pitch: '+0%',
    volume: 'medium',
  },
  excited: {
    rate: '110%',
    pitch: '+5%',
    volume: '+3dB',
  },
  calm: {
    rate: '90%',
    pitch: '-3%',
    volume: 'soft',
  },
  tense: {
    rate: '105%',
    pitch: '+3%',
    volume: 'medium',
  },
  warm: {
    rate: '95%',
    pitch: '-2%',
    volume: 'medium',
  },
  dramatic: {
    rate: '85%',
    pitch: '+4%',
    volume: '+2dB',
  },
  investigative: {
    rate: '95%',
    pitch: '+2%',
    volume: 'medium',
  },
  cheerful: {
    rate: '105%',
    pitch: '+4%',
    volume: '+2dB',
  },
  serious: {
    rate: '90%',
    pitch: '-2%',
    volume: 'medium',
  },
  empathetic: {
    rate: '95%',
    pitch: '-1%',
    volume: 'soft',
  },
  questioning: {
    rate: '100%',
    pitch: '+3%',
    volume: 'medium',
  },
  conclusive: {
    rate: '95%',
    pitch: '-1%',
    volume: 'medium',
  },
  contemplative: {
    rate: '90%',
    pitch: '-2%',
    volume: 'soft',
  },
  playful: {
    rate: '105%',
    pitch: '+3%',
    volume: '+1dB',
  },
  // Extended emotions
  confident: {
    rate: '100%',
    pitch: '+2%',
    volume: '+2dB',
  },
  surprised: {
    rate: '115%',
    pitch: '+6%',
    volume: '+3dB',
  },
  fearful: {
    rate: '110%',
    pitch: '+4%',
    volume: 'soft',
  },
  angry: {
    rate: '105%',
    pitch: '+3%',
    volume: '+4dB',
  },
  sarcastic: {
    rate: '95%',
    pitch: '+1%',
    volume: 'medium',
  },
  mocking: {
    rate: '100%',
    pitch: '+2%',
    volume: 'medium',
  },
  witty: {
    rate: '105%',
    pitch: '+2%',
    volume: 'medium',
  },
  // Vocal effects - use neutral prosody, effects handled by TTS engine
  whisper: {
    rate: '90%',
    pitch: '-2%',
    volume: 'x-soft',
  },
  laugh: {
    rate: '100%',
    pitch: '+0%',
    volume: 'medium',
  },
  giggle: {
    rate: '105%',
    pitch: '+3%',
    volume: 'soft',
  },
  chuckle: {
    rate: '95%',
    pitch: '+1%',
    volume: 'soft',
  },
  sigh: {
    rate: '85%',
    pitch: '-3%',
    volume: 'soft',
  },
  gasp: {
    rate: '120%',
    pitch: '+5%',
    volume: '+2dB',
  },
  breath: {
    rate: '90%',
    pitch: '+0%',
    volume: 'x-soft',
  },
};

export function parseEmotionMarkers(text: string): ParsedSegment[] {
  const emotionRegex = /\[(excited|calm|tense|warm|dramatic|investigative|cheerful|serious|empathetic|questioning|conclusive|neutral|contemplative|playful|confident|surprised|fearful|angry|sarcastic|mocking|witty|whisper|laugh|giggle|chuckle|sigh|gasp|breath)\]/gi;
  
  const segments: ParsedSegment[] = [];
  let lastIndex = 0;
  let currentEmotion: EmotionType = 'neutral';
  
  let match: RegExpExecArray | null;
  
  while ((match = emotionRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const segmentText = text.substring(lastIndex, match.index).trim();
      if (segmentText) {
        segments.push({
          text: segmentText,
          emotion: currentEmotion,
          hasEmotionMarker: false,
        });
      }
    }
    
    currentEmotion = match[1].toLowerCase() as EmotionType;
    lastIndex = match.index + match[0].length;
  }
  
  if (lastIndex < text.length) {
    const segmentText = text.substring(lastIndex).trim();
    if (segmentText) {
      segments.push({
        text: segmentText,
        emotion: currentEmotion,
        hasEmotionMarker: false,
      });
    }
  }
  
  if (segments.length === 0 && text.trim()) {
    segments.push({
      text: text.trim(),
      emotion: 'neutral',
      hasEmotionMarker: false,
    });
  }
  
  return segments;
}

export function textToSSML(
  text: string,
  defaultEmotion: EmotionType = 'neutral',
  options: SSMLOptions = {}
): string {
  const segments = parseEmotionMarkers(text);
  
  if (segments.length === 0) {
    return escapeSSML(text);
  }
  
  // Check if voice supports prosody tags (default: true for backward compatibility)
  const supportsProsody = options.supportsProsody !== false;
  
  const ssmlParts = segments.map(segment => {
    const prosody = EMOTION_PROSODY_MAP[segment.emotion] || EMOTION_PROSODY_MAP.neutral;
    const escapedText = escapeSSML(segment.text);
    
    // Skip prosody tags if voice doesn't support them
    if (!supportsProsody || (segment.emotion === 'neutral' && defaultEmotion === 'neutral')) {
      return escapedText;
    }
    
    const attrs: string[] = [];
    if (prosody.rate) attrs.push(`rate="${prosody.rate}"`);
    if (prosody.pitch) attrs.push(`pitch="${prosody.pitch}"`);
    if (prosody.volume) attrs.push(`volume="${prosody.volume}"`);
    
    return `<prosody ${attrs.join(' ')}>${escapedText}</prosody>`;
  });
  
  const baseSSML = `<speak>${ssmlParts.join(' ')}</speak>`;
  
  // Apply advanced SSML enhancements if enabled
  if (options.enableAdvancedFeatures) {
    // Only apply voiceStyle if the voice supports Google Styles
    const voiceStyle = (options.supportsGoogleStyle !== false) 
      ? moodToVoiceStyle(options.podcastMood)
      : undefined;
    
    const enhancementOptions: SSMLEnhancementOptions = {
      addPauses: true,
      addEmphasis: true,
      voiceStyle,
      maxLength: 5000
    };
    
    return enhanceSSML(baseSSML, enhancementOptions);
  }
  
  return baseSSML;
}

export function escapeSSML(text: string): string {
  // First, decode any existing HTML entities (GPT-4o sometimes outputs pre-escaped text)
  // This prevents double-escaping: &amp; → & → &amp; (correct single escape)
  const decoded = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // Normalize smart quotes to straight quotes
    .replace(/[\u201C\u201D]/g, '"')  // Smart double quotes (U+201C ", U+201D ") → straight double quotes
    .replace(/[\u2018\u2019]/g, "'");  // Smart single quotes (U+2018 ', U+2019 ') → straight single quotes
  
  // Then escape for SSML (now we're guaranteed to have unescaped text)
  return decoded
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function removeEmotionMarkers(text: string): string {
  return text.replace(/\[(excited|calm|tense|warm|dramatic|investigative|cheerful|serious|empathetic|questioning|conclusive|neutral|contemplative|playful|confident|surprised|fearful|angry|sarcastic|mocking|witty|whisper|laugh|giggle|chuckle|sigh|gasp|breath)\]/gi, '').trim();
}

export function getProsodyForEmotion(emotion: EmotionType): ProsodySettings {
  return EMOTION_PROSODY_MAP[emotion] || EMOTION_PROSODY_MAP.neutral;
}

export function stripSSMLTags(ssml: string): string {
  return ssml
    .replace(/<speak>/gi, '')
    .replace(/<\/speak>/gi, '')
    .replace(/<prosody[^>]*>/gi, '')
    .replace(/<\/prosody>/gi, '')
    .replace(/<break[^>]*\/?>/gi, '') // Remove break tags
    .replace(/<emphasis[^>]*>/gi, '') // Remove emphasis tags
    .replace(/<\/emphasis>/gi, '')
    .replace(/<google:style[^>]*>/gi, '') // Remove Google style tags
    .replace(/<\/google:style>/gi, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}
