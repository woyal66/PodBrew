/**
 * Voice Catalog Routes (Phase 1.2)
 * API endpoints for browsing and filtering voice catalog
 */

import { Router, type Request, type Response } from 'express';
import { voiceCatalogService } from '../services/VoiceCatalogService';
import { voicePreviewService } from '../services/VoicePreviewService';
import { avatarRegenerationService } from '../services/AvatarRegenerationService';
import { storage } from '../storage';
import { requireIdentity } from '../auth';

export const voiceCatalogRouter = Router();

/**
 * GET /api/voices
 * Get all active voices (optionally filtered)
 * Query params: category, tier, accent, gender, search
 * 
 * NOTE: This route also triggers one-time avatar migration if REGENERATE_AVATARS=true
 */
voiceCatalogRouter.get('/', async (req: Request, res: Response) => {
  try {
    // Trigger avatar migration if needed (non-blocking, fire-and-forget)
    // Set REGENERATE_AVATARS=true env var to enable, remove after migration completes
    avatarRegenerationService.triggerMigrationIfNeeded();

    const { category, tier, accent, gender, search } = req.query;

    const voices = await voiceCatalogService.getFilteredVoices({
      category: category as string | undefined,
      tier: tier as string | undefined,
      accent: accent as string | undefined,
      gender: gender as string | undefined,
      search: search as string | undefined,
    });

    res.json(voices);
  } catch (error) {
    console.error('Error fetching voices:', error);
    res.status(500).json({ error: 'Failed to fetch voices' });
  }
});

/**
 * GET /api/voices/collections
 * Get organized voice collections (Core, Regional, Specialty, News)
 */
voiceCatalogRouter.get('/collections', async (req: Request, res: Response) => {
  try {
    const collections = await voiceCatalogService.getOrganizedCollections();
    res.json(collections);
  } catch (error) {
    console.error('Error fetching voice collections:', error);
    res.status(500).json({ error: 'Failed to fetch voice collections' });
  }
});

/**
 * GET /api/voices/stats
 * Get voice catalog statistics
 */
voiceCatalogRouter.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = await voiceCatalogService.getCatalogStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching voice stats:', error);
    res.status(500).json({ error: 'Failed to fetch voice statistics' });
  }
});

/**
 * GET /api/voices/recommended
 * Get recommended voices based on podcast style
 * Query params: style, numPeople
 */
voiceCatalogRouter.get('/recommended', async (req: Request, res: Response) => {
  try {
    const { style, numPeople } = req.query;
    const podcastStyle = (style as string) || 'conversational';
    const people = parseInt(numPeople as string) || 2;

    const voices = await voiceCatalogService.getRecommendedVoices(podcastStyle, people);
    res.json(voices);
  } catch (error) {
    console.error('Error fetching recommended voices:', error);
    res.status(500).json({ error: 'Failed to fetch recommended voices' });
  }
});

/**
 * GET /api/voices/multi-host
 * Get diverse voices for multi-host podcasts
 * Query params: numPeople
 */
voiceCatalogRouter.get('/multi-host', async (req: Request, res: Response) => {
  try {
    const numPeople = parseInt(req.query.numPeople as string) || 2;
    const voices = await voiceCatalogService.getMultiHostVoices(numPeople);
    res.json(voices);
  } catch (error) {
    console.error('Error fetching multi-host voices:', error);
    res.status(500).json({ error: 'Failed to fetch multi-host voices' });
  }
});

/**
 * POST /api/voices/batch-generate-previews
 * Batch generate previews for multiple voices
 * Body: { voiceIds: string[] } or empty to generate for all active voices
 * NOTE: This route MUST be before /:id catch-all to properly match
 */
voiceCatalogRouter.post('/batch-generate-previews', async (req: Request, res: Response) => {
  try {
    let voiceIds: string[] = req.body.voiceIds || [];
    
    // If no voice IDs provided, get all active voices
    if (voiceIds.length === 0) {
      const allVoices = await voiceCatalogService.getActiveVoices();
      voiceIds = allVoices.map((v: { id: string }) => v.id);
    }

    console.log(`Starting batch preview generation for ${voiceIds.length} voices`);
    
    // Generate previews in batches
    const results = await voicePreviewService.generateBatchPreviews(voiceIds);
    
    // Count successes and failures
    const successes = Array.from(results.values()).filter(url => url !== '').length;
    const failures = results.size - successes;

    res.json({
      total: results.size,
      successes,
      failures,
      results: Object.fromEntries(results),
    });
  } catch (error) {
    console.error('Error in batch preview generation:', error);
    const message = error instanceof Error ? error.message : 'Failed to batch generate previews';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/voices/:id/preview
 * Generate or retrieve voice preview audio sample
 * NOTE: This route MUST be before /:id catch-all to properly match
 */
voiceCatalogRouter.get('/:id/preview', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const previewUrl = await voicePreviewService.generatePreview(id);
    
    res.json({ previewUrl });
  } catch (error) {
    console.error('Error generating voice preview:', error);
    const message = error instanceof Error ? error.message : 'Failed to generate voice preview';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/voices/:id/preview/accent/:accent
 * Get accent-specific preview URL for a voice (must be pre-cached via script)
 * Returns the cached accent preview URL or null if not cached
 */
voiceCatalogRouter.get('/:id/preview/accent/:accent', async (req: Request, res: Response) => {
  try {
    const { id, accent } = req.params;
    const previewUrl = await voicePreviewService.getAccentPreviewUrl(id, accent);
    
    if (!previewUrl) {
      return res.status(404).json({ 
        error: 'Accent preview not cached',
        message: `Preview for accent "${accent}" is not yet cached. Run: npx tsx server/scripts/cacheAccentPreviews.ts ${accent}`
      });
    }
    
    res.json({ previewUrl, accent });
  } catch (error) {
    console.error('Error fetching accent preview:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch accent preview';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/voices/:id/preview/accents
 * Get all cached accent previews for a voice
 * Returns a map of accent -> preview URL for all cached accent previews
 */
voiceCatalogRouter.get('/:id/preview/accents', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const accentPreviews = await voicePreviewService.getAllAccentPreviews(id);
    
    res.json({ 
      voiceId: id,
      accentPreviews,
      cachedCount: Object.keys(accentPreviews).length
    });
  } catch (error) {
    console.error('Error fetching accent previews:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch accent previews';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/voices/prosody/presets
 * Get all active prosody presets (tone presets for Phase 2)
 * NOTE: This route MUST be before /:id to avoid matching "prosody" as an ID
 */
voiceCatalogRouter.get('/prosody/presets', async (req: Request, res: Response) => {
  try {
    const presets = await voiceCatalogService.getActiveProsodyPresets();
    res.json(presets);
  } catch (error) {
    console.error('Error fetching prosody presets:', error);
    res.status(500).json({ error: 'Failed to fetch prosody presets' });
  }
});

/**
 * GET /api/voices/prosody/presets/:name
 * Get specific prosody preset by name
 * NOTE: This route MUST be before /:id to avoid matching "prosody" as an ID
 */
voiceCatalogRouter.get('/prosody/presets/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const preset = await voiceCatalogService.getProsodyPresetByName(name);

    if (!preset) {
      return res.status(404).json({ error: 'Prosody preset not found' });
    }

    res.json(preset);
  } catch (error) {
    console.error('Error fetching prosody preset:', error);
    res.status(500).json({ error: 'Failed to fetch prosody preset' });
  }
});

/**
 * GET /api/voices/favorites
 * Get current user's favorite voices
 * Requires authentication
 */
voiceCatalogRouter.get('/favorites', requireIdentity, async (req: Request, res: Response) => {
  try {
    const userId: string | null = req.userId ?? null;
    const guestId = req.guestId;
    const favorites = await storage.listVoiceFavorites(userId ?? '', guestId);
    res.json(favorites);
  } catch (error) {
    console.error('Error fetching voice favorites:', error);
    res.status(500).json({ error: 'Failed to fetch voice favorites' });
  }
});

/**
 * POST /api/voices/favorites
 * Add a voice to user's favorites
 * Body: { voiceId: string } - googleVoiceName
 * Requires user or guest identity
 */
voiceCatalogRouter.post('/favorites', requireIdentity, async (req: Request, res: Response) => {
  try {
    const userId: string | null = req.userId ?? null;
    const guestId = req.guestId;
    const { voiceId } = req.body;

    if (!voiceId || typeof voiceId !== 'string') {
      return res.status(400).json({ error: 'voiceId is required and must be a string' });
    }

    const favorite = await storage.addVoiceFavorite(userId ?? '', voiceId, guestId);
    res.status(201).json(favorite);
  } catch (error) {
    console.error('Error adding voice favorite:', error);
    res.status(500).json({ error: 'Failed to add voice favorite' });
  }
});

/**
 * DELETE /api/voices/favorites/:voiceId
 * Remove a voice from user's favorites
 * Requires user or guest identity
 */
voiceCatalogRouter.delete('/favorites/:voiceId', requireIdentity, async (req: Request, res: Response) => {
  try {
    const userId: string | null = req.userId ?? null;
    const guestId = req.guestId;
    const { voiceId } = req.params;

    const removed = await storage.removeVoiceFavorite(userId ?? '', voiceId, guestId);
    
    if (!removed) {
      return res.status(404).json({ error: 'Favorite not found' });
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error removing voice favorite:', error);
    res.status(500).json({ error: 'Failed to remove voice favorite' });
  }
});

// ========== Mood-Based Voice Recommendations ==========

/**
 * GET /api/voices/mood/collections
 * Get voice collections organized by mood compatibility
 * Query params: mood (required)
 * NOTE: This route MUST be before /:id to avoid matching "mood" as an ID
 */
voiceCatalogRouter.get('/mood/collections', async (req: Request, res: Response) => {
  try {
    const { mood } = req.query;

    if (!mood || typeof mood !== 'string') {
      return res.status(400).json({ error: 'mood query parameter is required' });
    }

    const validMoods = ['uplifting', 'serious', 'humorous', 'mysterious', 'balanced', 'energetic'];
    if (!validMoods.includes(mood)) {
      return res.status(400).json({ error: `Invalid mood. Must be one of: ${validMoods.join(', ')}` });
    }

    const collections = await voiceCatalogService.getOrganizedCollectionsByMood(mood as any);
    res.json(collections);
  } catch (error) {
    console.error('Error fetching mood-based collections:', error);
    res.status(500).json({ error: 'Failed to fetch mood-based collections' });
  }
});

/**
 * GET /api/voices/mood/recommendations
 * Get recommended voices for a specific mood
 * Query params: mood (required), hostCount (optional, default 1)
 * NOTE: This route MUST be before /:id to avoid matching "mood" as an ID
 */
voiceCatalogRouter.get('/mood/recommendations', async (req: Request, res: Response) => {
  try {
    const { mood, hostCount } = req.query;

    if (!mood || typeof mood !== 'string') {
      return res.status(400).json({ error: 'mood query parameter is required' });
    }

    const validMoods = ['uplifting', 'serious', 'humorous', 'mysterious', 'balanced', 'energetic'];
    if (!validMoods.includes(mood)) {
      return res.status(400).json({ error: `Invalid mood. Must be one of: ${validMoods.join(', ')}` });
    }

    const count = hostCount ? parseInt(hostCount as string) : 1;
    const recommendations = await voiceCatalogService.getMoodRecommendations(mood as any, count);
    
    res.json(recommendations);
  } catch (error) {
    console.error('Error fetching mood recommendations:', error);
    res.status(500).json({ error: 'Failed to fetch mood recommendations' });
  }
});

/**
 * GET /api/voices/mood/best
 * Get the best single voice for a mood
 * Query params: mood (required), gender (optional)
 * NOTE: This route MUST be before /:id to avoid matching "mood" as an ID
 */
voiceCatalogRouter.get('/mood/best', async (req: Request, res: Response) => {
  try {
    const { mood, gender } = req.query;

    if (!mood || typeof mood !== 'string') {
      return res.status(400).json({ error: 'mood query parameter is required' });
    }

    const validMoods = ['uplifting', 'serious', 'humorous', 'mysterious', 'balanced', 'energetic'];
    if (!validMoods.includes(mood)) {
      return res.status(400).json({ error: `Invalid mood. Must be one of: ${validMoods.join(', ')}` });
    }

    const bestVoice = await voiceCatalogService.getBestVoiceForMood(
      mood as any,
      gender as string | undefined
    );
    
    if (!bestVoice) {
      return res.status(404).json({ error: 'No suitable voice found for this mood' });
    }

    res.json(bestVoice);
  } catch (error) {
    console.error('Error fetching best voice for mood:', error);
    res.status(500).json({ error: 'Failed to fetch best voice for mood' });
  }
});

/**
 * GET /api/voices/:id
 * Get specific voice by ID or Google voice name
 * NOTE: This catch-all route MUST be last to avoid conflicts with specific routes above
 */
voiceCatalogRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    // Try to find by ID first
    let voice = await voiceCatalogService.getVoiceById(id);
    
    // If not found, try by Google voice name
    if (!voice) {
      voice = await voiceCatalogService.getVoiceByGoogleName(id);
    }

    if (!voice) {
      return res.status(404).json({ error: 'Voice not found' });
    }

    res.json(voice);
  } catch (error) {
    console.error('Error fetching voice:', error);
    res.status(500).json({ error: 'Failed to fetch voice' });
  }
});
