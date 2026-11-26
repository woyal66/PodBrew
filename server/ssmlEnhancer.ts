/**
 * SSML Enhancement Layer
 * Adds advanced TTS features: natural pauses, word emphasis, and voice styles
 * Works as a second pass on top of emotionProsody.ts
 */

import type { EmotionType } from './emotionProsody';

export type GoogleVoiceStyle = 'lively' | 'serious' | null;

export interface SSMLEnhancementOptions {
  addPauses?: boolean;
  addEmphasis?: boolean;
  voiceStyle?: GoogleVoiceStyle;
  maxLength?: number; // Character limit (default: 5000 for Google TTS)
}

/**
 * Maps podcast mood to Google Cloud voice style
 */
export function moodToVoiceStyle(podcastMood?: string): GoogleVoiceStyle {
  const moodStyleMap: Record<string, GoogleVoiceStyle> = {
    uplifting: 'lively',
    humorous: 'lively',
    energetic: 'lively',
    serious: 'serious',
    mysterious: 'serious',
    balanced: null,
  };
  
  return podcastMood ? (moodStyleMap[podcastMood.toLowerCase()] || null) : null;
}

/**
 * Enhances SSML with natural pauses, emphasis, and voice styles
 * @param ssml - Base SSML from emotionProsody.textToSSML()
 * @param options - Enhancement options
 * @returns Enhanced SSML string
 */
export function enhanceSSML(ssml: string, options: SSMLEnhancementOptions = {}): string {
  const {
    addPauses = true,
    addEmphasis = true,
    voiceStyle = null,
    maxLength = 5000
  } = options;
  
  // Start with base SSML
  let enhanced = ssml;
  
  // Step 1: Add natural pauses if enabled
  if (addPauses) {
    enhanced = insertNaturalPauses(enhanced);
  }
  
  // Step 2: Add word-level emphasis if enabled
  if (addEmphasis) {
    enhanced = insertEmphasis(enhanced);
  }
  
  // Step 3: Wrap with voice style if specified
  if (voiceStyle) {
    enhanced = wrapWithVoiceStyle(enhanced, voiceStyle);
  }
  
  // Step 4: Trim if exceeding length limit
  if (enhanced.length > maxLength) {
    console.warn(`[SSML] Enhanced SSML too long (${enhanced.length} chars), trimming to ${maxLength}`);
    enhanced = trimSSML(enhanced, maxLength, { keepPauses: true, keepEmphasis: false });
  }
  
  return enhanced;
}

/**
 * Inserts natural pauses at sentence boundaries, after questions, and for explicit markers
 * Patterns:
 * - [PAUSE] marker → <break time="500ms"/>
 * - [BREATH] marker → <break time="300ms"/>
 * - Question marks → <break time="400ms"/>
 * - Sentence endings → <break time="300ms"/>
 * - Ellipsis (...) → <break strength="medium"/>
 * - Em-dash (—) → <break time="200ms"/>
 */
function insertNaturalPauses(ssml: string): string {
  // Extract content between <speak> tags
  const speakMatch = ssml.match(/<speak>([\s\S]*)<\/speak>/);
  if (!speakMatch) return ssml;
  
  let content = speakMatch[1];
  
  // Replace explicit pause markers
  content = content.replace(/\[PAUSE\]/gi, '<break time="500ms"/>');
  content = content.replace(/\[BREATH\]/gi, '<break time="300ms"/>');
  
  // Add pauses after questions (but not inside existing tags)
  content = content.replace(/\?(?![^<]*>)/g, '?<break time="400ms"/>');
  
  // Add pauses after sentence endings (. ! but not ...)
  content = content.replace(/([.!])(?!\.\.)(?![^<]*>)(\s)/g, '$1<break time="300ms"/>$2');
  
  // Em-dash pauses (dramatic interjections)
  content = content.replace(/—(?![^<]*>)/g, '—<break time="200ms"/>');
  
  // Ellipsis pauses (thinking, trailing off)
  content = content.replace(/\.{3}(?![^<]*>)/g, '...<break strength="medium"/>');
  
  return `<speak>${content}</speak>`;
}

/**
 * Adds emphasis to key words and phrases
 * Patterns:
 * - *text* → <emphasis level="moderate">text</emphasis>
 * - **text** → <emphasis level="strong">text</emphasis>
 * - Numbers/statistics → <emphasis level="moderate">
 * - ALL CAPS words → <emphasis level="strong">
 */
function insertEmphasis(ssml: string): string {
  const speakMatch = ssml.match(/<speak>([\s\S]*)<\/speak>/);
  if (!speakMatch) return ssml;
  
  let content = speakMatch[1];
  
  // Strong emphasis: **text**
  content = content.replace(/\*\*([^*]+)\*\*/g, '<emphasis level="strong">$1</emphasis>');
  
  // Moderate emphasis: *text*
  content = content.replace(/\*([^*]+)\*/g, '<emphasis level="moderate">$1</emphasis>');
  
  // ALL CAPS emphasis (but not acronyms like NASA)
  content = content.replace(/\b([A-Z]{4,})\b(?![^<]*>)/g, '<emphasis level="strong">$1</emphasis>');
  
  // Emphasize large numbers with commas (e.g., "1,234,567")
  content = content.replace(/\b(\d{1,3}(,\d{3})+)\b(?![^<]*>)/g, '<emphasis level="moderate">$1</emphasis>');
  
  // Emphasize percentages
  content = content.replace(/\b(\d+%)\b(?![^<]*>)/g, '<emphasis level="moderate">$1</emphasis>');
  
  return `<speak>${content}</speak>`;
}

/**
 * Wraps SSML content with Google Cloud voice style
 * Format: <speak xmlns:google="..."><google:style name="STYLE">content</google:style></speak>
 * Requires xmlns:google namespace declaration for Google TTS to accept google:style tags
 * Preserves any existing attributes on the <speak> tag (e.g., xml:lang)
 */
function wrapWithVoiceStyle(ssml: string, style: GoogleVoiceStyle): string {
  if (!style) return ssml;
  
  // Extract opening <speak> tag with any attributes and the content
  const speakMatch = ssml.match(/<speak([^>]*)>([\s\S]*)<\/speak>/);
  if (!speakMatch) return ssml;
  
  const existingAttributes = speakMatch[1].trim();
  const content = speakMatch[2];
  
  // Add xmlns:google namespace if not already present, preserving any existing attributes
  const namespaceAttr = 'xmlns:google="http://www.w3.org/2001/10/synthesis"';
  const needsNamespace = !existingAttributes.includes('xmlns:google');
  const allAttributes = existingAttributes 
    ? (needsNamespace ? `${existingAttributes} ${namespaceAttr}` : existingAttributes)
    : namespaceAttr;
  
  // Wrap with google:style tag and include all attributes on <speak>
  return `<speak ${allAttributes}><google:style name="${style}">${content}</google:style></speak>`;
}

/**
 * Trims SSML to fit within character limit by removing enhancement layers in order
 * Priority (keep first): prosody > pauses > emphasis > voice style
 * Ensures all tags remain balanced and properly closed
 */
function trimSSML(
  ssml: string,
  maxLength: number,
  options: { keepPauses: boolean; keepEmphasis: boolean }
): string {
  if (ssml.length <= maxLength) return ssml;
  
  let trimmed = ssml;
  
  // Step 1: Remove emphasis tags first (lowest priority)
  if (!options.keepEmphasis || trimmed.length > maxLength) {
    trimmed = trimmed.replace(/<emphasis[^>]*>(.*?)<\/emphasis>/g, '$1');
  }
  
  // Step 2: Remove pauses if still too long
  if (!options.keepPauses || trimmed.length > maxLength) {
    // Remove all break tags
    trimmed = trimmed.replace(/<break[^>]*\/?>/g, '');
  }
  
  // Step 3: Remove voice style wrapper if still too long
  if (trimmed.length > maxLength) {
    // Unwrap google:style tags while preserving inner content
    trimmed = trimmed.replace(/<google:style[^>]*>([\s\S]*)<\/google:style>/g, '$1');
  }
  
  // Step 4: If STILL too long after removing all enhancements, we have a problem
  // This means the base prosody-tagged content itself is >5000 chars
  // Log warning and collect whole prosody blocks until we hit the limit
  if (trimmed.length > maxLength) {
    console.error(`[SSML] Base content exceeds ${maxLength} chars even after removing all enhancements. Collecting whole prosody blocks...`);
    
    // Extract content between <speak> tags
    const speakMatch = trimmed.match(/<speak>([\s\S]*)<\/speak>/);
    if (speakMatch) {
      const content = speakMatch[1];
      
      // Find all complete <prosody>...</prosody> blocks
      const prosodyRegex = /<prosody[^>]*>[\s\S]*?<\/prosody>/g;
      const blocks: string[] = [];
      let match;
      
      while ((match = prosodyRegex.exec(content)) !== null) {
        blocks.push(match[0]);
      }
      
      // If no prosody blocks found, extract plain text segments
      if (blocks.length === 0) {
        // Fallback: just take plain text up to limit
        const availableLength = maxLength - '<speak></speak>'.length - 20;
        const plainText = content.substring(0, availableLength).replace(/<[^>]*$/g, '');
        trimmed = `<speak>${plainText}</speak>`;
      } else {
        // Add whole blocks until we hit the limit
        let result = '';
        const overhead = '<speak></speak>'.length + 50; // Safety margin
        
        for (const block of blocks) {
          const testLength = overhead + result.length + block.length;
          if (testLength <= maxLength) {
            result += block + ' ';
          } else {
            break; // Stop adding blocks
          }
        }
        
        // If no blocks fit, the first block itself exceeds the limit
        // Truncate its inner text and re-wrap with proper prosody tags
        if (result.trim().length === 0 && blocks.length > 0) {
          console.warn('[SSML] First prosody block exceeds limit. Truncating inner content...');
          const firstBlock = blocks[0];
          
          // Extract prosody attributes and inner content
          const prosodyMatch = firstBlock.match(/<prosody([^>]*)>([\s\S]*?)<\/prosody>/);
          if (prosodyMatch) {
            const attributes = prosodyMatch[1];
            const innerText = prosodyMatch[2];
            
            // Calculate available space for inner text
            const tagOverhead = `<speak><prosody${attributes}></prosody></speak>`.length + 50;
            const availableLength = maxLength - tagOverhead;
            
            // Truncate inner text
            const truncatedText = innerText.substring(0, Math.max(0, availableLength));
            
            result = `<prosody${attributes}>${truncatedText}</prosody>`;
          } else {
            // Fallback if regex fails: just truncate raw block
            const availableLength = maxLength - '<speak></speak>'.length - 20;
            result = firstBlock.substring(0, availableLength) + '</prosody>';
          }
        }
        
        trimmed = `<speak>${result.trim()}</speak>`;
      }
    }
  }
  
  return trimmed;
}

/**
 * Estimates SSML expansion ratio (plain text → SSML length increase)
 * Useful for pre-checking if content will exceed limits
 */
export function estimateSSMLExpansion(
  plainTextLength: number,
  options: SSMLEnhancementOptions = {}
): number {
  const baseExpansion = 1.1; // Base prosody tags add ~10%
  let expansionFactor = baseExpansion;
  
  if (options.addPauses) {
    expansionFactor += 0.08; // Pauses add ~8%
  }
  
  if (options.addEmphasis) {
    expansionFactor += 0.05; // Emphasis adds ~5%
  }
  
  if (options.voiceStyle) {
    expansionFactor += 0.03; // Voice style wrapper adds ~3%
  }
  
  return Math.ceil(plainTextLength * expansionFactor);
}

/**
 * Checks if text will fit within SSML limits after enhancement
 */
export function willFitInSSMLLimit(
  plainTextLength: number,
  options: SSMLEnhancementOptions = {},
  limit: number = 5000
): boolean {
  const estimatedLength = estimateSSMLExpansion(plainTextLength, options);
  return estimatedLength <= limit;
}
