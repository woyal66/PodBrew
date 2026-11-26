import { db } from '../db';
import { generatedPodcasts } from '@shared/schema';
import { eq, and, ne } from 'drizzle-orm';

export async function fixPodcastVisibilityOnStartup(): Promise<void> {
  try {
    console.log('🔧 [Startup] Checking podcast visibility...');

    const result = await db
      .update(generatedPodcasts)
      .set({ isPublic: true })
      .where(
        and(
          eq(generatedPodcasts.isPublic, false),
          ne(generatedPodcasts.templateCategory, 'medical'),
          ne(generatedPodcasts.templateCategory, 'documents')
        )
      )
      .returning({ id: generatedPodcasts.id });

    const updatedCount = result.length;
    
    if (updatedCount > 0) {
      console.log(`✅ [Startup] Fixed ${updatedCount} podcasts - set to public visibility`);
    } else {
      console.log('✅ [Startup] All podcasts have correct visibility');
    }
  } catch (error) {
    console.error('⚠️ [Startup] Failed to fix podcast visibility (non-critical):', error);
  }
}
