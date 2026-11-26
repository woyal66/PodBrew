/**
 * Migrate Voice Avatars from Base64 to Object Storage
 * Converts embedded base64 avatars to object storage URLs for better performance
 */

import { db } from '../db';
import { voices } from '@shared/schema';
import { ObjectStorageService } from '../objectStorage';
import { eq, like } from 'drizzle-orm';

async function migrateAvatarsToStorage() {
  console.log('🔄 Starting avatar migration to object storage...\n');
  
  const objectStorage = new ObjectStorageService();
  
  // Find all voices with base64 avatars
  const voicesWithBase64 = await db
    .select({
      id: voices.id,
      aliasName: voices.aliasName,
      avatarUrl: voices.avatarUrl,
    })
    .from(voices)
    .where(like(voices.avatarUrl, 'data:%'));
  
  console.log(`📊 Found ${voicesWithBase64.length} voices with base64 avatars\n`);
  
  if (voicesWithBase64.length === 0) {
    console.log('✅ No base64 avatars to migrate');
    return;
  }
  
  let successCount = 0;
  let failCount = 0;
  
  for (const voice of voicesWithBase64) {
    try {
      if (!voice.avatarUrl || !voice.avatarUrl.startsWith('data:')) {
        continue;
      }
      
      console.log(`🖼️  Migrating ${voice.aliasName}...`);
      
      // Extract base64 data from data URL
      const matches = voice.avatarUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) {
        console.log(`   ⚠️  Invalid data URL format, skipping`);
        continue;
      }
      
      const mimeType = matches[1];
      const base64Data = matches[2];
      const buffer = Buffer.from(base64Data, 'base64');
      
      // Upload to object storage
      const publicUrl = await objectStorage.uploadVoiceAvatar(
        voice.id,
        buffer,
        'avatar.png'
      );
      
      // Update database with new URL
      await db
        .update(voices)
        .set({ 
          avatarUrl: publicUrl,
          updatedAt: new Date()
        })
        .where(eq(voices.id, voice.id));
      
      successCount++;
      console.log(`   ✅ Migrated to ${publicUrl}`);
      
    } catch (error) {
      failCount++;
      console.error(`   ❌ Failed:`, error instanceof Error ? error.message : error);
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 Migration Summary:');
  console.log(`   ✅ Success: ${successCount}`);
  console.log(`   ❌ Failed: ${failCount}`);
  console.log('='.repeat(60) + '\n');
}

// Run the migration
migrateAvatarsToStorage()
  .then(() => {
    console.log('✅ Avatar migration complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
