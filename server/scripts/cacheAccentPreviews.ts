/**
 * Accent Preview Caching Script
 * 
 * Pre-generates voice previews with specific accents to avoid TTS calls during runtime.
 * Run this script after publish to gradually cache accent previews.
 * 
 * Usage:
 *   npx tsx server/scripts/cacheAccentPreviews.ts british australian
 *   npx tsx server/scripts/cacheAccentPreviews.ts irish scottish
 *   npx tsx server/scripts/cacheAccentPreviews.ts indian canadian
 *   npx tsx server/scripts/cacheAccentPreviews.ts "southern american" "new zealand"
 * 
 * Each accent × 30 voices = 30 TTS calls
 * Recommended: 2 accents per day (60 calls) to respect rate limits
 */

import { db } from '../db';
import { voices } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { ObjectStorageService } from '../objectStorage';
import { synthesizeSingleSpeaker, type SynthesisOptions } from '../geminiTTS';
import { convertWavToMp3 } from '../audioUtils';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const PROGRESS_DIR = '/tmp/nzfix';
function progressFile(accent: string) {
  return path.join(PROGRESS_DIR, `done-${accent.replace(/\s+/g, '-')}.json`);
}
function loadDone(accent: string): Set<string> {
  try {
    fs.mkdirSync(PROGRESS_DIR, { recursive: true });
    const raw = fs.readFileSync(progressFile(accent), 'utf-8');
    return new Set(JSON.parse(raw));
  } catch { return new Set(); }
}
function saveDone(accent: string, set: Set<string>) {
  try {
    fs.mkdirSync(PROGRESS_DIR, { recursive: true });
    fs.writeFileSync(progressFile(accent), JSON.stringify(Array.from(set)));
  } catch {}
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

export function generateAccentPreviewFileName(voiceId: string, voiceName: string, accent: string): string {
  const normalizedAccent = accent.toLowerCase().trim();
  const hash = crypto
    .createHash('md5')
    .update(`${voiceId}-${voiceName}-${normalizedAccent}`)
    .digest('hex')
    .substring(0, 8);
  
  const safeAccent = normalizedAccent.replace(/\s+/g, '-');
  return `${voiceName}-${safeAccent}-${hash}.mp3`;
}

export function getAccentPreviewPath(voiceId: string, filename: string): string {
  return `voice-previews/${voiceId}/accents/${filename}`;
}

const SUPPORTED_ACCENTS = [
  'british',
  'australian',
  'irish',
  'scottish',
  'indian',
  'canadian',
  'southern american',
  'new zealand'
] as const;

type SupportedAccent = typeof SUPPORTED_ACCENTS[number];

const ACCENT_DISPLAY_MAP: Record<string, string> = {
  'british': 'British',
  'australian': 'Australian',
  'irish': 'Irish',
  'scottish': 'Scottish',
  'indian': 'Indian',
  'canadian': 'Canadian',
  'southern american': 'Southern American',
  'new zealand': 'New Zealand'
};

const TEST_PHRASE = "Welcome to PodBrew. This is a sample of my voice with this accent, designed to help you choose the perfect narrator for your podcast. I can adapt to different tones and styles to match your content.";

const DELAY_BETWEEN_CALLS_MS = 1000;

class AccentPreviewCacher {
  private objectStorage: ObjectStorageService;

  constructor() {
    this.objectStorage = new ObjectStorageService();
  }

  private normalizeAccentName(accent: string): string {
    return accent.toLowerCase().trim();
  }

  async checkExistingPreview(voiceId: string, voiceName: string, accent: string): Promise<string | null> {
    const normalizedAccent = this.normalizeAccentName(accent);
    const filename = generateAccentPreviewFileName(voiceId, voiceName, normalizedAccent);
    const filePath = getAccentPreviewPath(voiceId, filename);

    try {
      const file = await this.objectStorage.searchPublicObject(filePath);
      if (file) {
        return `/public-objects/${filePath}`;
      }
    } catch (error) {
      console.error(`Error checking existing preview:`, error);
    }

    return null;
  }

  async generateAccentPreview(voiceId: string, voiceName: string, displayName: string, accent: string, forceRegenerate = false): Promise<string> {
    const normalizedAccent = this.normalizeAccentName(accent);
    
    const existingUrl = await this.checkExistingPreview(voiceId, voiceName, normalizedAccent);
    if (existingUrl && !forceRegenerate) {
      console.log(`  ✅ Already cached: ${displayName} (${ACCENT_DISPLAY_MAP[normalizedAccent]})`);
      return existingUrl;
    }

    console.log(`  ⏳ Generating: ${displayName} (${ACCENT_DISPLAY_MAP[normalizedAccent]})...`);

    const synthesisOptions: SynthesisOptions = {
      applyNativeAccent: true,
      voiceAccent: ACCENT_DISPLAY_MAP[normalizedAccent] || normalizedAccent,
    };

    const audioBuffer = await withTimeout(
      synthesizeSingleSpeaker(
        TEST_PHRASE,
        voiceName,
        'gemini-2.5-flash-preview-tts',
        synthesisOptions
      ),
      90000,
      `synthesizeSingleSpeaker(${voiceName}, ${normalizedAccent})`
    );

    const mp3Buffer = await convertWavToMp3(audioBuffer);

    const filename = generateAccentPreviewFileName(voiceId, voiceName, normalizedAccent);
    const filePath = getAccentPreviewPath(voiceId, filename);
    const previewUrl = await this.objectStorage.uploadPublicObject(filePath, mp3Buffer, 'audio/mpeg');

    console.log(`  ✅ Generated: ${displayName} (${ACCENT_DISPLAY_MAP[normalizedAccent]})`);

    return previewUrl;
  }

  async cacheAccentsForAllVoices(accents: string[], forceRegenerate = false, limit: number = Number.POSITIVE_INFINITY): Promise<void> {
    const allVoices = await db.select().from(voices).where(eq(voices.isActive, true));
    
    console.log(`\n🎙️  Accent Preview Caching Script`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📊 Found ${allVoices.length} active voices`);
    console.log(`🎯 Accents to cache: ${accents.map(a => ACCENT_DISPLAY_MAP[a] || a).join(', ')}`);
    console.log(`📦 Total previews to generate: ${allVoices.length * accents.length}`);
    if (forceRegenerate) {
      console.log(`⚠️  Force mode: existing previews will be overwritten`);
    }
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    let totalGenerated = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (const accent of accents) {
      const normalizedAccent = this.normalizeAccentName(accent);
      const done = loadDone(normalizedAccent);
      console.log(`\n📍 Processing accent: ${ACCENT_DISPLAY_MAP[normalizedAccent] || accent}`);
      console.log(`${'─'.repeat(40)}`);
      if (done.size > 0) {
        console.log(`📋 Resume: ${done.size} voice(s) already regenerated this session, will skip.`);
      }

      let regeneratedThisRun = 0;
      for (let i = 0; i < allVoices.length; i++) {
        if (regeneratedThisRun >= limit) {
          console.log(`  🛑 Reached --limit ${limit} for this run; exit and resume next invocation.`);
          break;
        }
        const voice = allVoices[i];

        if (forceRegenerate && done.has(voice.id)) {
          console.log(`  [${i + 1}/${allVoices.length}] ⏭️  Resume-skip: ${voice.aliasName || voice.displayName}`);
          totalSkipped++;
          continue;
        }

        try {
          const existingUrl = await this.checkExistingPreview(
            voice.id, 
            voice.googleVoiceName, 
            normalizedAccent
          );
          
          if (existingUrl && !forceRegenerate) {
            console.log(`  [${i + 1}/${allVoices.length}] ✅ Cached: ${voice.aliasName || voice.displayName}`);
            totalSkipped++;
          } else {
            if (existingUrl && forceRegenerate) {
              console.log(`  [${i + 1}/${allVoices.length}] ♻️  Overwriting: ${voice.aliasName || voice.displayName}`);
            }
            await this.generateAccentPreview(
              voice.id,
              voice.googleVoiceName,
              voice.aliasName || voice.displayName,
              normalizedAccent,
              forceRegenerate
            );
            totalGenerated++;
            regeneratedThisRun++;
            done.add(voice.id);
            saveDone(normalizedAccent, done);
            
            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_CALLS_MS));
          }
        } catch (error) {
          console.error(`  [${i + 1}/${allVoices.length}] ❌ Error for ${voice.aliasName || voice.displayName}:`, error);
          totalErrors++;
          
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📊 Summary`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  ✅ Generated: ${totalGenerated}`);
    console.log(`  ⏭️  Skipped (already cached): ${totalSkipped}`);
    console.log(`  ❌ Errors: ${totalErrors}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  }
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const forceRegenerate = rawArgs.includes('--force');
  let limit = Infinity;
  const limitIdx = rawArgs.findIndex(a => a === '--limit');
  if (limitIdx >= 0 && rawArgs[limitIdx + 1]) {
    limit = parseInt(rawArgs[limitIdx + 1], 10) || Infinity;
  }
  const args = rawArgs.filter((a, i) => a !== '--force' && a !== '--limit' && !(limitIdx >= 0 && i === limitIdx + 1));

  if (args.length === 0) {
    console.log(`
🎙️  Accent Preview Caching Script
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Usage:
  npx tsx server/scripts/cacheAccentPreviews.ts [--force] <accent1> [accent2] ...

Flags:
  --force   Overwrite existing cached previews (use to fix corrupted files)

Supported accents:
${SUPPORTED_ACCENTS.map(a => `  • ${ACCENT_DISPLAY_MAP[a]}`).join('\n')}

Examples:
  Day 1: npx tsx server/scripts/cacheAccentPreviews.ts british australian
  Day 2: npx tsx server/scripts/cacheAccentPreviews.ts irish scottish
  Day 3: npx tsx server/scripts/cacheAccentPreviews.ts indian canadian
  Day 4: npx tsx server/scripts/cacheAccentPreviews.ts "southern american" "new zealand"
  Repair: npx tsx server/scripts/cacheAccentPreviews.ts --force canadian

Each accent × 30 voices = 30 TTS calls
Recommended: 2 accents per day (60 calls) to respect rate limits
`);
    process.exit(0);
  }

  const requestedAccents = args.map(a => a.toLowerCase().trim());
  
  const invalidAccents = requestedAccents.filter(a => 
    !SUPPORTED_ACCENTS.includes(a as SupportedAccent)
  );

  if (invalidAccents.length > 0) {
    console.error(`❌ Invalid accent(s): ${invalidAccents.join(', ')}`);
    console.error(`\nSupported accents: ${SUPPORTED_ACCENTS.join(', ')}`);
    process.exit(1);
  }

  if (forceRegenerate) {
    console.log(`\n⚠️  --force flag active: existing previews will be overwritten\n`);
  }

  const cacher = new AccentPreviewCacher();
  await cacher.cacheAccentsForAllVoices(requestedAccents, forceRegenerate, limit);
  
  console.log('✅ Accent preview caching complete!');
  process.exit(0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
