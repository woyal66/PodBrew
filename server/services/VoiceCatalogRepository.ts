/**
 * Voice Catalog Repository - Data Access Layer (Phase 1.2)
 * Handles all database queries for voices table
 */

import { db } from '../db';
import { voices, type Voice } from '@shared/schema';
import { eq, or, ilike, and, asc } from 'drizzle-orm';

export class VoiceCatalogRepository {
  /**
   * Get all voices (including inactive)
   */
  async findAll(): Promise<Voice[]> {
    return await db
      .select()
      .from(voices)
      .orderBy(asc(voices.sortOrder));
  }

  /**
   * Get only active voices
   */
  async findActive(): Promise<Voice[]> {
    return await db
      .select()
      .from(voices)
      .where(eq(voices.isActive, true))
      .orderBy(asc(voices.sortOrder));
  }

  /**
   * Get voices by category (core, regional, specialty, news)
   */
  async findByCategory(category: string): Promise<Voice[]> {
    return await db
      .select()
      .from(voices)
      .where(
        and(
          eq(voices.category, category),
          eq(voices.isActive, true)
        )
      )
      .orderBy(asc(voices.sortOrder));
  }

  /**
   * Get voices by quality tier (standard, premium, ultra, cinematic)
   */
  async findByTier(tier: string): Promise<Voice[]> {
    return await db
      .select()
      .from(voices)
      .where(
        and(
          eq(voices.tier, tier),
          eq(voices.isActive, true)
        )
      )
      .orderBy(asc(voices.sortOrder));
  }

  /**
   * Get voices by accent (US, UK, AU, IN)
   */
  async findByAccent(accent: string): Promise<Voice[]> {
    return await db
      .select()
      .from(voices)
      .where(
        and(
          eq(voices.accent, accent),
          eq(voices.isActive, true)
        )
      )
      .orderBy(asc(voices.sortOrder));
  }

  /**
   * Get voices by gender (MALE, FEMALE, NEUTRAL)
   */
  async findByGender(gender: string): Promise<Voice[]> {
    return await db
      .select()
      .from(voices)
      .where(
        and(
          eq(voices.gender, gender.toUpperCase()),
          eq(voices.isActive, true)
        )
      )
      .orderBy(asc(voices.sortOrder));
  }

  /**
   * Search voices by name or description
   */
  async search(query: string): Promise<Voice[]> {
    const searchPattern = `%${query}%`;
    
    return await db
      .select()
      .from(voices)
      .where(
        and(
          or(
            ilike(voices.displayName, searchPattern),
            ilike(voices.description, searchPattern),
            ilike(voices.toneArchetype, searchPattern)
          ),
          eq(voices.isActive, true)
        )
      )
      .orderBy(asc(voices.sortOrder));
  }

  /**
   * Search voices with additional filters
   */
  async searchWithFilters(query: string, filters: {
    category?: string;
    tier?: string;
    accent?: string;
    gender?: string;
  }): Promise<Voice[]> {
    const searchPattern = `%${query}%`;
    const conditions = [
      or(
        ilike(voices.displayName, searchPattern),
        ilike(voices.description, searchPattern),
        ilike(voices.toneArchetype, searchPattern)
      ),
      eq(voices.isActive, true),
    ];

    // Add additional filters
    if (filters.category) {
      conditions.push(eq(voices.category, filters.category));
    }
    if (filters.tier) {
      conditions.push(eq(voices.tier, filters.tier));
    }
    if (filters.accent) {
      conditions.push(eq(voices.accent, filters.accent));
    }
    if (filters.gender) {
      // Normalize gender to uppercase
      conditions.push(eq(voices.gender, filters.gender.toUpperCase()));
    }

    return await db
      .select()
      .from(voices)
      .where(and(...conditions))
      .orderBy(asc(voices.sortOrder));
  }

  /**
   * Update voice preview URL
   */
  async updatePreviewUrl(voiceId: string, previewUrl: string): Promise<void> {
    await db
      .update(voices)
      .set({ previewUrl, updatedAt: new Date() })
      .where(eq(voices.id, voiceId));
  }

  /**
   * Get voice by Google TTS voice name (e.g., "en-US-Neural2-A")
   */
  async findByGoogleName(googleVoiceName: string): Promise<Voice | undefined> {
    const [voice] = await db
      .select()
      .from(voices)
      .where(eq(voices.googleVoiceName, googleVoiceName))
      .limit(1);
    
    return voice;
  }

  /**
   * Get voice by ID
   */
  async findById(id: string): Promise<Voice | undefined> {
    const [voice] = await db
      .select()
      .from(voices)
      .where(eq(voices.id, id))
      .limit(1);
    
    return voice;
  }

  /**
   * Get voices with multiple filters
   */
  async findWithFilters(filters: {
    category?: string;
    tier?: string;
    accent?: string;
    gender?: string;
  }): Promise<Voice[]> {
    const conditions = [eq(voices.isActive, true)];

    if (filters.category) {
      conditions.push(eq(voices.category, filters.category));
    }
    if (filters.tier) {
      conditions.push(eq(voices.tier, filters.tier));
    }
    if (filters.accent) {
      conditions.push(eq(voices.accent, filters.accent));
    }
    if (filters.gender) {
      // Normalize gender to uppercase to match database values (MALE, FEMALE, NEUTRAL)
      conditions.push(eq(voices.gender, filters.gender.toUpperCase()));
    }

    return await db
      .select()
      .from(voices)
      .where(and(...conditions))
      .orderBy(asc(voices.sortOrder));
  }
}

// Singleton instance
export const voiceCatalogRepository = new VoiceCatalogRepository();
