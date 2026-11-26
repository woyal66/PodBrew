/**
 * Sync Accent Previews
 * Scans object storage for cached accent previews and updates the database
 * 
 * PREREQUISITES:
 * - Environment variable PUBLIC_OBJECT_SEARCH_PATHS must be set
 * - The accent_preview_urls column must exist in the voices table
 *   (schema is in shared/schema.ts, apply with: npm run db:push --force)
 * 
 * USAGE:
 *   npx tsx server/scripts/syncAccentPreviews.ts          # Scan only (dry run)
 *   npx tsx server/scripts/syncAccentPreviews.ts --sync   # Scan and update database
 * 
 * This script finds all accent preview files in object storage that match the pattern:
 *   voice-previews/{voiceId}/accents/{voiceName}-{accent}-{hash}.mp3
 * And syncs their URLs to the accentPreviewUrls JSONB column in the voices table.
 */

import { objectStorageClient } from '../objectStorage';
import { db } from '../db';
import { voices } from '@shared/schema';
import { eq } from 'drizzle-orm';

const SUPPORTED_ACCENTS = [
  'british',
  'australian', 
  'irish',
  'scottish',
  'indian',
  'canadian',
  'southern-american',
  'new-zealand'
];

interface StorageConfig {
  bucketName: string;
  basePath: string;
}

function parseStorageConfig(): StorageConfig {
  const publicPaths = process.env.PUBLIC_OBJECT_SEARCH_PATHS || '';
  const allPaths = publicPaths.split(',').map(p => p.trim()).filter(Boolean);
  
  if (allPaths.length === 0) {
    throw new Error('PUBLIC_OBJECT_SEARCH_PATHS not set. Set up Object Storage first.');
  }
  
  // Use first configured path
  const searchPath = allPaths[0];
  
  // Parse bucket name from path (format: /bucketName/basePath or bucketName/basePath)
  const cleanPath = searchPath.startsWith('/') ? searchPath.slice(1) : searchPath;
  const parts = cleanPath.split('/');
  const bucketName = parts[0];
  const basePath = parts.slice(1).join('/');
  
  if (!bucketName) {
    throw new Error('Invalid PUBLIC_OBJECT_SEARCH_PATHS format. Expected: /bucket-name/path');
  }
  
  return { bucketName, basePath };
}

async function listFilesWithPrefix(prefix: string, config: StorageConfig): Promise<{ files: string[], basePath: string }> {
  console.log(`Bucket: ${config.bucketName}, Base path: ${config.basePath}`);
  
  const bucket = objectStorageClient.bucket(config.bucketName);
  const fullPrefix = config.basePath ? `${config.basePath}/${prefix}` : prefix;
  
  console.log(`Scanning prefix: ${fullPrefix}`);
  
  const [files] = await bucket.getFiles({ prefix: fullPrefix });
  return { 
    files: files.map(f => f.name),
    basePath: config.basePath
  };
}

async function syncAccentPreviews() {
  console.log('Scanning object storage for accent previews...\n');
  
  // Parse storage configuration
  const config = parseStorageConfig();
  
  // Get all files in voice-previews
  const { files: allFiles, basePath } = await listFilesWithPrefix('voice-previews/', config);
  
  // Filter to only accent preview files
  const accentFiles = allFiles.filter(f => f.includes('/accents/'));
  
  console.log(`Found ${accentFiles.length} accent preview files in storage\n`);
  
  // Parse and organize by voice and accent
  const byVoice: Record<string, Record<string, string>> = {};
  const accentPattern = /voice-previews\/([^/]+)\/accents\/.*-(british|australian|irish|scottish|indian|canadian|southern-american|new-zealand)-[a-f0-9]+\.mp3/i;
  
  // Build regex to strip the base path prefix dynamically
  const basePathPrefix = basePath ? new RegExp(`^${basePath}/`) : null;
  
  for (const filePath of accentFiles) {
    const match = filePath.match(accentPattern);
    if (match) {
      const voiceId = match[1];
      const accent = match[2].toLowerCase();
      
      if (!byVoice[voiceId]) {
        byVoice[voiceId] = {};
      }
      // Construct public URL path - strip the base path prefix dynamically
      const relativePath = basePathPrefix ? filePath.replace(basePathPrefix, '') : filePath;
      byVoice[voiceId][accent] = `/public-objects/${relativePath}`;
    }
  }
  
  const voiceCount = Object.keys(byVoice).length;
  console.log(`Organized into ${voiceCount} voices with accent previews\n`);
  
  // Count accents
  const accentCounts: Record<string, number> = {};
  
  for (const voiceId of Object.keys(byVoice)) {
    for (const accent of Object.keys(byVoice[voiceId])) {
      accentCounts[accent] = (accentCounts[accent] || 0) + 1;
    }
  }
  
  console.log('Cached accents per type (30 voices total):');
  for (const accent of SUPPORTED_ACCENTS) {
    const count = accentCounts[accent] || 0;
    const status = count >= 30 ? '✅' : count > 0 ? '⏳' : '❌';
    console.log(`  ${status} ${accent}: ${count}/30`);
  }
  
  const totalCached = Object.values(accentCounts).reduce((a, b) => a + b, 0);
  const totalExpected = 30 * 8; // 30 voices × 8 accents
  console.log(`\nTotal: ${totalCached}/${totalExpected} accent previews cached (${Math.round(totalCached/totalExpected*100)}%)\n`);
  
  // Check for --sync flag
  if (process.argv.includes('--sync')) {
    console.log('--- Syncing to database ---\n');
    
    let updated = 0;
    for (const [voiceId, accents] of Object.entries(byVoice)) {
      try {
        await db.update(voices)
          .set({ accentPreviewUrls: accents })
          .where(eq(voices.id, voiceId));
        updated++;
        console.log(`✅ Updated ${voiceId}: ${Object.keys(accents).length} accents`);
      } catch (error) {
        console.error(`❌ Failed to update ${voiceId}:`, error);
      }
    }
    
    console.log(`\n✅ Database sync complete: ${updated} voices updated`);
  } else {
    console.log('Run with --sync to update database');
  }
}

syncAccentPreviews().catch(console.error);
