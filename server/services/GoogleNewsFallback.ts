/**
 * Google News RSS fallback for trending topics.
 *
 * Used when the primary provider (Perplexity or xAI) is in cool-down due to
 * quota exhaustion. Fetches Google News RSS (no API key required) and maps
 * the result into the shared TrendingTopic shape so the rest of the pipeline
 * works without changes.
 *
 * The 24h freshness filter applied by TrendingCache is also applied here so
 * stale RSS items are never served.
 *
 * Dependency-free: uses only the global `fetch` available in Node 18+.
 */

import type { TrendingTopic, TrendingCategory } from '../perplexity';

const GOOGLE_NEWS_BASE = 'https://news.google.com/rss';

// Map each category to a Google News RSS URL.
const CATEGORY_URLS: Record<TrendingCategory, string> = {
  all:           `${GOOGLE_NEWS_BASE}?hl=en-US&gl=US&ceid=US:en`,
  tech:          `${GOOGLE_NEWS_BASE}/headlines/section/topic/TECHNOLOGY?hl=en-US&gl=US&ceid=US:en`,
  sports:        `${GOOGLE_NEWS_BASE}/headlines/section/topic/SPORTS?hl=en-US&gl=US&ceid=US:en`,
  entertainment: `${GOOGLE_NEWS_BASE}/headlines/section/topic/ENTERTAINMENT?hl=en-US&gl=US&ceid=US:en`,
  business:      `${GOOGLE_NEWS_BASE}/headlines/section/topic/BUSINESS?hl=en-US&gl=US&ceid=US:en`,
  health:        `${GOOGLE_NEWS_BASE}/headlines/section/topic/HEALTH?hl=en-US&gl=US&ceid=US:en`,
  science:       `${GOOGLE_NEWS_BASE}/headlines/section/topic/SCIENCE?hl=en-US&gl=US&ceid=US:en`,
  world:         `${GOOGLE_NEWS_BASE}/headlines/section/topic/WORLD?hl=en-US&gl=US&ceid=US:en`,
  // No dedicated Google News topic for these — use search queries.
  politics:      `${GOOGLE_NEWS_BASE}/search?q=politics+news&hl=en-US&gl=US&ceid=US:en`,
  crime:         `${GOOGLE_NEWS_BASE}/search?q=crime+news&hl=en-US&gl=US&ceid=US:en`,
  culture:       `${GOOGLE_NEWS_BASE}/headlines/section/topic/ENTERTAINMENT?hl=en-US&gl=US&ceid=US:en`,
};

const FETCH_TIMEOUT_MS = 8_000;
const MAX_ITEMS = 10;

/** Minimal XML text-content extractor — avoids adding an XML parser dep. */
function extractTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  if (!m) return '';
  return (m[1] ?? m[2] ?? '').trim();
}

function parseItems(xml: string): Array<{ title: string; pubDate: string; link: string }> {
  const items: Array<{ title: string; pubDate: string; link: string }> = [];
  // Split on <item> tags.
  const parts = xml.split(/<item[\s>]/i);
  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i];
    const rawTitle = extractTag(chunk, 'title');
    // Google News titles often contain " - Source Name" suffix; strip it.
    const title = rawTitle.replace(/\s+-\s+[^-]+$/, '').trim();
    const pubDate = extractTag(chunk, 'pubDate');
    const link = extractTag(chunk, 'link') || (chunk.match(/<link>([^<]+)/i)?.[1] ?? '');
    if (title) items.push({ title, pubDate, link });
    if (items.length >= MAX_ITEMS) break;
  }
  return items;
}

const FRESH_MS = 24 * 60 * 60 * 1000;

/**
 * Fetch up to MAX_ITEMS trending topics from Google News RSS for the given
 * category. Returns an empty array (never throws) so it is safe to call as a
 * last-resort fallback.
 */
export async function fetchGoogleNewsFallback(
  category: TrendingCategory,
): Promise<TrendingTopic[]> {
  const url = CATEGORY_URLS[category] ?? CATEGORY_URLS.all;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PodBrew/1.0; +https://podbrew.app)',
        'Accept': 'application/rss+xml, application/xml, text/xml',
      },
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[GoogleNewsFallback] HTTP ${response.status} for category=${category}`);
      return [];
    }

    const xml = await response.text();
    const items = parseItems(xml);

    const now = Date.now();
    const cutoff = now - FRESH_MS;
    const topics: TrendingTopic[] = [];

    for (const item of items) {
      const pubTs = item.pubDate ? Date.parse(item.pubDate) : NaN;
      // Drop items we can positively identify as older than 24h; keep unknowns.
      if (!isNaN(pubTs) && pubTs < cutoff) continue;

      topics.push({
        title: item.title,
        summary: `Trending now in ${category}. Source: ${item.link || 'Google News'}`,
        category,
        relevanceScore: 0.6,
        publishedAt: !isNaN(pubTs) ? new Date(pubTs).toISOString() : undefined,
      });
    }

    console.log(`[GoogleNewsFallback] ✅ category=${category} → ${topics.length} topics (from ${items.length} raw items)`);
    return topics;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn(`[GoogleNewsFallback] Timeout fetching category=${category}`);
    } else {
      console.warn(`[GoogleNewsFallback] Error for category=${category}:`, err instanceof Error ? err.message : err);
    }
    return [];
  }
}
