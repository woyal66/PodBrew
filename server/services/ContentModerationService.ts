/**
 * ContentModerationService - Pre-flight topic filtering
 * 
 * Provides a lightweight blocklist-based filter that runs before AI API calls.
 * This is a first-line defense; Perplexity/Gemini APIs have their own safety filters.
 */

interface ModerationResult {
  allowed: boolean;
  reason?: string;
  category?: string;
}

// Categorized blocklists for prohibited content
const BLOCKLISTS = {
  // Illegal activities and violence
  illegalActivities: [
    'how to make a bomb',
    'how to make explosives',
    'how to make drugs',
    'how to cook meth',
    'how to synthesize',
    'drug manufacturing',
    'terrorism',
    'terrorist attack',
    'mass shooting',
    'school shooting',
    'how to poison',
    'how to kill',
    'murder someone',
    'assassinate',
    'human trafficking',
    'child trafficking',
  ],
  
  // Child safety
  childSafety: [
    'child pornography',
    'child exploitation',
    'minor exploitation',
    'csam',
    'pedophilia',
    'underage',
  ],
  
  // Weapons and harmful materials
  weapons: [
    'how to build a gun',
    'ghost gun',
    'unregistered firearm',
    '3d print gun',
    'how to make poison',
    'bioweapon',
    'chemical weapon',
  ],
  
  // Hacking and cybercrime
  cybercrime: [
    'how to hack',
    'hacking tutorial',
    'ransomware',
    'malware creation',
    'phishing tutorial',
    'steal passwords',
    'ddos attack',
    'credit card fraud',
    'identity theft how to',
  ],
  
  // Self-harm (flagged for review but more nuanced)
  selfHarm: [
    'how to commit suicide',
    'suicide methods',
    'painless death',
    'how to cut yourself',
    'self harm methods',
  ],
  
  // Financial crimes
  financialCrimes: [
    'money laundering',
    'tax evasion how to',
    'ponzi scheme',
    'pyramid scheme tutorial',
    'counterfeit money',
  ],
};

// Flatten all blocklists for quick lookup
const ALL_BLOCKED_PHRASES = Object.entries(BLOCKLISTS).flatMap(
  ([category, phrases]) => phrases.map(phrase => ({ phrase: phrase.toLowerCase(), category }))
);

/**
 * Check if a topic contains prohibited content
 * @param topic - The user's topic/prompt
 * @returns ModerationResult with allowed status and reason if blocked
 */
export function moderateTopic(topic: string): ModerationResult {
  if (!topic || typeof topic !== 'string') {
    return { allowed: true };
  }
  
  const normalizedTopic = topic.toLowerCase().trim();
  
  // Check against all blocked phrases
  for (const { phrase, category } of ALL_BLOCKED_PHRASES) {
    if (normalizedTopic.includes(phrase)) {
      console.log(`[ContentModeration] Blocked topic in category "${category}": "${topic.substring(0, 50)}..."`);
      return {
        allowed: false,
        reason: getBlockedReason(category),
        category,
      };
    }
  }
  
  return { allowed: true };
}

/**
 * Get user-friendly reason for blocked content
 */
function getBlockedReason(category: string): string {
  const reasons: Record<string, string> = {
    illegalActivities: 'This topic appears to involve illegal activities. Please choose a different subject.',
    childSafety: 'This topic involves content that violates child safety policies.',
    weapons: 'This topic involves dangerous weapons or harmful materials.',
    cybercrime: 'This topic appears to involve illegal cyber activities.',
    selfHarm: 'This topic involves sensitive content. If you need support, please reach out to a crisis helpline.',
    financialCrimes: 'This topic appears to involve financial crimes or fraud.',
  };
  
  return reasons[category] || 'This topic contains prohibited content. Please try a different subject.';
}

/**
 * Validate multiple content fields (topic, document text, etc.)
 */
export function moderateContent(fields: { topic?: string; documentText?: string; additionalContext?: string }): ModerationResult {
  // Check each field
  const fieldsToCheck = [
    fields.topic,
    fields.documentText?.substring(0, 5000), // Only check first 5000 chars of documents
    fields.additionalContext,
  ].filter(Boolean);
  
  for (const field of fieldsToCheck) {
    const result = moderateTopic(field as string);
    if (!result.allowed) {
      return result;
    }
  }
  
  return { allowed: true };
}

export const ContentModerationService = {
  moderateTopic,
  moderateContent,
};
