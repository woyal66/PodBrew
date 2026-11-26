/**
 * Seed script to populate prosody_presets table with emotional tone templates
 * Run: npx tsx server/utils/seedProsodyPresets.ts
 */

import { db } from '../db';
import { prosodyPresets } from '@shared/schema';
import { getProsodyPresetSeeds } from './prosodyTemplates';
import { eq } from 'drizzle-orm';

async function seedProsodyPresets() {
  console.log('🎭 Seeding prosody presets...\n');

  const seeds = getProsodyPresetSeeds();

  try {
    // Insert all presets
    for (const seed of seeds) {
      const existing = await db
        .select()
        .from(prosodyPresets)
        .where(eq(prosodyPresets.name, seed.name));

      if (existing.length > 0) {
        console.log(`⏭️  Skipping "${seed.displayName}" (already exists)`);
      } else {
        await db.insert(prosodyPresets).values(seed);
        console.log(`✅ Added "${seed.displayName}" preset`);
      }
    }

    console.log('\n🎉 Prosody preset seeding complete!\n');

    // Display summary
    const allPresets = await db.select().from(prosodyPresets);
    console.log('📊 Summary:');
    console.log(`   Total presets: ${allPresets.length}\n`);

    allPresets.forEach((preset) => {
      console.log(`   ${preset.displayName}:`);
      console.log(`     - Pitch: ${preset.pitchAdjustment}`);
      console.log(`     - Rate: ${preset.rateAdjustment}`);
      console.log(`     - Volume: ${preset.volumeAdjustment}`);
      console.log(`     - Emphasis: ${preset.emphasisLevel}`);
      console.log(`     - Description: ${preset.description}`);
      console.log('');
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding prosody presets:', error);
    process.exit(1);
  }
}

seedProsodyPresets();
