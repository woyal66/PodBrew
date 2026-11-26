const PENDING_PODCAST_KEY = 'podbrew_pending_podcast';
const EXPIRATION_MS = 60 * 60 * 1000; // 1 hour

export interface PendingPodcastConfig {
  topic: string;
  durationMinutes: number;
  languageComplexity: number;
  numPeople: number;
  podcastStyle: string;
  timeFrame: string;
  coHostPersonality: string;
  podcastMood: string;
  language: string;
  selectedVoicePool: string[];
  assignedVoices: string[];
  selectedVoiceIds: string[];
  templateCategory: string;
  savedAt: number;
}

export function savePendingPodcast(config: Omit<PendingPodcastConfig, 'savedAt'>): void {
  const configWithTimestamp: PendingPodcastConfig = {
    ...config,
    savedAt: Date.now(),
  };
  sessionStorage.setItem(PENDING_PODCAST_KEY, JSON.stringify(configWithTimestamp));
}

export function getPendingPodcast(): PendingPodcastConfig | null {
  const stored = sessionStorage.getItem(PENDING_PODCAST_KEY);
  if (!stored) return null;

  try {
    const config: PendingPodcastConfig = JSON.parse(stored);
    
    // Check if expired
    if (Date.now() - config.savedAt > EXPIRATION_MS) {
      clearPendingPodcast();
      return null;
    }
    
    return config;
  } catch (e) {
    console.error('Failed to parse pending podcast config:', e);
    clearPendingPodcast();
    return null;
  }
}

export function clearPendingPodcast(): void {
  sessionStorage.removeItem(PENDING_PODCAST_KEY);
}

export function hasPendingPodcast(): boolean {
  return getPendingPodcast() !== null;
}
