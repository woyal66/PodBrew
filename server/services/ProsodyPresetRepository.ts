/**
 * Prosody Preset Repository - Data Access Layer (Phase 2)
 * Handles all database queries for prosody_presets table
 */

import { db } from '../db';
import { prosodyPresets, type ProsodyPreset } from '@shared/schema';
import { eq, asc } from 'drizzle-orm';

export class ProsodyPresetRepository {
  /**
   * Get all prosody presets (including inactive)
   */
  async findAll(): Promise<ProsodyPreset[]> {
    return await db
      .select()
      .from(prosodyPresets)
      .orderBy(asc(prosodyPresets.displayName));
  }

  /**
   * Get only active prosody presets
   */
  async findActive(): Promise<ProsodyPreset[]> {
    return await db
      .select()
      .from(prosodyPresets)
      .where(eq(prosodyPresets.isActive, true))
      .orderBy(asc(prosodyPresets.displayName));
  }

  /**
   * Get prosody preset by name (e.g., "neutral", "warm", "excited")
   */
  async findByName(name: string): Promise<ProsodyPreset | undefined> {
    const [preset] = await db
      .select()
      .from(prosodyPresets)
      .where(eq(prosodyPresets.name, name))
      .limit(1);
    
    return preset;
  }

  /**
   * Get prosody preset by ID
   */
  async findById(id: string): Promise<ProsodyPreset | undefined> {
    const [preset] = await db
      .select()
      .from(prosodyPresets)
      .where(eq(prosodyPresets.id, id))
      .limit(1);
    
    return preset;
  }
}

// Singleton instance
export const prosodyPresetRepository = new ProsodyPresetRepository();
