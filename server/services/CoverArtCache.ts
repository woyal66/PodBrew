import { generateImage as generateImageWithGemini } from '../gemini';
import * as PersistentCache from './PersistentCache';
import { ObjectStorageService } from '../objectStorage';
import crypto from 'crypto';
import sharp from 'sharp';

// Cover art is rendered at 96-256 CSS px on tiles and ~400 CSS px on the
// detail page. Encoding at 600px max edge keeps retina (~2x) sharpness while
// shrinking each cover from ~500KB-1MB PNG down to ~30-80KB WebP. Filenames
// are content-addressed (sha256 of the WebP bytes) so identical generated
// images dedup to a single object in storage.
const COVER_TARGET_MAX_EDGE_PX = 600;
const COVER_WEBP_QUALITY = 82;

/**
 * Decode a `data:image/...;base64,...` URI returned by Gemini, downscale +
 * re-encode it to a small WebP via sharp, and upload it to public object
 * storage at `covers/<sha256>.webp`. Returns the public URL (`/public-objects/...`).
 *
 * Throws on any decode/resize/encode/upload failure so callers can fall back
 * to the generic SVG cover in object storage. We never want to write a
 * `data:` URI into `generated_podcasts.cover_image_url` — the list-endpoint
 * projection (`slimCoverImageUrl` in `server/storage.ts`) intentionally nulls
 * those out and tiles would render the empty-state waveform.
 */
async function optimizeAndUploadCoverFromDataUri(dataUri: string): Promise<string> {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUri);
  if (!match) {
    throw new Error('optimizeAndUploadCoverFromDataUri: input is not a base64 data URI');
  }
  const sourceBuffer = Buffer.from(match[2], 'base64');

  const webpBuffer = await sharp(sourceBuffer)
    .resize(COVER_TARGET_MAX_EDGE_PX, COVER_TARGET_MAX_EDGE_PX, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: COVER_WEBP_QUALITY })
    .toBuffer();

  const sha = crypto.createHash('sha256').update(webpBuffer).digest('hex');
  const relativePath = `covers/${sha}.webp`;
  const publicUrl = `/public-objects/${relativePath}`;

  const storage = getObjectStorage();
  const exists = await storage.checkObjectExists(relativePath);
  if (!exists) {
    await storage.uploadPublicObject(relativePath, webpBuffer, 'image/webp');
    console.log(
      `[CoverArtCache] 📤 Uploaded WebP cover ${sha.slice(0, 12)}.webp (${(webpBuffer.length / 1024).toFixed(1)} KB)`,
    );
  }
  return publicUrl;
}

interface CoverArtCacheEntry {
  concept: string;
  url: string;
  cachedAt: number;
  visualDescriptors?: string;
  template?: string;
}

// PodBrew brand green color
const PODBREW_GREEN = '#1DB954';

// Raw SVG bodies for the three fallback covers. These are uploaded to
// object storage on first use (see `getOrUploadFallbackCover`) and the
// resulting public URL is reused for every fallback after that. We
// intentionally do NOT inline these as `data:` URIs into
// `generated_podcasts.cover_image_url` — that would recreate the
// payload-bloat problem the cover-image migration script just cleaned
// up. See task: "Stop new podcasts from saving giant inline cover
// images".
const R18_BADGE_SVG = `<svg width="300" height="300" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0f0f0f;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#1a1a1a;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="300" height="300" fill="url(#bgGradient)"/>
  <g transform="translate(50, 75)">
    <rect x="0" y="0" width="80" height="150" fill="white" rx="8"/>
    <text x="40" y="110" font-size="100" font-weight="bold" text-anchor="middle" font-family="Arial, sans-serif" fill="black">R</text>
    <rect x="90" y="0" width="110" height="150" fill="${PODBREW_GREEN}" rx="8"/>
    <text x="145" y="115" font-size="90" font-weight="bold" text-anchor="middle" font-family="Arial, sans-serif" fill="white">18</text>
  </g>
  <text x="150" y="270" font-size="18" font-weight="bold" text-anchor="middle" font-family="Arial, sans-serif" fill="${PODBREW_GREEN}">ADULT CONTENT</text>
</svg>`;

const PODCAST_FALLBACK_SVG = `<svg width="300" height="300" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#1f2936;stop-opacity:1" /><stop offset="100%" style="stop-color:#070809;stop-opacity:1" /></linearGradient></defs><rect width="300" height="300" fill="url(#g)"/><text x="50%" y="50%" text-anchor="middle" font-size="24" font-weight="bold" fill="white">PodBrew</text></svg>`;

const PLAYLIST_FALLBACK_SVG = `<svg width="300" height="300" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="pg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#1DB954;stop-opacity:1" /><stop offset="100%" style="stop-color:#0a2e1a;stop-opacity:1" /></linearGradient></defs><rect width="300" height="300" fill="url(#pg)"/><text x="50%" y="50%" text-anchor="middle" font-size="40" fill="white">&#127925;</text></svg>`;

// In-memory cache of fallback name -> public URL so we hit object
// storage at most once per process, per fallback variant.
const fallbackCoverUrlCache = new Map<string, string>();
let objectStorageInstance: ObjectStorageService | null = null;
function getObjectStorage(): ObjectStorageService {
  if (!objectStorageInstance) {
    objectStorageInstance = new ObjectStorageService();
  }
  return objectStorageInstance;
}

/**
 * Ensure a fallback SVG is uploaded to public object storage and return
 * its public URL. Filenames are content-hashed so that updating the SVG
 * body produces a new file (and the new URL flows through the in-memory
 * cache automatically).
 *
 * If object storage is unreachable for the very first call after boot
 * we log and return an empty string so the row is still saved with a
 * harmless empty `cover_image_url` instead of a giant `data:` URI.
 * The frontend already renders the placeholder waveform for empty
 * cover URLs, so the user-visible result is the same as today's
 * stripped legacy rows — just without bloating the row.
 */
async function getOrUploadFallbackCover(name: string, svg: string): Promise<string> {
  const cached = fallbackCoverUrlCache.get(name);
  if (cached) return cached;

  const hash = crypto.createHash('sha1').update(svg).digest('hex').slice(0, 8);
  const relativePath = `covers/fallback/${name}-${hash}.svg`;
  const publicUrl = `/public-objects/${relativePath}`;

  try {
    const storage = getObjectStorage();
    const exists = await storage.checkObjectExists(relativePath);
    if (!exists) {
      await storage.uploadPublicObject(relativePath, Buffer.from(svg, 'utf-8'), 'image/svg+xml');
      console.log(`[CoverArtCache] 📤 Uploaded fallback cover '${name}' to ${publicUrl}`);
    }
    fallbackCoverUrlCache.set(name, publicUrl);
    return publicUrl;
  } catch (err) {
    console.warn(
      `[CoverArtCache] ⚠️ Failed to ensure fallback cover '${name}' in object storage; returning empty URL to avoid writing a data: URI. Error:`,
      err instanceof Error ? err.message : String(err),
    );
    return '';
  }
}

// Async wrapper kept for symmetry with the other fallbacks.
async function generateR18Badge(): Promise<string> {
  return getOrUploadFallbackCover('r18', R18_BADGE_SVG);
}

const coverArtCache = new Map<string, CoverArtCacheEntry>();
const COVER_ART_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const COVER_ART_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days in seconds

// Generate unique cache key from the full title - ensures every podcast gets unique art
function generateCacheKeyHash(title: string, template: string): string {
  const combined = `${title}|${template}`;
  return crypto.createHash('md5').update(combined).digest('hex');
}

// Detect topic category for style guidance only (not for caching)
function detectTopicCategory(title: string): string {
  const lower = title.toLowerCase();
  
  const categoryKeywords: Record<string, string[]> = {
    'technology': ['ai', 'machine learning', 'tech', 'software', 'app', 'coding', 'startup', 'innovation', 'digital', 'cyber', 'robot', 'computer'],
    'health': ['health', 'medical', 'wellness', 'disease', 'diet', 'exercise', 'fitness', 'healthcare', 'doctor', 'medicine', 'therapy', 'mental'],
    'business': ['business', 'company', 'market', 'sales', 'economy', 'finance', 'corporate', 'entrepreneur', 'investment', 'stock', 'money', 'profit'],
    'news': ['news', 'breaking', 'update', 'current', 'trending', 'politics', 'government', 'election', 'policy', 'crisis'],
    'science': ['science', 'research', 'study', 'discovery', 'climate', 'physics', 'biology', 'chemistry', 'space', 'quantum', 'experiment'],
    'entertainment': ['movie', 'music', 'show', 'celebrity', 'entertainment', 'film', 'actor', 'singer', 'album', 'concert', 'streaming'],
    'sports': ['sports', 'game', 'player', 'team', 'championship', 'league', 'athlete', 'football', 'basketball', 'soccer', 'tennis', 'golf'],
    'education': ['education', 'learning', 'teach', 'school', 'university', 'course', 'study', 'lesson', 'tutorial', 'how to', 'guide'],
    'lifestyle': ['lifestyle', 'travel', 'food', 'home', 'personal', 'family', 'relationship', 'cooking', 'recipe', 'vacation', 'fashion'],
    'stories': ['story', 'tale', 'adventure', 'mystery', 'fantasy', 'romance', 'fiction', 'novel', 'narrative', 'chapter'],
  };
  
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some(kw => lower.includes(kw))) {
      return category;
    }
  }
  
  return 'general';
}

// Generate a unique, title-specific prompt for photo-realistic cover art
function generateTitleBasedPrompt(title: string, template: string, category: string): string {
  // STRICT PHOTOREALISM REQUIREMENTS - Magazine-quality real-world photography ONLY
  const photorealismRequirements = `
=== MANDATORY PHOTOREALISM REQUIREMENTS ===
THIS IMAGE MUST LOOK LIKE A REAL PHOTOGRAPH TAKEN BY A PROFESSIONAL PHOTOGRAPHER.
Think TIME Magazine, National Geographic, Forbes, The New York Times, or Vanity Fair cover photography.

REQUIRED CHARACTERISTICS:
• Shot with a real camera (DSLR/mirrorless) with natural optical properties
• Real-world lighting only: natural sunlight, studio strobes, practical lights - NO glowing/ethereal/magical lighting
• Authentic human subjects with natural skin texture, pores, subtle imperfections, realistic facial features
• Real physical environments that exist in the world - offices, streets, laboratories, stadiums, etc.
• Natural color grading typical of professional photojournalism - NO oversaturation, NO neon colors
• Realistic depth of field with optical bokeh, NOT digital blur effects
• Proper perspective and physics - objects have weight, shadows fall correctly, proportions are anatomically accurate
• Documentary/editorial photography aesthetic - candid moments or posed portraits that look natural

ABSOLUTELY FORBIDDEN (DO NOT INCLUDE):
❌ NO surreal, dreamlike, or hallucinogenic imagery
❌ NO fantasy elements, magical effects, or supernatural lighting
❌ NO glowing objects, auras, halos, or ethereal effects
❌ NO impossible physics (floating objects, impossible reflections, warped perspective)
❌ NO digital art styling, illustration aesthetics, or painterly effects
❌ NO perfect symmetry or unnaturally centered compositions
❌ NO plastic/glossy skin or uncanny valley faces
❌ NO AI-typical patterns (repetitive textures, melting edges, extra fingers/limbs)
❌ NO oversaturated or neon color palettes
❌ NO abstract or conceptual art interpretations
❌ NO text, logos, watermarks, or titles overlaid on the image
❌ NO composite/collage effects or multiple exposures

THE IMAGE MUST BE INDISTINGUISHABLE FROM A REAL PHOTOGRAPH PUBLISHED IN A MAJOR MAGAZINE.`;

  // Category-specific photography style guidance - all grounded in real-world photography
  const categoryStyles: Record<string, string> = {
    'technology': 'Bloomberg Businessweek tech photography style: real people in actual offices/labs, natural workspace lighting, authentic modern environments',
    'health': 'Medical journal photography: real healthcare settings, actual clinical environments, warm professional lighting, authentic doctor-patient moments',
    'business': 'Forbes/Fortune editorial photography: real executives in real offices, confident professional portraits, natural corporate lighting',
    'news': 'Associated Press/Reuters documentary photography: authentic journalism, real-world scenes, natural available lighting, candid moments',
    'science': 'National Geographic/Scientific American photography: real laboratories, actual researchers at work, precise natural lighting',
    'entertainment': 'Rolling Stone/Entertainment Weekly photography: real celebrity portraits, authentic backstage moments, professional studio or location lighting',
    'sports': 'Sports Illustrated photography: real athletic action, actual stadium/arena settings, dramatic natural outdoor lighting',
    'education': 'Education Week photography: real classrooms, actual students and teachers, warm natural institutional lighting',
    'lifestyle': 'Vogue/GQ lifestyle photography: authentic lifestyle moments, real homes and locations, golden-hour natural lighting',
    'stories': 'The New Yorker photography: atmospheric real-world scenes, authentic locations, moody but realistic lighting',
    'general': 'TIME Magazine editorial photography: professional journalistic quality, real subjects in real settings, publication-ready',
  };

  // Template-specific modifiers - all grounded in reality
  const templateModifiers: Record<string, string> = {
    'stories': 'atmospheric real-world location, cinematic but realistic composition',
    'news': 'documentary authenticity, current events journalism aesthetic',
    'sports': 'real athletic action, actual sporting venues, dynamic but realistic',
    'medical': 'real clinical environment, authentic healthcare setting',
    'teachme': 'real educational setting, authentic learning environment',
    'events': 'real event photography, actual venue atmosphere',
    'documents': 'professional business context, real office environment',
  };

  const style = categoryStyles[category] || categoryStyles['general'];
  const templateMod = templateModifiers[template] || '';
  
  // Create a unique prompt based on the actual title - emphasizing real-world photography
  const prompt = `Create a REAL PHOTOGRAPH that could be published in TIME Magazine or National Geographic for the topic: "${title}".

This must look like an actual photograph taken by a professional photojournalist or editorial photographer - NOT AI-generated art.

The image should capture "${title}" through:
• Real subjects photographed in authentic, real-world environments
• Natural lighting conditions that exist in the physical world
• Documentary or editorial photography composition
• ${style}
${templateMod ? `• ${templateMod}` : ''}

PHOTOGRAPHY SPECIFICATIONS:
• Shot on professional camera with natural optical characteristics
• Magazine cover quality - suitable for TIME, Forbes, National Geographic
• Real depth of field with natural optical bokeh
• Authentic textures: real fabric, real skin, real materials
• Natural color palette grounded in reality

${photorealismRequirements}`;

  return prompt;
}

// Auto-cleanup expired entries every 24 hours
setInterval(() => {
  const now = Date.now();
  const expired: string[] = [];
  
  Array.from(coverArtCache.entries()).forEach(([key, value]) => {
    if (now - value.cachedAt > COVER_ART_CACHE_TTL) {
      expired.push(key);
    }
  });
  
  expired.forEach(key => coverArtCache.delete(key));
  if (expired.length > 0) {
    console.log(`[CoverArtCache] Cleaned up ${expired.length} expired entries`);
  }
}, 24 * 60 * 60 * 1000);

export async function generateOrGetCoverArt(title: string, template: string = 'news', storyGenre?: string): Promise<string> {
  // For erotic content, return R18 badge immediately (don't try to generate via Gemini - violates content policy)
  if (storyGenre === 'erotic' || template === 'stories' && storyGenre === 'erotic') {
    console.log(`[CoverArtCache] 🔴 ADULT CONTENT - Using R18 badge for erotic story: "${title.substring(0, 40)}..."`);
    return await generateR18Badge();
  }
  
  // Generate unique cache key based on full title (ensures every podcast gets unique art)
  const cacheKey = generateCacheKeyHash(title, template);
  const category = detectTopicCategory(title);
  
  const cached = coverArtCache.get(cacheKey);
  
  if (cached && Date.now() - cached.cachedAt < COVER_ART_CACHE_TTL) {
    console.log(`[CoverArtCache] 🟢 CACHE HIT - Reusing unique image for: "${title.substring(0, 50)}..."`);
    return cached.url;
  }
  
  // Check PersistentCache (PostgreSQL) before generating new image
  const persistentKey = `coverart:${cacheKey}`;
  const persistedData = await PersistentCache.get<CoverArtCacheEntry>(persistentKey);
  
  if (persistedData && persistedData.url) {
    coverArtCache.set(cacheKey, persistedData);
    console.log(`[CoverArtCache] 🟣 PERSISTENT CACHE HIT for: "${title.substring(0, 50)}..."`);
    return persistedData.url;
  }
  
  console.log(`[CoverArtCache] 🔵 GENERATING UNIQUE IMAGE for: "${title.substring(0, 50)}..." [Category: ${category}, Template: ${template}]`);
  const titleBasedPrompt = generateTitleBasedPrompt(title, template, category);
  
  let imageUrl: string;
  let usedFallback = false;
  try {
    const rawDataUri = await generateImageWithGemini(titleBasedPrompt);
    // Decode + downscale + re-encode as small WebP, content-addressed in
    // object storage. Replaces the giant inline `data:` URI with a public
    // `/public-objects/covers/<sha>.webp` URL so tile rendering, the
    // persistent cache, and the list-endpoint slimmer all behave correctly.
    imageUrl = await optimizeAndUploadCoverFromDataUri(rawDataUri);
    console.log(`[CoverArtCache] ✅ Generated unique photo-realistic cover art for: "${title.substring(0, 40)}..."`);
  } catch (error) {
    // Fallback to placeholder if image generation OR optimize/upload fails
    // (e.g., content policy violations, API errors, sharp decode failures,
    // object storage outages).
    console.warn(`[CoverArtCache] ⚠️ Image generation/optimize failed for "${title.substring(0, 40)}...", using fallback placeholder`);
    console.warn(`[CoverArtCache] Error details:`, error instanceof Error ? error.message : String(error));

    // Reuse a single fallback SVG hosted in object storage instead of
    // inlining it as a `data:` URI (which would bloat the row and get
    // stripped by the list endpoints — see notes near the top of this
    // file).
    imageUrl = await getOrUploadFallbackCover('podcast', PODCAST_FALLBACK_SVG);
    usedFallback = true;
  }
  
  const cacheData: CoverArtCacheEntry = {
    concept: category,
    url: imageUrl,
    cachedAt: Date.now(),
    visualDescriptors: title,
    template
  };
  
  // Skip both caches when we fell back: otherwise a single transient
  // Gemini failure would lock this title to the generic fallback for 7
  // days. The next request should retry real generation.
  // Also guard against any legacy `data:` URI that might slip through —
  // we never want those in the persistent cache.
  if (!usedFallback && !imageUrl.startsWith('data:')) {
    coverArtCache.set(cacheKey, cacheData);
    await PersistentCache.set(persistentKey, cacheData, 'coverart', COVER_ART_CACHE_TTL_SECONDS);
    console.log(`[CoverArtCache] 💾 Persisted cover art to DB for: "${title.substring(0, 40)}..."`);
  }
  
  return imageUrl;
}

// Generate cover art for playlists based on playlist name
export async function generatePlaylistCoverArt(playlistName: string): Promise<string> {
  const cacheKey = `playlist:${generateCacheKeyHash(playlistName, 'playlist')}`;
  
  const cached = coverArtCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < COVER_ART_CACHE_TTL) {
    console.log(`[CoverArtCache] 🟢 CACHE HIT - Reusing playlist image for: "${playlistName}"`);
    return cached.url;
  }
  
  console.log(`[CoverArtCache] 🔵 GENERATING PLAYLIST IMAGE for: "${playlistName}"`);
  
  const prompt = `Create a REAL PHOTOGRAPH for a podcast playlist called "${playlistName}" that could appear in a major lifestyle magazine.

This must look like an actual photograph taken by a professional photographer - NOT AI-generated art.

The image should capture the theme of "${playlistName}" through:
• Real subjects and environments that evoke the playlist's mood
• Natural lighting conditions that exist in the physical world
• Editorial photography composition like Vogue or GQ lifestyle shoots
• Authentic textures, materials, and real-world settings

PHOTOGRAPHY SPECIFICATIONS:
• Shot on professional camera with natural optical characteristics
• Magazine quality - suitable for publication in major lifestyle magazines
• Real depth of field with natural optical bokeh
• Natural color palette grounded in reality

=== MANDATORY PHOTOREALISM REQUIREMENTS ===
THIS IMAGE MUST LOOK LIKE A REAL PHOTOGRAPH TAKEN BY A PROFESSIONAL PHOTOGRAPHER.

REQUIRED:
• Real-world lighting only: natural sunlight, studio strobes, practical lights
• Authentic environments that exist in the physical world
• Natural color grading typical of professional photography
• Documentary/editorial photography aesthetic

ABSOLUTELY FORBIDDEN:
❌ NO surreal, dreamlike, or hallucinogenic imagery
❌ NO fantasy elements, magical effects, or supernatural lighting
❌ NO glowing objects, auras, halos, or ethereal effects
❌ NO impossible physics or warped perspective
❌ NO digital art styling or illustration aesthetics
❌ NO oversaturated or neon color palettes
❌ NO abstract or conceptual art interpretations
❌ NO text, logos, watermarks, or titles overlaid on the image

THE IMAGE MUST BE INDISTINGUISHABLE FROM A REAL PHOTOGRAPH.`;

  let imageUrl: string;
  let usedFallback = false;
  try {
    const rawDataUri = await generateImageWithGemini(prompt);
    // Same optimize-and-upload pipeline as podcast covers: decode the
    // Gemini `data:` URI, downscale, re-encode as small WebP, store at
    // `covers/<sha>.webp` so the playlist gets a public URL instead of a
    // multi-megabyte data URI.
    imageUrl = await optimizeAndUploadCoverFromDataUri(rawDataUri);
    console.log(`[CoverArtCache] ✅ Generated unique playlist cover for: "${playlistName}"`);
  } catch (error) {
    console.warn(`[CoverArtCache] ⚠️ Playlist image generation/optimize failed for "${playlistName}", using fallback`);
    console.warn(`[CoverArtCache] Error details:`, error instanceof Error ? error.message : String(error));
    // Reuse the playlist fallback SVG hosted in object storage instead
    // of inlining it as a `data:` URI.
    imageUrl = await getOrUploadFallbackCover('playlist', PLAYLIST_FALLBACK_SVG);
    usedFallback = true;
  }
  
  // Don't cache fallbacks: a transient Gemini failure shouldn't lock
  // this playlist into the generic art for 7 days.
  if (!usedFallback) {
    coverArtCache.set(cacheKey, {
      concept: 'playlist',
      url: imageUrl,
      cachedAt: Date.now(),
      visualDescriptors: playlistName,
      template: 'playlist'
    });
  }
  
  return imageUrl;
}

export function clearCoverArtCache(): void {
  coverArtCache.clear();
  console.log('[CoverArtCache] ✅ Cache cleared');
}

export function getCoverArtCacheStats(): Record<string, any> {
  return {
    conceptsCount: coverArtCache.size,
    concepts: Array.from(coverArtCache.entries()).map(([key, value]) => ({
      concept: key,
      age: Date.now() - value.cachedAt,
      ageSeconds: Math.round((Date.now() - value.cachedAt) / 1000),
      ageDays: Math.round((Date.now() - value.cachedAt) / (1000 * 60 * 60 * 24))
    }))
  };
}
