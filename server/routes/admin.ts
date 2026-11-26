import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { db } from '../db';
import { voices, prosodyPresets, users, generatedPodcasts, comments, podcastLikes } from '@shared/schema';
import { getAllCuratedVoices } from '../utils/curatedVoices';
import { getProsodyPresetSeeds } from '../utils/prosodyTemplates';
import { voicePreviewService } from '../services/VoicePreviewService';
import { eq, desc, and, ne, sql, or, isNull } from 'drizzle-orm';
import Stripe from 'stripe';

export const adminRouter = Router();

/**
 * Simple session storage for admin authentication
 * In production, use Redis or similar
 */
const adminSessions = new Map<string, { expiresAt: number }>();

/**
 * Login endpoint - exchanges password for session token
 * POST /api/admin/login
 * Body: { password: string }
 */
adminRouter.post('/login', (req: Request, res: Response) => {
  const { password } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    return res.status(503).json({
      success: false,
      error: 'Admin system not configured',
      message: 'ADMIN_PASSWORD environment variable must be set',
    });
  }

  if (!password || password !== adminPassword) {
    console.warn('⚠️  Failed admin login attempt');
    return res.status(401).json({
      success: false,
      error: 'Invalid password',
    });
  }

  // Generate session token
  const sessionToken = Math.random().toString(36).substring(2) + Date.now().toString(36);
  const expiresAt = Date.now() + (60 * 60 * 1000); // 1 hour

  adminSessions.set(sessionToken, { expiresAt });

  console.log('✅ Admin login successful');
  
  res.json({
    success: true,
    sessionToken,
    expiresAt,
  });
});

/**
 * Middleware to protect admin endpoints
 * Requires valid session token from login
 */
function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Session token required',
    });
  }

  const session = adminSessions.get(token);

  if (!session) {
    return res.status(401).json({
      success: false,
      error: 'Invalid session',
      message: 'Session token not found',
    });
  }

  if (Date.now() > session.expiresAt) {
    adminSessions.delete(token);
    return res.status(401).json({
      success: false,
      error: 'Session expired',
      message: 'Please login again',
    });
  }

  // Refresh session expiry on each use
  session.expiresAt = Date.now() + (60 * 60 * 1000);

  next();
}

// Apply auth middleware to all routes EXCEPT /login
adminRouter.use((req, res, next) => {
  if (req.path === '/login') {
    return next();
  }
  requireAdminAuth(req, res, next);
});

/**
 * POST /api/admin/seed-voices
 * Seeds the production database with curated voice catalog
 * Returns summary of added/skipped voices
 */
adminRouter.post('/seed-voices', async (req: Request, res: Response) => {
  try {
    console.log('🎙️  [ADMIN] Seeding curated voice catalog...\n');

    const curatedVoices = getAllCuratedVoices();
    let added = 0;
    let skipped = 0;

    for (const voice of curatedVoices) {
      // Check if voice already exists
      const existing = await db
        .select()
        .from(voices)
        .where(eq(voices.googleVoiceName, voice.googleVoiceName));

      if (existing.length > 0) {
        console.log(`⏭️  Skipping "${voice.displayName}" (already exists)`);
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
        });
        console.log(`✅ Added "${voice.aliasName}" aka "${voice.displayName}" (${voice.accent} ${voice.gender} - ${voice.tier})`);
        added++;
      }
    }

    // Get final stats
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

    console.log(`\n🎉 Voice catalog seeding complete!`);
    console.log(`📊 Summary: ✅ Added ${added} voices, ⏭️ Skipped ${skipped} voices\n`);

    res.json({
      success: true,
      message: 'Voice catalog seeded successfully',
      stats: {
        added,
        skipped,
        total: allVoices.length,
        byCategory,
        byTier,
      },
    });
  } catch (error) {
    console.error('❌ Error seeding voices:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to seed voice catalog',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/admin/seed-prosody
 * Seeds the production database with prosody presets (emotion-driven prosody)
 * Returns summary of added/skipped presets
 */
adminRouter.post('/seed-prosody', async (req: Request, res: Response) => {
  try {
    console.log('🎭 [ADMIN] Seeding prosody presets...\n');

    const seeds = getProsodyPresetSeeds();
    let added = 0;
    let skipped = 0;

    for (const seed of seeds) {
      const existing = await db
        .select()
        .from(prosodyPresets)
        .where(eq(prosodyPresets.name, seed.name));

      if (existing.length > 0) {
        console.log(`⏭️  Skipping "${seed.displayName}" (already exists)`);
        skipped++;
      } else {
        await db.insert(prosodyPresets).values(seed);
        console.log(`✅ Added "${seed.displayName}" preset`);
        added++;
      }
    }

    const allPresets = await db.select().from(prosodyPresets);

    console.log(`\n🎉 Prosody preset seeding complete!`);
    console.log(`📊 Summary: ✅ Added ${added} presets, ⏭️ Skipped ${skipped} presets\n`);

    res.json({
      success: true,
      message: 'Prosody presets seeded successfully',
      stats: {
        added,
        skipped,
        total: allPresets.length,
      },
    });
  } catch (error) {
    console.error('❌ Error seeding prosody presets:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to seed prosody presets',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/admin/bootstrap-voice-previews
 * Generates all voice previews ONCE and stores permanently in object storage
 * One-time setup only - uses ~30 quota requests, then zero ongoing quota
 * Subsequent loads served from object storage with zero quota cost
 */
adminRouter.post('/bootstrap-voice-previews', async (req: Request, res: Response) => {
  try {
    console.log('\n🎙️  [ADMIN] Bootstrapping voice previews (permanent storage)...\n');

    // Get all active voices from database
    const allVoices = await db.select().from(voices).where(eq(voices.isActive, true));
    const activeVoices = allVoices;
    
    console.log(`[Bootstrap] Found ${activeVoices.length} active voices`);

    // Count existing previews
    const voicesWithPreview = activeVoices.filter(v => v.previewUrl).length;
    const voicesNeedingPreview = activeVoices.filter(v => !v.previewUrl).length;
    
    console.log(`[Bootstrap] Status: ${voicesWithPreview}/${activeVoices.length} already have previews`);
    console.log(`[Bootstrap] Generating ${voicesNeedingPreview} missing previews...\n`);

    if (voicesNeedingPreview === 0) {
      console.log('[Bootstrap] All voice previews already generated!');
      return res.json({
        success: true,
        message: 'All voice previews already bootstrapped',
        stats: {
          total: activeVoices.length,
          generated: 0,
          quotaUsed: 0,
          skipped: activeVoices.length,
        },
      });
    }

    // Generate previews sequentially, with delays to respect rate limits
    let generatedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    const voicesNeedingPreviewList = activeVoices.filter(v => !v.previewUrl);

    for (let i = 0; i < voicesNeedingPreviewList.length; i++) {
      const voice = voicesNeedingPreviewList[i];
      try {
        console.log(`\n[${i+1}/${voicesNeedingPreviewList.length}] Generating preview for: ${voice.aliasName}`);
        
        // Generate preview via service (which checks object storage, generates if needed)
        const previewUrl = await voicePreviewService.generatePreview(voice.id);
        
        console.log(`✅ [${i+1}/${voicesNeedingPreviewList.length}] Complete: ${voice.aliasName}`);
        generatedCount++;
        
        // Respect rate limits - add delay between generations
        if (i < voicesNeedingPreviewList.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`❌ [${i+1}/${voicesNeedingPreviewList.length}] Failed for ${voice.aliasName}:`, error instanceof Error ? error.message : error);
        failedCount++;
      }
    }

    console.log(`\n🎉 Voice preview bootstrap complete!`);
    console.log(`📊 Summary:`);
    console.log(`   ✅ Generated: ${generatedCount} previews`);
    console.log(`   ❌ Failed: ${failedCount} previews`);
    console.log(`   ⏭️  Already cached: ${voicesWithPreview} previews`);
    console.log(`   📦 Storage: Object Storage (permanent, zero ongoing quota)`);
    console.log(`   💰 Quota cost: ~${generatedCount} requests (one-time)\n`);

    res.json({
      success: true,
      message: 'Voice preview bootstrap complete',
      stats: {
        total: activeVoices.length,
        generated: generatedCount,
        failed: failedCount,
        skipped: voicesWithPreview,
        quotaUsed: generatedCount,
        note: 'Subsequent voice loads will use object storage (zero quota)',
      },
    });
  } catch (error) {
    console.error('❌ Error bootstrapping voice previews:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to bootstrap voice previews',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/admin/subscribers
 * Returns a list of all users with their subscription details
 * Requires admin authentication
 */
adminRouter.get('/subscribers', async (req: Request, res: Response) => {
  try {
    console.log('📊 [ADMIN] Fetching subscriber list...');

    // Fetch all users with subscription details
    const allUsers = await db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        subscriptionPlan: users.subscriptionPlan,
        subscriptionStatus: users.subscriptionStatus,
        credits: users.credits,
        stripeCustomerId: users.stripeCustomerId,
        stripeSubscriptionId: users.stripeSubscriptionId,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt));

    // Calculate summary stats
    const stats = {
      total: allUsers.length,
      byPlan: {
        free: allUsers.filter(u => u.subscriptionPlan === 'free').length,
        creator: allUsers.filter(u => u.subscriptionPlan === 'creator').length,
        studio: allUsers.filter(u => u.subscriptionPlan === 'studio').length,
        pro: allUsers.filter(u => u.subscriptionPlan === 'pro').length,
        professional: allUsers.filter(u => u.subscriptionPlan === 'professional').length,
        enterprise: allUsers.filter(u => u.subscriptionPlan === 'enterprise').length,
      },
      activeSubscriptions: allUsers.filter(u => u.subscriptionStatus === 'active').length,
      totalCredits: allUsers.reduce((sum, u) => sum + (u.credits || 0), 0),
    };

    console.log(`✅ Fetched ${allUsers.length} subscribers`);

    res.json({
      success: true,
      subscribers: allUsers,
      stats,
    });
  } catch (error) {
    console.error('❌ Error fetching subscribers:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch subscribers',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/admin/seed-all
 * Seeds both voices and prosody presets in one go
 * Returns combined summary
 */
adminRouter.post('/seed-all', async (req: Request, res: Response) => {
  try {
    console.log('🚀 [ADMIN] Seeding all database content...\n');

    // Seed voices first
    const curatedVoices = getAllCuratedVoices();
    let voicesAdded = 0;
    let voicesSkipped = 0;

    for (const voice of curatedVoices) {
      const existing = await db
        .select()
        .from(voices)
        .where(eq(voices.googleVoiceName, voice.googleVoiceName));

      if (existing.length > 0) {
        voicesSkipped++;
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
        });
        voicesAdded++;
      }
    }

    // Seed prosody presets
    const seeds = getProsodyPresetSeeds();
    let presetsAdded = 0;
    let presetsSkipped = 0;

    for (const seed of seeds) {
      const existing = await db
        .select()
        .from(prosodyPresets)
        .where(eq(prosodyPresets.name, seed.name));

      if (existing.length > 0) {
        presetsSkipped++;
      } else {
        await db.insert(prosodyPresets).values(seed);
        presetsAdded++;
      }
    }

    const allVoices = await db.select().from(voices);
    const allPresets = await db.select().from(prosodyPresets);

    console.log(`\n🎉 All database seeding complete!`);
    console.log(`📊 Voices: ✅ ${voicesAdded} added, ⏭️ ${voicesSkipped} skipped`);
    console.log(`📊 Prosody: ✅ ${presetsAdded} added, ⏭️ ${presetsSkipped} skipped\n`);

    res.json({
      success: true,
      message: 'All database content seeded successfully',
      stats: {
        voices: {
          added: voicesAdded,
          skipped: voicesSkipped,
          total: allVoices.length,
        },
        prosody: {
          added: presetsAdded,
          skipped: presetsSkipped,
          total: allPresets.length,
        },
      },
    });
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to seed database',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Delete user account (admin only)
 * DELETE /api/admin/delete-user/:userId
 * Safely deletes a user account with proper Stripe subscription cleanup
 */
adminRouter.delete('/delete-user/:userId', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required',
      });
    }

    // Check if user exists
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId.trim()))
      .limit(1);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: `User not found with ID: ${userId.trim()}`,
      });
    }

    // Initialize Stripe client if secret key is available
    const stripe = process.env.STRIPE_SECRET_KEY 
      ? new Stripe(process.env.STRIPE_SECRET_KEY, {
          apiVersion: "2025-11-17.clover",
        })
      : null;

    // CRITICAL: If user has active Stripe subscription but Stripe is not configured, FAIL
    if (user.stripeSubscriptionId && !stripe) {
      console.error(`❌ Cannot delete user ${user.email || userId.trim()}: has active Stripe subscription but STRIPE_SECRET_KEY is not configured`);
      return res.status(500).json({
        success: false,
        error: 'Cannot delete user with active subscription',
        details: 'Stripe is not configured. Set STRIPE_SECRET_KEY environment variable to cancel subscriptions.',
      });
    }

    // Cancel active Stripe subscription if exists
    if (stripe && user.stripeSubscriptionId) {
      try {
        console.log(`🔄 Canceling Stripe subscription ${user.stripeSubscriptionId} for user ${user.email || userId.trim()}...`);
        
        // Cancel the subscription immediately
        const canceledSubscription = await stripe.subscriptions.cancel(user.stripeSubscriptionId);
        
        // CRITICAL: Verify subscription is actually canceled (not just scheduled for future cancellation)
        if (canceledSubscription.status !== 'canceled') {
          console.error(`❌ Subscription cancellation failed: status is '${canceledSubscription.status}' instead of 'canceled'`);
          return res.status(500).json({
            success: false,
            error: 'Cannot delete user: subscription cancellation not confirmed',
            details: `Subscription status is '${canceledSubscription.status}' - please manually cancel in Stripe dashboard`,
            recommendation: 'The subscription may be scheduled for future cancellation. Cancel it immediately in Stripe before deleting this user.',
          });
        }
        
        console.log(`✅ Stripe subscription canceled successfully (status: ${canceledSubscription.status})`);
      } catch (stripeError: any) {
        console.error(`❌ Error canceling Stripe subscription:`, stripeError);
        
        // CRITICAL: Only proceed if subscription genuinely doesn't exist (404/resource_missing)
        // For ALL other errors (network issues, rate limits, timeouts, etc.), FAIL deletion
        const isSubscriptionNotFound = 
          stripeError?.statusCode === 404 || 
          stripeError?.code === 'resource_missing' ||
          (stripeError instanceof Error && stripeError.message.includes('No such subscription'));
        
        if (!isSubscriptionNotFound) {
          // Subscription might still be active - BLOCK deletion to prevent orphaned billing
          console.error(`❌ BLOCKED deletion: cannot confirm Stripe subscription cancellation`);
          return res.status(500).json({
            success: false,
            error: 'Cannot delete user: failed to cancel Stripe subscription',
            details: stripeError instanceof Error ? stripeError.message : 'Stripe API error',
            recommendation: 'Please manually cancel the subscription in Stripe dashboard before deleting this user',
          });
        }
        
        // Subscription doesn't exist in Stripe - safe to proceed (orphaned reference)
        console.log(`ℹ️  Subscription not found in Stripe (orphaned reference) - proceeding with deletion`);
      }
    }

    // Delete the user account from database
    await db.delete(users).where(eq(users.id, userId.trim()));

    console.log(`✅ Admin deleted user account: ${user.email || userId.trim()}`);

    res.json({
      success: true,
      message: `User account deleted successfully${user.stripeSubscriptionId ? ' (Stripe subscription canceled)' : ''}`,
      deletedUser: {
        id: user.id,
        email: user.email,
        hadActiveSubscription: !!user.stripeSubscriptionId,
      },
    });
  } catch (error) {
    console.error('❌ Error deleting user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete user account',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Fix user subscription (admin emergency fix)
 * POST /api/admin/fix-subscription
 * Body: { email: string, plan: 'creator' | 'studio' | 'pro' | 'professional' }
 */
adminRouter.post('/fix-subscription', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { email, plan } = req.body;

    // Validate input
    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Valid email address is required',
      });
    }

    if (!plan || typeof plan !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Plan is required',
      });
    }

    const validPlans = ['creator', 'studio', 'pro', 'professional'];
    if (!validPlans.includes(plan)) {
      return res.status(400).json({
        success: false,
        error: `Invalid plan. Must be one of: ${validPlans.join(', ')}`,
      });
    }

    // Find user by email
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email.trim()))
      .limit(1);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: `User not found with email: ${email.trim()}`,
      });
    }

    // Plan configuration (must match SUBSCRIPTION_PLANS in routes.ts)
    const planConfig: Record<string, { credits: number }> = {
      creator: { credits: 30 },
      studio: { credits: 100 },
      pro: { credits: 180 },
      professional: { credits: 300 },
    };

    const config = planConfig[plan];

    // Update subscription atomically with all required fields
    const [updatedUser] = await db
      .update(users)
      .set({
        subscriptionPlan: plan,
        subscriptionStatus: 'active',
        credits: config.credits,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning();

    if (!updatedUser) {
      return res.status(500).json({
        success: false,
        error: 'Failed to update user subscription',
      });
    }

    console.log(`✅ Admin fixed subscription for ${email.trim()}: ${plan} (${config.credits} credits)`);

    res.json({
      success: true,
      message: `Subscription updated successfully`,
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        plan: updatedUser.subscriptionPlan,
        credits: updatedUser.credits,
        status: updatedUser.subscriptionStatus,
      },
    });
  } catch (error) {
    console.error('❌ Error fixing subscription:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fix subscription',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/admin/podcast-visibility
 * Check podcast visibility statistics - how many are public vs private
 */
adminRouter.get('/podcast-visibility', async (req: Request, res: Response) => {
  try {
    console.log('📊 [ADMIN] Checking podcast visibility statistics...');

    // Get counts by visibility and template category
    const stats = await db.execute(sql`
      SELECT 
        template_category,
        is_public,
        COUNT(*) as count
      FROM generated_podcasts
      GROUP BY template_category, is_public
      ORDER BY template_category, is_public
    `);

    // Get total counts
    const totalPublic = await db
      .select({ count: sql<number>`count(*)` })
      .from(generatedPodcasts)
      .where(eq(generatedPodcasts.isPublic, true));

    const totalPrivate = await db
      .select({ count: sql<number>`count(*)` })
      .from(generatedPodcasts)
      .where(eq(generatedPodcasts.isPublic, false));

    // Get podcasts that SHOULD be public but aren't (non-medical, non-documents with isPublic=false)
    const shouldBePublic = await db
      .select({ count: sql<number>`count(*)` })
      .from(generatedPodcasts)
      .where(
        and(
          eq(generatedPodcasts.isPublic, false),
          ne(generatedPodcasts.templateCategory, 'medical'),
          ne(generatedPodcasts.templateCategory, 'documents')
        )
      );

    res.json({
      success: true,
      stats: {
        totalPublic: Number(totalPublic[0]?.count || 0),
        totalPrivate: Number(totalPrivate[0]?.count || 0),
        shouldBePublic: Number(shouldBePublic[0]?.count || 0),
        byCategory: stats.rows,
      },
    });
  } catch (error) {
    console.error('❌ Error checking podcast visibility:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check podcast visibility',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/admin/fix-podcast-visibility
 * Fix podcast visibility - make all non-medical, non-documents podcasts public
 */
adminRouter.post('/fix-podcast-visibility', async (req: Request, res: Response) => {
  try {
    console.log('🔧 [ADMIN] Fixing podcast visibility...');

    // Update all podcasts that should be public (non-medical, non-documents)
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
    console.log(`✅ [ADMIN] Updated ${updatedCount} podcasts to public`);

    res.json({
      success: true,
      message: `Updated ${updatedCount} podcasts to public visibility`,
      updatedCount,
    });
  } catch (error) {
    console.error('❌ Error fixing podcast visibility:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fix podcast visibility',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/admin/usage-stats
 * Returns usage and growth metrics for the admin dashboard
 */
adminRouter.get('/usage-stats', async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // All basic counts in parallel
    const [
      totalPodcastsResult,
      todayResult,
      weekResult,
      monthResult,
      uniqueGuestResult,
      totalPlaysResult,
      totalUsersResult,
      templateResult,
      dailyResult,
      topGuestResult,
      topUserResult,
      totalCommentsResult,
      totalReactionsResult,
    ] = await Promise.all([
      // Total podcasts
      db.select({ count: sql<number>`COUNT(*)::int` }).from(generatedPodcasts),
      // Today
      db.select({ count: sql<number>`COUNT(*)::int` }).from(generatedPodcasts)
        .where(sql`${generatedPodcasts.timestamp} >= ${todayStart}`),
      // This week
      db.select({ count: sql<number>`COUNT(*)::int` }).from(generatedPodcasts)
        .where(sql`${generatedPodcasts.timestamp} >= ${weekStart}`),
      // This month
      db.select({ count: sql<number>`COUNT(*)::int` }).from(generatedPodcasts)
        .where(sql`${generatedPodcasts.timestamp} >= ${monthStart}`),
      // Unique guest sessions (anonymous users who created podcasts)
      db.select({ count: sql<number>`COUNT(DISTINCT ${generatedPodcasts.guestSessionId})::int` })
        .from(generatedPodcasts)
        .where(sql`${generatedPodcasts.guestSessionId} IS NOT NULL`),
      // Total plays
      db.select({ total: sql<number>`COALESCE(SUM(${generatedPodcasts.plays}), 0)::int` }).from(generatedPodcasts),
      // Registered users
      db.select({ count: sql<number>`COUNT(*)::int` }).from(users),
      // By template category
      db.select({
        template: generatedPodcasts.templateCategory,
        count: sql<number>`COUNT(*)::int`,
      }).from(generatedPodcasts)
        .groupBy(generatedPodcasts.templateCategory)
        .orderBy(desc(sql`COUNT(*)`)),
      // Daily creation last 30 days
      db.select({
        date: sql<string>`DATE(${generatedPodcasts.timestamp})::text`,
        total: sql<number>`COUNT(*)::int`,
        guests: sql<number>`COUNT(DISTINCT CASE WHEN ${generatedPodcasts.guestSessionId} IS NOT NULL THEN ${generatedPodcasts.guestSessionId} END)::int`,
        registered: sql<number>`COUNT(CASE WHEN ${generatedPodcasts.userId} IS NOT NULL THEN 1 END)::int`,
      }).from(generatedPodcasts)
        .where(sql`${generatedPodcasts.timestamp} >= ${thirtyDaysAgo}`)
        .groupBy(sql`DATE(${generatedPodcasts.timestamp})`)
        .orderBy(sql`DATE(${generatedPodcasts.timestamp})`),
      // Top guest creators
      db.select({
        guestId: generatedPodcasts.guestSessionId,
        count: sql<number>`COUNT(*)::int`,
        plays: sql<number>`COALESCE(SUM(${generatedPodcasts.plays}), 0)::int`,
        lastCreated: sql<string>`MAX(${generatedPodcasts.timestamp})::text`,
      }).from(generatedPodcasts)
        .where(sql`${generatedPodcasts.guestSessionId} IS NOT NULL`)
        .groupBy(generatedPodcasts.guestSessionId)
        .orderBy(desc(sql`COUNT(*)`))
        .limit(10),
      // Top registered creators
      db.select({
        userId: generatedPodcasts.userId,
        email: users.email,
        alias: users.alias,
        count: sql<number>`COUNT(*)::int`,
        plays: sql<number>`COALESCE(SUM(${generatedPodcasts.plays}), 0)::int`,
        lastCreated: sql<string>`MAX(${generatedPodcasts.timestamp})::text`,
      }).from(generatedPodcasts)
        .innerJoin(users, eq(generatedPodcasts.userId, users.id))
        .where(sql`${generatedPodcasts.userId} IS NOT NULL`)
        .groupBy(generatedPodcasts.userId, users.email, users.alias)
        .orderBy(desc(sql`COUNT(*)`))
        .limit(10),
      // Total comments
      db.execute(sql`SELECT COUNT(*)::int as count FROM comments`),
      // Total reactions
      db.execute(sql`SELECT COUNT(*)::int as count FROM podcast_likes`),
    ]);

    const total = totalPodcastsResult[0]?.count ?? 0;
    const uniqueGuests = uniqueGuestResult[0]?.count ?? 0;
    const totalUsers = totalUsersResult[0]?.count ?? 0;

    // Combine top creators
    const topCreators = [
      ...topUserResult.map(r => ({
        identifier: r.alias || r.email || r.userId || 'Unknown',
        shortId: r.userId ? r.userId.slice(0, 8) : '',
        type: 'registered' as const,
        count: r.count,
        plays: r.plays,
        lastCreated: r.lastCreated,
      })),
      ...topGuestResult.map(r => ({
        identifier: 'Guest',
        shortId: r.guestId ? r.guestId.slice(0, 8) : '',
        type: 'guest' as const,
        count: r.count,
        plays: r.plays,
        lastCreated: r.lastCreated,
      })),
    ].sort((a, b) => b.count - a.count).slice(0, 15);

    res.json({
      overview: {
        totalPodcasts: total,
        podcastsToday: todayResult[0]?.count ?? 0,
        podcastsThisWeek: weekResult[0]?.count ?? 0,
        podcastsThisMonth: monthResult[0]?.count ?? 0,
        uniqueGuestSessions: uniqueGuests,
        totalRegisteredUsers: totalUsers,
        totalUniqueCreators: uniqueGuests + totalUsers,
        totalPlays: totalPlaysResult[0]?.total ?? 0,
        totalComments: (totalCommentsResult.rows?.[0] as any)?.count ?? 0,
        totalReactions: (totalReactionsResult.rows?.[0] as any)?.count ?? 0,
        avgPodcastsPerCreator: (uniqueGuests + totalUsers) > 0
          ? Math.round((total / (uniqueGuests + totalUsers)) * 10) / 10
          : 0,
      },
      dailyCreation: dailyResult,
      topCreators,
      byTemplate: templateResult.map(r => ({
        template: r.template || 'custom',
        count: r.count,
      })),
    });
  } catch (error) {
    console.error('❌ Error fetching usage stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch usage stats',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
