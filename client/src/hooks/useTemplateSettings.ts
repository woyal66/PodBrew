import { useEffect } from 'react';

export type TemplateSettingsKey = 'news' | 'events' | 'stories' | 'sports' | 'documents' | 'teach' | 'medical' | 'audiobooks';

export interface TemplateSettings {
  durationMinutes?: number;
  languageComplexity?: number;
  numPeople?: number;
  podcastStyle?: string;
  timeFrame?: string;
  coHostPersonality?: string;
  podcastMood?: string;
  language?: string;
  selectedVoiceIds?: string[];
  // Template-specific fields
  storyGenre?: string;
  eventFormat?: string;
  eventType?: string;
}

const STORAGE_KEY_PREFIX = 'podbrewSettings_';

export function useTemplateSettings(
  templateKey: TemplateSettingsKey,
  settings: TemplateSettings,
  setters: {
    setDurationMinutes?: (value: number) => void;
    setLanguageComplexity?: (value: number) => void;
    setNumPeople?: (value: number) => void;
    setPodcastStyle?: (value: string) => void;
    setTimeFrame?: (value: string) => void;
    setCoHostPersonality?: (value: string) => void;
    setPodcastMood?: (value: string) => void;
    setLanguage?: (value: string) => void;
    setSelectedVoiceIds?: (value: string[]) => void;
    setStoryGenre?: (value: string) => void;
    setEventFormat?: (value: string) => void;
    setEventType?: (value: string) => void;
  }
) {
  const storageKey = `${STORAGE_KEY_PREFIX}${templateKey}`;

  // Load settings on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsedSettings = JSON.parse(saved) as TemplateSettings;
        
        if (parsedSettings.durationMinutes !== undefined && setters.setDurationMinutes) {
          setters.setDurationMinutes(parsedSettings.durationMinutes);
        }
        if (parsedSettings.languageComplexity !== undefined && setters.setLanguageComplexity) {
          setters.setLanguageComplexity(parsedSettings.languageComplexity);
        }
        if (parsedSettings.numPeople !== undefined && setters.setNumPeople) {
          setters.setNumPeople(parsedSettings.numPeople);
        }
        if (parsedSettings.podcastStyle !== undefined && setters.setPodcastStyle) {
          setters.setPodcastStyle(parsedSettings.podcastStyle);
        }
        if (parsedSettings.timeFrame !== undefined && setters.setTimeFrame) {
          setters.setTimeFrame(parsedSettings.timeFrame);
        }
        if (parsedSettings.coHostPersonality !== undefined && setters.setCoHostPersonality) {
          setters.setCoHostPersonality(parsedSettings.coHostPersonality);
        }
        if (parsedSettings.podcastMood !== undefined && setters.setPodcastMood) {
          setters.setPodcastMood(parsedSettings.podcastMood);
        }
        if (parsedSettings.language !== undefined && setters.setLanguage) {
          setters.setLanguage(parsedSettings.language);
        }
        if (parsedSettings.selectedVoiceIds !== undefined && setters.setSelectedVoiceIds && parsedSettings.selectedVoiceIds.length > 0) {
          setters.setSelectedVoiceIds(parsedSettings.selectedVoiceIds);
        }
        if (parsedSettings.storyGenre !== undefined && setters.setStoryGenre) {
          setters.setStoryGenre(parsedSettings.storyGenre);
        }
        if (parsedSettings.eventFormat !== undefined && setters.setEventFormat) {
          setters.setEventFormat(parsedSettings.eventFormat);
        }
        if (parsedSettings.eventType !== undefined && setters.setEventType) {
          setters.setEventType(parsedSettings.eventType);
        }
      }
    } catch (e) {
      console.error(`Failed to load template settings for ${templateKey}`, e);
    }
  }, []); // Run once on mount

  // Save settings whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(settings));
    } catch (e) {
      console.error(`Failed to save template settings for ${templateKey}`, e);
    }
  }, [settings, storageKey]);
}
