/**
 * Seed script to populate voices table with 60 curated voices
 * Run: npx tsx server/utils/seedVoices.ts
 */

import { db } from '../db';
import { voices } from '@shared/schema';
import { getAllCuratedVoices } from './curatedVoices';
import { eq } from 'drizzle-orm';

async function seedVoices() {
  console.log('🎙️  Seeding curated voice catalog...\n');

  const curatedVoices = getAllCuratedVoices();

  console.log(`📦 Total voices to seed: ${curatedVoices.length}\n`);

  try {
    let added = 0;
    let skipped = 0;

    for (const voice of curatedVoices) {
      // Check if voice already exists
      const existing = await db
        .select()
        .from(voices)
        .where(eq(voices.googleVoiceName, voice.googleVoiceName));

      if (existing.length > 0) {
        // Update existing voice with calibration data (ensures production sync)
        await db
          .update(voices)
          .set({
            calibratedWps: voice.calibratedWps || null,
            calibratedAt: voice.calibratedWps ? new Date() : null,
          })
          .where(eq(voices.googleVoiceName, voice.googleVoiceName));
        console.log(`🔄 Updated "${voice.aliasName}" calibration: ${voice.calibratedWps ? (voice.calibratedWps * 60).toFixed(0) + ' WPM' : 'N/A'}`);
        skipped++;
      } else {
        await db.insert(voices).values({
          googleVoiceName: voice.googleVoiceName,
          displayName: voice.displayName,
          aliasName: voice.aliasName,
          description: voice.description,
          accent: voice.accent,
          gender: voice.gender,
          modelType: voice.modelType,
          tier: voice.tier,
          category: voice.category,
          toneArchetype: voice.toneArchetype || null,
          sortOrder: voice.sortOrder,
          isActive: true,
          calibratedWps: voice.calibratedWps || null,
          calibratedAt: voice.calibratedWps ? new Date() : null,
        });
        console.log(`✅ Added "${voice.aliasName}" (${voice.calibratedWps ? (voice.calibratedWps * 60).toFixed(0) + ' WPM' : 'N/A'})`);
        added++;
      }
    }

    console.log(`\n🎉 Voice catalog seeding complete!\n`);
    console.log(`📊 Summary:`);
    console.log(`   ✅ Added: ${added} voices`);
    console.log(`   ⏭️  Skipped: ${skipped} voices\n`);

    // Display breakdown by category
    const allVoices = await db.select().from(voices);
    const byCategory = {
      core: allVoices.filter((v) => v.category === 'core').length,
      regional: allVoices.filter((v) => v.category === 'regional').length,
      specialty: allVoices.filter((v) => v.category === 'specialty').length,
      news: allVoices.filter((v) => v.category === 'news').length,
    };

    const byTier = {
      standard: allVoices.filter((v) => v.tier === 'standard').length,
      premium: allVoices.filter((v) => v.tier === 'premium').length,
      ultra: allVoices.filter((v) => v.tier === 'ultra').length,
      cinematic: allVoices.filter((v) => v.tier === 'cinematic').length,
    };

    const byAccent = {
      US: allVoices.filter((v) => v.accent === 'US').length,
      UK: allVoices.filter((v) => v.accent === 'UK').length,
      AU: allVoices.filter((v) => v.accent === 'AU').length,
      IN: allVoices.filter((v) => v.accent === 'IN').length,
    };

    console.log(`🗂️  By Category:`);
    console.log(`   Core: ${byCategory.core}`);
    console.log(`   Regional: ${byCategory.regional}`);
    console.log(`   Specialty: ${byCategory.specialty}`);
    console.log(`   News: ${byCategory.news}\n`);

    console.log(`💎 By Quality Tier:`);
    console.log(`   Standard (1.5 credits/min): ${byTier.standard}`);
    console.log(`   Premium (5 credits/min): ${byTier.premium}`);
    console.log(`   Ultra (7 credits/min): ${byTier.ultra}`);
    console.log(`   Cinematic (12 credits/min): ${byTier.cinematic}\n`);

    console.log(`🌍 By Accent:`);
    console.log(`   US English: ${byAccent.US}`);
    console.log(`   UK English: ${byAccent.UK}`);
    console.log(`   Australian English: ${byAccent.AU}`);
    console.log(`   Indian English: ${byAccent.IN}\n`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding voices:', error);
    process.exit(1);
  }
}

seedVoices();
