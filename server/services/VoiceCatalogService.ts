/**
 * Voice Catalog Service - Business Logic Layer (Phase 1.2)
 * Provides high-level voice catalog operations for podcast generation
 */

import { type Voice } from '@shared/schema';
import { voiceCatalogRepository } from './VoiceCatalogRepository';
import { prosodyPresetRepository } from './ProsodyPresetRepository';
import {
  type PodcastMood,
  filterVoicesByMood,
  getVoiceMoodScore,
  getVoiceMoodCompatibility,
  getBestVoiceForMood,
  getRecommendedVoicesForMood,
} from '../utils/moodVoiceMapping';
import { filterAllowedTierVoices } from '../utils/voiceTierValidation';

export interface VoiceCollection {
  name: string;
  description: string;
  voices: Voice[];
}

export interface VoiceCatalogFilters {
  category?: string;
  tier?: string;
  accent?: string;
  gender?: string;
  search?: string;
}

export class VoiceCatalogService {
  /**
   * Get all active voices
   * CRITICAL: Only returns premium, ultra, and cinematic tier voices (standard tier disabled)
   */
  async getActiveVoices(): Promise<Voice[]> {
    const allVoices = await voiceCatalogRepository.findActive();
    // CRITICAL: Filter out standard tier voices - only allow premium, ultra, cinematic
    return filterAllowedTierVoices(allVoices);
  }

  /**
   * Get organized voice collections (Core, Regional, Specialty, News)
   * CRITICAL: Only returns premium, ultra, and cinematic tier voices (standard tier disabled)
   */
  async getOrganizedCollections(): Promise<VoiceCollection[]> {
    const [core, regional, specialty, news] = await Promise.all([
      voiceCatalogRepository.findByCategory('core'),
      voiceCatalogRepository.findByCategory('regional'),
      voiceCatalogRepository.findByCategory('specialty'),
      voiceCatalogRepository.findByCategory('news'),
    ]);

    // CRITICAL: Filter out standard tier voices from all collections
    const coreFiltered = filterAllowedTierVoices(core);
    const regionalFiltered = filterAllowedTierVoices(regional);
    const specialtyFiltered = filterAllowedTierVoices(specialty);
    const newsFiltered = filterAllowedTierVoices(news);

    return [
      {
        name: 'Core Collection',
        description: 'Most popular voices for everyday podcasts',
        voices: coreFiltered,
      },
      {
        name: 'Regional Collection',
        description: 'Extended accent coverage (UK, AU, IN)',
        voices: regionalFiltered,
      },
      {
        name: 'Specialty Collection',
        description: 'Premium Studio & Cinematic quality',
        voices: specialtyFiltered,
      },
      {
        name: 'News Anchors',
        description: 'Professional news broadcasting voices',
        voices: newsFiltered,
      },
    ];
  }

  /**
   * Get voices by quality tier
   * CRITICAL: Automatically rejects standard tier requests - only returns premium, ultra, cinematic
   */
  async getVoicesByTier(tier: string): Promise<Voice[]> {
    // CRITICAL: Block standard tier queries - return empty array
    if (tier === 'standard') {
      return [];
    }
    return await voiceCatalogRepository.findByTier(tier);
  }

  /**
   * Get voices by accent
   * CRITICAL: Only returns premium, ultra, and cinematic tier voices (standard tier disabled)
   */
  async getVoicesByAccent(accent: string): Promise<Voice[]> {
    const allVoices = await voiceCatalogRepository.findByAccent(accent);
    // CRITICAL: Filter out standard tier voices - only allow premium, ultra, cinematic
    return filterAllowedTierVoices(allVoices);
  }

  /**
   * Get voices with multiple filters
   * Supports combining search with other filters for refined results
   * CRITICAL: Only returns premium, ultra, and cinematic tier voices (standard tier disabled)
   */
  async getFilteredVoices(filters: VoiceCatalogFilters): Promise<Voice[]> {
    // CRITICAL: Block standard tier queries explicitly
    if (filters.tier === 'standard') {
      return [];
    }

    let results: Voice[];

    // If search query is provided with other filters, use combined search
    if (filters.search) {
      results = await voiceCatalogRepository.searchWithFilters(filters.search, {
        category: filters.category,
        tier: filters.tier,
        accent: filters.accent,
        gender: filters.gender,
      });
    } else {
      // Otherwise use filters only
      results = await voiceCatalogRepository.findWithFilters({
        category: filters.category,
        tier: filters.tier,
        accent: filters.accent,
        gender: filters.gender,
      });
    }

    // CRITICAL: Always filter out standard tier voices as final safety layer
    return filterAllowedTierVoices(results);
  }

  /**
   * Get voice by Google TTS name
   */
  async getVoiceByGoogleName(googleVoiceName: string): Promise<Voice | undefined> {
    return await voiceCatalogRepository.findByGoogleName(googleVoiceName);
  }

  /**
   * Get voice by ID
   */
  async getVoiceById(id: string): Promise<Voice | undefined> {
    return await voiceCatalogRepository.findById(id);
  }

  /**
   * Get recommended voices for podcast style
   * Returns a curated set based on podcast template and style
   * CRITICAL: Only returns premium, ultra, and cinematic tier voices (standard tier disabled)
   */
  async getRecommendedVoices(podcastStyle: string, numPeople: number): Promise<Voice[]> {
    let category = 'core';
    
    // Match category to podcast style
    if (podcastStyle === 'news') {
      category = 'news';
    } else if (podcastStyle === 'narrative' || podcastStyle === 'interview') {
      category = 'specialty';
    }

    const voices = await voiceCatalogRepository.findByCategory(category);
    
    // CRITICAL: Filter out standard tier voices - only allow premium, ultra, cinematic
    const allowedVoices = filterAllowedTierVoices(voices);
    
    // Return enough voices for the number of people
    return allowedVoices.slice(0, Math.max(numPeople, 4));
  }

  /**
   * Get voices suitable for multi-host podcasts
   * Returns diverse gender/accent combinations
   * CRITICAL: Only returns premium, ultra, and cinematic tier voices (standard tier disabled)
   */
  async getMultiHostVoices(numPeople: number): Promise<Voice[]> {
    const allVoices = await voiceCatalogRepository.findActive();
    
    // CRITICAL: Filter out standard tier voices - only allow premium, ultra, cinematic
    const voices = filterAllowedTierVoices(allVoices);
    
    // Ensure gender diversity
    const maleVoices = voices.filter((v) => v.gender === 'MALE');
    const femaleVoices = voices.filter((v) => v.gender === 'FEMALE');
    
    const selected: Voice[] = [];
    const half = Math.floor(numPeople / 2);
    
    // Alternate between male and female voices
    for (let i = 0; i < half; i++) {
      if (maleVoices[i]) selected.push(maleVoices[i]);
      if (femaleVoices[i]) selected.push(femaleVoices[i]);
    }
    
    // Add remaining if odd number
    if (numPeople % 2 === 1 && maleVoices[half]) {
      selected.push(maleVoices[half]);
    }
    
    return selected.slice(0, numPeople);
  }

  /**
   * Get voice catalog statistics
   * CRITICAL: Only counts premium, ultra, and cinematic tier voices (standard tier excluded)
   */
  async getCatalogStats() {
    const allVoices = await voiceCatalogRepository.findActive();
    
    // CRITICAL: Filter out standard tier voices - only count premium, ultra, cinematic
    const voices = filterAllowedTierVoices(allVoices);
    
    return {
      total: voices.length,
      byCategory: {
        core: voices.filter((v) => v.category === 'core').length,
        regional: voices.filter((v) => v.category === 'regional').length,
        specialty: voices.filter((v) => v.category === 'specialty').length,
        news: voices.filter((v) => v.category === 'news').length,
      },
      byTier: {
        standard: 0, // Always 0 since standard tier is disabled
        premium: voices.filter((v) => v.tier === 'premium').length,
        ultra: voices.filter((v) => v.tier === 'ultra').length,
        cinematic: voices.filter((v) => v.tier === 'cinematic').length,
      },
      byAccent: {
        US: voices.filter((v) => v.accent === 'US').length,
        UK: voices.filter((v) => v.accent === 'UK').length,
        AU: voices.filter((v) => v.accent === 'AU').length,
        IN: voices.filter((v) => v.accent === 'IN').length,
      },
      byGender: {
        MALE: voices.filter((v) => v.gender === 'MALE').length,
        FEMALE: voices.filter((v) => v.gender === 'FEMALE').length,
        NEUTRAL: voices.filter((v) => v.gender === 'NEUTRAL').length,
      },
    };
  }

  /**
   * Get all active prosody presets (for Phase 2)
   */
  async getActiveProsodyPresets() {
    return await prosodyPresetRepository.findActive();
  }

  /**
   * Get prosody preset by name
   */
  async getProsodyPresetByName(name: string) {
    return await prosodyPresetRepository.findByName(name);
  }

  // ========== Mood-Based Voice Recommendations ==========

  /**
   * Get voices sorted by mood compatibility
   * Returns all active voices re-ranked by how well they match the mood
   * CRITICAL: Only returns premium, ultra, and cinematic tier voices (standard tier disabled)
   */
  async getVoicesByMood(mood: PodcastMood): Promise<Voice[]> {
    const allVoices = await voiceCatalogRepository.findActive();
    
    // CRITICAL: Filter out standard tier voices - only allow premium, ultra, cinematic
    const voices = filterAllowedTierVoices(allVoices);
    
    return filterVoicesByMood(voices, mood);
  }

  /**
   * Get voice collections organized by mood compatibility
   * Each collection is sorted by mood match score
   * CRITICAL: Only returns premium, ultra, and cinematic tier voices (standard tier disabled)
   */
  async getOrganizedCollectionsByMood(mood: PodcastMood): Promise<VoiceCollection[]> {
    const [core, regional, specialty, news] = await Promise.all([
      voiceCatalogRepository.findByCategory('core'),
      voiceCatalogRepository.findByCategory('regional'),
      voiceCatalogRepository.findByCategory('specialty'),
      voiceCatalogRepository.findByCategory('news'),
    ]);

    // CRITICAL: Filter out standard tier voices from all collections
    const coreFiltered = filterAllowedTierVoices(core);
    const regionalFiltered = filterAllowedTierVoices(regional);
    const specialtyFiltered = filterAllowedTierVoices(specialty);
    const newsFiltered = filterAllowedTierVoices(news);

    return [
      {
        name: 'Core Collection',
        description: 'Most popular voices for everyday podcasts',
        voices: filterVoicesByMood(coreFiltered, mood),
      },
      {
        name: 'Regional Collection',
        description: 'Extended accent coverage (UK, AU, IN)',
        voices: filterVoicesByMood(regionalFiltered, mood),
      },
      {
        name: 'Specialty Collection',
        description: 'Premium Studio & Cinematic quality',
        voices: filterVoicesByMood(specialtyFiltered, mood),
      },
      {
        name: 'News Anchors',
        description: 'Professional news broadcasting voices',
        voices: filterVoicesByMood(newsFiltered, mood),
      },
    ];
  }

  /**
   * Get best voice recommendations for a mood and host count
   * Returns diverse, mood-compatible voices
   * CRITICAL: Only returns premium, ultra, and cinematic tier voices (standard tier disabled)
   */
  async getMoodRecommendations(mood: PodcastMood, hostCount: number = 1): Promise<Voice[]> {
    const allVoices = await voiceCatalogRepository.findActive();
    // CRITICAL: Filter out standard tier voices - only allow premium, ultra, cinematic
    const voices = filterAllowedTierVoices(allVoices);
    return getRecommendedVoicesForMood(voices, mood, hostCount);
  }

  /**
   * Get voice with mood compatibility metadata
   * Returns voice enriched with mood match score and compatibility description
   */
  async getVoiceWithMoodMetadata(voiceId: string, mood: PodcastMood) {
    const voice = await voiceCatalogRepository.findById(voiceId);
    if (!voice) return null;

    return {
      ...voice,
      moodScore: getVoiceMoodScore(voice, mood),
      moodCompatibility: getVoiceMoodCompatibility(voice, mood),
    };
  }

  /**
   * Get best single voice for a mood (optionally filtered by gender)
   * CRITICAL: Only considers premium, ultra, and cinematic tier voices (standard tier disabled)
   */
  async getBestVoiceForMood(mood: PodcastMood, gender?: string): Promise<Voice | null> {
    const allVoices = await voiceCatalogRepository.findActive();
    // CRITICAL: Filter out standard tier voices - only allow premium, ultra, cinematic
    const voices = filterAllowedTierVoices(allVoices);
    return getBestVoiceForMood(voices, mood, gender);
  }
}

// Singleton instance
export const voiceCatalogService = new VoiceCatalogService();
