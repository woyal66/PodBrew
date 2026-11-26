import { db } from "./db";
import { users, type User, VOICE_QUALITY_TIERS, type Voice, type VoiceQuality } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { withTransaction } from "./db/transactions";
import { logger } from "./utils/logger";

export class InsufficientCreditsError extends Error {
  public currentCredits: number;
  
  constructor(required: number, available: number) {
    super(`Insufficient credits: requires ${required}, have ${available}`);
    this.name = "InsufficientCreditsError";
    this.currentCredits = available;
  }
}

// With Replit Auth, all users must be authenticated (no anonymous users)
export async function checkAndDeductCreditsAtomic(userId: string, creditsToDeduct: number): Promise<User> {
  return withTransaction(async (tx) => {
    // Get user and reset credits if monthly reset is due
    const users_result = await tx
      .select()
      .from(users)
      .where(eq(users.id, userId));
    
    if (users_result.length === 0) {
      logger.error('User not found during credit deduction', { userId });
      throw new Error("User not found");
    }
    
    const user = users_result[0];
    
    // Check if monthly reset is due for free users
    const now = new Date();
    const lastUpdate = new Date(user.updatedAt);
    const daysSinceUpdate = (now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24);

    if (daysSinceUpdate > 30 && user.subscriptionPlan === 'free') {
      // Reset credits for free users after 30 days
      logger.info('Resetting monthly credits for free user', { userId });
      await tx
        .update(users)
        .set({
          credits: 2,
          updatedAt: now,
        })
        .where(eq(users.id, userId));
    }

    // Atomic credit deduction with optimistic locking
    const result = await tx
      .update(users)
      .set({
        credits: sql`${users.credits} - ${creditsToDeduct}`,
        updatedAt: new Date(),
      })
      .where(
        sql`${users.id} = ${userId} AND ${users.credits} >= ${creditsToDeduct}`
      )
      .returning();

    if (!result || result.length === 0) {
      const currentUsers = await tx
        .select()
        .from(users)
        .where(eq(users.id, userId));
      
      const currentCredits = currentUsers[0]?.credits ?? 0;
      logger.warn('Insufficient credits for operation', { 
        userId, 
        required: creditsToDeduct, 
        available: currentCredits 
      });
      throw new InsufficientCreditsError(creditsToDeduct, currentCredits);
    }

    logger.debug('Credits deducted successfully', { 
      userId, 
      amount: creditsToDeduct, 
      remaining: result[0].credits 
    });

    return result[0];
  });
}

async function resetIfExpired(user: User, tx: any = db): Promise<void> {
  const now = new Date();
  const lastUpdate = new Date(user.updatedAt);
  const daysSinceUpdate = (now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24);

  if (daysSinceUpdate > 30 && user.subscriptionPlan === 'free') {
    // Reset credits for free users after 30 days
    logger.info('Resetting monthly credits for free user', { userId: user.id });
    await tx
      .update(users)
      .set({
        credits: 2,
        updatedAt: now,
      })
      .where(eq(users.id, user.id));
  }
}

export async function refundCredits(userId: string, creditsToRefund: number): Promise<User> {
  return withTransaction(async (tx) => {
    const [updatedUser] = await tx
      .update(users)
      .set({
        credits: sql`${users.credits} + ${creditsToRefund}`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();

    logger.info('Credits refunded', { userId, amount: creditsToRefund });
    return updatedUser;
  });
}

export async function getUserCredits(userId: string): Promise<{ credits: number; plan: string }> {
  return withTransaction(async (tx) => {
    const users_result = await tx
      .select()
      .from(users)
      .where(eq(users.id, userId));
    
    if (users_result.length === 0) {
      logger.error('User not found when fetching credits', { userId });
      throw new Error("User not found");
    }
    
    const user = users_result[0];
    await resetIfExpired(user, tx);

    const updatedUsers = await tx
      .select()
      .from(users)
      .where(eq(users.id, userId));

    const currentUser = updatedUsers[0];
    
    return {
      credits: currentUser.credits,
      plan: currentUser.subscriptionPlan || 'free',
    };
  });
}

export interface VoicePricingSummary {
  tier: VoiceQuality;
  creditsPerMinute: number;
  totalCredits: number;
  voiceCount: number;
}

export function getVoicePricing(voices: Voice[], durationMinutes: number): VoicePricingSummary {
  // All voices use Gemini 2.5 Flash TTS (Premium tier only)
  const defaultTier = 'premium' as const;
  const defaultCreditsPerMinute = VOICE_QUALITY_TIERS[defaultTier].creditsPerMinute;
  
  if (!voices || voices.length === 0) {
    return {
      tier: defaultTier,
      creditsPerMinute: defaultCreditsPerMinute,
      totalCredits: defaultCreditsPerMinute * durationMinutes,
      voiceCount: 0,
    };
  }

  // All voices are premium tier
  return {
    tier: defaultTier,
    creditsPerMinute: defaultCreditsPerMinute,
    totalCredits: defaultCreditsPerMinute * durationMinutes,
    voiceCount: voices.length,
  };
}
