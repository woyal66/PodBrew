import { type Request, type Response, type NextFunction } from "express";
import { db } from "../db";
import { users, voices, type VoiceQuality } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { DEFAULT_TIER_RESTRICTIONS, type TierRestrictions } from "@shared/schema";
import { getVoicePricing, type VoicePricingSummary } from "../creditManager";
import { z } from "zod";

export interface TierRestrictedRequest extends Request {
  userTierRestrictions?: TierRestrictions;
  voicePricingSummary?: VoicePricingSummary;
}

export async function enforceTierRestrictions(
  req: TierRestrictedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const userId = (req as any).userId || (req as any).user?.id;
    const { durationMinutes, selectedVoiceIds, voiceQuality } = req.body;
    
    let userPlan: keyof typeof DEFAULT_TIER_RESTRICTIONS = 'free';
    
    if (userId) {
      const user = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      
      if (user.length > 0) {
        userPlan = (user[0].subscriptionPlan || 'free') as keyof typeof DEFAULT_TIER_RESTRICTIONS;
      }
    }
    
    const tierRestrictions: TierRestrictions = 
      DEFAULT_TIER_RESTRICTIONS[userPlan] || 
      DEFAULT_TIER_RESTRICTIONS.free;
    
    req.userTierRestrictions = tierRestrictions;
    
    if (durationMinutes > tierRestrictions.maxDurationMinutes) {
      return res.status(403).json({
        error: "Duration limit exceeded",
        tierLimitExceeded: true,
        maxDuration: tierRestrictions.maxDurationMinutes,
        requestedDuration: durationMinutes,
        currentPlan: userPlan,
        message: `Maximum podcast duration is ${tierRestrictions.maxDurationMinutes} minutes.`,
        suggestedPlans: getSuggestedPlans(durationMinutes),
      });
    }
    
    // Host/numPeople limit validation
    const numPeople = req.body.numPeople;
    if (numPeople && numPeople > tierRestrictions.maxHosts) {
      return res.status(403).json({
        error: "Host limit exceeded",
        tierLimitExceeded: true,
        maxHosts: tierRestrictions.maxHosts,
        requestedHosts: numPeople,
        currentPlan: userPlan,
        message: `Maximum number of hosts per podcast is ${tierRestrictions.maxHosts}.`,
        suggestedPlans: getSuggestedPlansForHosts(numPeople),
      });
    }
    
    // Voice tier validation (voice-tier-driven pricing)
    if (selectedVoiceIds && Array.isArray(selectedVoiceIds) && selectedVoiceIds.length > 0) {
      // Validate voice IDs are strings
      const voiceIdsSchema = z.array(z.string());
      const validationResult = voiceIdsSchema.safeParse(selectedVoiceIds);
      
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid voice IDs",
          message: "Voice IDs must be an array of strings"
        });
      }
      
      // Load selected voices from database
      const selectedVoices = await db
        .select()
        .from(voices)
        .where(inArray(voices.id, selectedVoiceIds));
      
      if (selectedVoices.length !== selectedVoiceIds.length) {
        return res.status(400).json({
          error: "Invalid voices",
          message: "One or more selected voices not found"
        });
      }
      
      // Calculate pricing summary and check tier restrictions
      const pricingSummary = getVoicePricing(selectedVoices, durationMinutes);
      req.voicePricingSummary = pricingSummary;
      
      if (!tierRestrictions.allowedVoiceTiers.includes(pricingSummary.tier)) {
        // Find first voice with disallowed tier for error message
        const violatingVoice = selectedVoices.find(v => v.tier === pricingSummary.tier);
        
        return res.status(403).json({
          error: "Voice tier not allowed",
          tierLimitExceeded: true,
          allowedTiers: tierRestrictions.allowedVoiceTiers,
          requestedTier: pricingSummary.tier,
          violatingVoice: violatingVoice?.displayName,
          currentPlan: userPlan,
          message: `Voice tier '${pricingSummary.tier}' is not available on the current plan.`,
          suggestedPlans: getSuggestedPlansForVoiceTier(pricingSummary.tier),
        });
      }
    } else if (voiceQuality) {
      // Legacy support: handle old requests with voiceQuality parameter
      console.warn('[TierRestrictions] voiceQuality parameter is deprecated, use selectedVoiceIds instead');
      
      if (!tierRestrictions.allowedVoiceTiers.includes(voiceQuality as VoiceQuality)) {
        return res.status(403).json({
          error: "Voice tier not allowed",
          tierLimitExceeded: true,
          allowedTiers: tierRestrictions.allowedVoiceTiers,
          requestedTier: voiceQuality,
          currentPlan: userPlan,
          message: `Voice tier '${voiceQuality}' isn't available on your ${userPlan} plan.`,
          suggestedPlans: getSuggestedPlansForVoiceTier(voiceQuality as VoiceQuality),
        });
      }
    }
    
    next();
  } catch (error) {
    console.error("Tier restriction error:", error);
    return res.status(500).json({ error: "Failed to validate tier restrictions" });
  }
}

function getSuggestedPlans(durationMinutes: number): string[] {
  if (durationMinutes <= 5) return ['starter', 'creator', 'studio', 'professional'];
  if (durationMinutes <= 60) return ['starter', 'creator', 'studio', 'professional'];
  return [];
}

function getSuggestedPlansForVoiceTier(tier: VoiceQuality): string[] {
  switch (tier) {
    case 'premium':
      return ['starter', 'creator', 'studio', 'professional'];
    case 'ultra':
      return ['starter', 'studio', 'professional'];
    case 'cinematic':
      return ['professional'];
    case 'standard':
    default:
      return [];
  }
}

function getSuggestedPlansForHosts(numHosts: number): string[] {
  // Host limits: Starter = 2, Free/Creator/Studio = 3, Pro = 4, Professional/Enterprise = 5
  if (numHosts <= 2) return [];
  if (numHosts === 3) return ['creator', 'studio', 'pro', 'professional'];
  if (numHosts === 4) return ['pro', 'professional'];
  if (numHosts >= 5) return ['professional'];
  return [];
}
