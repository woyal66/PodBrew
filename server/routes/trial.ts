import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { db } from "../db";
import { generatedPodcasts, guestSessions } from "@shared/schema";
import { eq, and, lt, isNull } from "drizzle-orm";
import { generatePodcastLegacy } from "../podcast/simpleGenerator";
import { generateOrGetCoverArt } from "../services/CoverArtCache";
import { generatePodcastTitle } from "../openai";
import { voiceCatalogService } from "../services/VoiceCatalogService";
import { asyncHandler, ApiError } from "../utils/apiError";
import { logger } from "../utils/logger";

const trialRouter = Router();

const trialGenerateRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: "Too many trial requests. Please try again later or sign up for free!" },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

const trialStatusRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "Too many requests" },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

const trialMigrateRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: "Too many migrate requests" },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

const TRIAL_DURATION_MINUTES = 2;
const TRIAL_EXPIRY_HOURS = 24;

const trialGenerateSchema = z.object({
  topic: z.string().min(1, "Topic is required").max(5000, "Topic too long"),
  guestSessionToken: z.string().min(10, "Invalid session token"),
});

trialRouter.post("/generate", trialGenerateRateLimiter, asyncHandler(async (req, res) => {
  const { topic, guestSessionToken } = trialGenerateSchema.parse(req.body);
  
  logger.info(`[Trial] New trial generation request for topic: "${topic.substring(0, 50)}..."`);
  
  const existingSession = await db.select().from(guestSessions)
    .where(eq(guestSessions.sessionToken, guestSessionToken))
    .limit(1);
  
  if (existingSession.length > 0 && existingSession[0].trialUsed) {
    logger.info(`[Trial] Session ${guestSessionToken.substring(0, 8)}... already used trial`);
    return res.status(403).json({
      error: "Trial already used",
      message: "You've already created a trial podcast. Sign up for free to create more!",
      requiresSignup: true,
    });
  }
  
  const expiresAt = new Date(Date.now() + TRIAL_EXPIRY_HOURS * 60 * 60 * 1000);
  
  if (existingSession.length === 0) {
    await db.insert(guestSessions).values({
      sessionToken: guestSessionToken,
      trialUsed: false,
      expiresAt,
    });
  }
  
  try {
    const voices = await voiceCatalogService.getActiveVoices();
    const defaultVoice = voices.find((v: any) => v.displayName?.toLowerCase().includes('nova')) || voices[0];
    
    if (!defaultVoice) {
      throw new Error("No voices available for trial generation");
    }
    
    logger.info(`[Trial] Starting trial podcast generation with voice: ${defaultVoice.displayName}`);
    
    const podcastResult = await generatePodcastLegacy(
      `Create a short, engaging introduction about: ${topic}. Keep it conversational and interesting.`,
      TRIAL_DURATION_MINUTES,
      5,
      1,
      "conversational",
      "pastMonth",
      undefined,
      "balanced",
      "en",
      [defaultVoice],
      "custom",
      undefined,
      "premium",
      [defaultVoice.id]
    );
    
    const title = await generatePodcastTitle(topic, "custom");
    
    let coverImageUrl: string | undefined;
    try {
      coverImageUrl = await generateOrGetCoverArt(topic, "custom");
    } catch (error) {
      logger.warn("[Trial] Cover art generation failed, using default");
    }
    
    const [podcast] = await db.insert(generatedPodcasts).values({
      topic,
      title,
      audioUrl: podcastResult.audioUrl,
      coverImageUrl,
      duration: podcastResult.duration,
      templateCategory: "custom",
      citations: podcastResult.citations || [],
      voiceQuality: "premium",
      creditsCost: 0,
      isPublic: true,
      isTrial: true,
      guestSessionId: guestSessionToken,
      generationParams: {
        topic,
        durationMinutes: TRIAL_DURATION_MINUTES,
        languageComplexity: 5,
        numPeople: 1,
        podcastStyle: "conversational",
      },
    }).returning();
    
    await db.update(guestSessions)
      .set({
        trialUsed: true,
        trialPodcastId: podcast.id,
      })
      .where(eq(guestSessions.sessionToken, guestSessionToken));
    
    logger.info(`[Trial] Successfully created trial podcast: ${podcast.id}`);
    
    res.json({
      success: true,
      podcast,
      message: "Your trial podcast is ready! Sign up for free to keep it and create more.",
      expiresAt: expiresAt.toISOString(),
    });
    
  } catch (error: any) {
    logger.error(`[Trial] Generation failed: ${error.message}`);
    throw new ApiError(500, "Trial generation failed", error.message);
  }
}));

trialRouter.get("/status", trialStatusRateLimiter, asyncHandler(async (req, res) => {
  const token = req.query.guestSessionToken || req.query.token;
  
  if (!token || typeof token !== "string") {
    return res.json({ hasUsedTrial: false, trialPodcastId: null, expiresAt: null, hoursRemaining: null });
  }
  
  const session = await db.select().from(guestSessions)
    .where(eq(guestSessions.sessionToken, token))
    .limit(1);
  
  if (session.length === 0) {
    return res.json({ hasUsedTrial: false, trialPodcastId: null, expiresAt: null, hoursRemaining: null });
  }
  
  const guestSession = session[0];
  
  if (!guestSession.trialUsed) {
    return res.json({ hasUsedTrial: false, trialPodcastId: null, expiresAt: null, hoursRemaining: null });
  }
  
  const expiresAt = guestSession.expiresAt;
  let hoursRemaining: number | null = null;
  
  if (expiresAt) {
    const msRemaining = expiresAt.getTime() - Date.now();
    hoursRemaining = Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60)));
  }
  
  return res.json({
    hasUsedTrial: true,
    trialPodcastId: guestSession.trialPodcastId,
    expiresAt: expiresAt?.toISOString() || null,
    hoursRemaining,
  });
}));

trialRouter.post("/migrate", trialMigrateRateLimiter, asyncHandler(async (req, res) => {
  const { guestSessionToken } = req.body;
  const user = (req as any).user;
  
  if (!user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  
  if (!guestSessionToken) {
    return res.status(400).json({ error: "Guest session token required" });
  }
  
  const session = await db.select().from(guestSessions)
    .where(eq(guestSessions.sessionToken, guestSessionToken))
    .limit(1);
  
  if (session.length === 0 || !session[0].trialPodcastId) {
    return res.json({ migrated: false, message: "No trial podcast to migrate" });
  }
  
  const guestSession = session[0];
  const trialPodcastId = guestSession.trialPodcastId!;
  
  await db.update(generatedPodcasts)
    .set({
      userId: user.id,
      isTrial: false,
      guestSessionId: null,
    })
    .where(eq(generatedPodcasts.id, trialPodcastId));
  
  await db.update(guestSessions)
    .set({ convertedToUserId: user.id })
    .where(eq(guestSessions.sessionToken, guestSessionToken));
  
  logger.info(`[Trial] Migrated trial podcast ${guestSession.trialPodcastId} to user ${user.id}`);
  
  res.json({
    migrated: true,
    podcastId: guestSession.trialPodcastId,
    message: "Your trial podcast has been saved to your library!",
  });
}));

export async function cleanupExpiredTrialPodcasts(): Promise<{ deleted: number }> {
  const now = new Date();
  
  const expiredSessions = await db.select()
    .from(guestSessions)
    .where(
      and(
        lt(guestSessions.expiresAt, now),
        isNull(guestSessions.convertedToUserId)
      )
    );
  
  let deletedCount = 0;
  
  for (const session of expiredSessions) {
    if (session.trialPodcastId) {
      try {
        await db.delete(generatedPodcasts)
          .where(eq(generatedPodcasts.id, session.trialPodcastId));
        deletedCount++;
        logger.info(`[TrialCleanup] Deleted expired trial podcast: ${session.trialPodcastId}`);
      } catch (error) {
        logger.warn(`[TrialCleanup] Failed to delete podcast ${session.trialPodcastId}`);
      }
    }
    
    await db.delete(guestSessions)
      .where(eq(guestSessions.id, session.id));
  }
  
  if (deletedCount > 0) {
    logger.info(`[TrialCleanup] Cleaned up ${deletedCount} expired trial podcasts`);
  }
  
  return { deleted: deletedCount };
}

export { trialRouter };
