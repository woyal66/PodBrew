import { storage } from "../storage";
import { ObjectStorageService } from "../objectStorage";
import { db } from "../db";
import { generatedPodcasts } from "@shared/schema";
import { lt, and, eq, sql } from "drizzle-orm";
import type { GeneratedPodcast } from "@shared/schema";

const objectStorage = new ObjectStorageService();

export interface CleanupResult {
  podcastsDeleted: number;
  audioFilesDeleted: number;
  coverImagesDeleted: number;
  errors: string[];
}

export class PodcastCleanupService {
  private extractFilenameFromUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    const parts = url.split('/');
    return parts[parts.length - 1] || null;
  }

  async deletePodcastWithCleanup(podcast: GeneratedPodcast): Promise<{ audioDeleted: boolean; coverDeleted: boolean }> {
    let audioDeleted = false;
    let coverDeleted = false;

    try {
      if (podcast.audioUrl) {
        const audioFilename = this.extractFilenameFromUrl(podcast.audioUrl);
        if (audioFilename) {
          audioDeleted = await objectStorage.deleteAudioFile(audioFilename);
        }
      }
    } catch (error) {
      console.error(`[Cleanup] Failed to delete audio for podcast ${podcast.id}:`, error);
    }

    try {
      if (podcast.coverImageUrl) {
        const coverFilename = this.extractFilenameFromUrl(podcast.coverImageUrl);
        if (coverFilename) {
          coverDeleted = await objectStorage.deleteCoverImage(coverFilename);
        }
      }
    } catch (error) {
      console.error(`[Cleanup] Failed to delete cover for podcast ${podcast.id}:`, error);
    }

    await db
      .delete(generatedPodcasts)
      .where(eq(generatedPodcasts.id, podcast.id));

    console.log(`[Cleanup] Deleted podcast ${podcast.id} (audio: ${audioDeleted}, cover: ${coverDeleted})`);
    
    return { audioDeleted, coverDeleted };
  }

  async cleanupNewsPodcasts(maxAgeDays: number = 3): Promise<CleanupResult> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

    const result: CleanupResult = {
      podcastsDeleted: 0,
      audioFilesDeleted: 0,
      coverImagesDeleted: 0,
      errors: []
    };

    try {
      const oldNewsPodcasts = await db
        .select()
        .from(generatedPodcasts)
        .where(
          and(
            lt(generatedPodcasts.timestamp, cutoffDate),
            sql`${generatedPodcasts.templateCategory} IN ('daily_news', 'news')`
          )
        );

      console.log(`[Cleanup] Found ${oldNewsPodcasts.length} news podcasts older than ${maxAgeDays} days`);

      for (const podcast of oldNewsPodcasts) {
        try {
          const { audioDeleted, coverDeleted } = await this.deletePodcastWithCleanup(podcast);
          result.podcastsDeleted++;
          if (audioDeleted) result.audioFilesDeleted++;
          if (coverDeleted) result.coverImagesDeleted++;
        } catch (error: any) {
          result.errors.push(`Podcast ${podcast.id}: ${error.message}`);
        }
      }
    } catch (error: any) {
      result.errors.push(`Query failed: ${error.message}`);
    }

    return result;
  }

  async cleanupLowEngagementPodcasts(maxAgeDays: number = 7, minPlays: number = 2): Promise<CleanupResult> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

    const result: CleanupResult = {
      podcastsDeleted: 0,
      audioFilesDeleted: 0,
      coverImagesDeleted: 0,
      errors: []
    };

    try {
      const lowEngagementPodcasts = await db
        .select()
        .from(generatedPodcasts)
        .where(
          and(
            lt(generatedPodcasts.timestamp, cutoffDate),
            lt(generatedPodcasts.plays, minPlays)
          )
        );

      console.log(`[Cleanup] Found ${lowEngagementPodcasts.length} low-engagement podcasts (< ${minPlays} plays) older than ${maxAgeDays} days`);

      for (const podcast of lowEngagementPodcasts) {
        try {
          const { audioDeleted, coverDeleted } = await this.deletePodcastWithCleanup(podcast);
          result.podcastsDeleted++;
          if (audioDeleted) result.audioFilesDeleted++;
          if (coverDeleted) result.coverImagesDeleted++;
        } catch (error: any) {
          result.errors.push(`Podcast ${podcast.id}: ${error.message}`);
        }
      }
    } catch (error: any) {
      result.errors.push(`Query failed: ${error.message}`);
    }

    return result;
  }

  async runFullCleanup(): Promise<{ news: CleanupResult; lowEngagement: CleanupResult }> {
    console.log('[Cleanup] Starting scheduled storage cleanup...');
    
    const newsResult = await this.cleanupNewsPodcasts(3);
    const lowEngagementResult = await this.cleanupLowEngagementPodcasts(7, 2);

    console.log('[Cleanup] Cleanup completed:', {
      news: {
        deleted: newsResult.podcastsDeleted,
        errors: newsResult.errors.length
      },
      lowEngagement: {
        deleted: lowEngagementResult.podcastsDeleted,
        errors: lowEngagementResult.errors.length
      }
    });

    return { news: newsResult, lowEngagement: lowEngagementResult };
  }
}

export const podcastCleanupService = new PodcastCleanupService();
