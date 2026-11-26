import { warmTrendingTopic } from './TrendingCache';
import { getXTrendingTopics, getXTrendingCacheAge } from '../grok';
import type { TrendingCategory } from '../perplexity';
import { isQuotaError, isProviderInCooldown, setProviderCooldown } from './providerQuotaGuard';

// ---------------------------------------------------------------------------
// Configuration — all overridable via environment variables so you can tune
// without a code deploy.
// ---------------------------------------------------------------------------

const ALL_CATEGORIES: TrendingCategory[] = [
  'all', 'tech', 'sports', 'politics', 'entertainment',
  'science', 'business', 'health', 'world', 'culture', 'crime',
];

/**
 * Categories pre-warmed on the background schedule.
 * Long-tail categories still load on demand — the SWR cache handles them.
 * Override: TRENDING_WARM_CATEGORIES=all,tech,sports  (comma-separated)
 */
const HOT_CATEGORIES: TrendingCategory[] = (() => {
  const env = process.env.TRENDING_WARM_CATEGORIES;
  if (env) {
    const parsed = env.split(',').map(s => s.trim()).filter(Boolean) as TrendingCategory[];
    if (parsed.length > 0) return parsed;
  }
  return ['all', 'tech', 'entertainment'] as TrendingCategory[];
})();

/**
 * How often the warmer runs.
 * Override: TRENDING_WARM_INTERVAL_MS=43200000  (ms)
 */
const WARMER_INTERVAL_MS = parseInt(process.env.TRENDING_WARM_INTERVAL_MS ?? '', 10) || 12 * 60 * 60 * 1000; // 12h

const WARMER_INITIAL_DELAY_MS = 30 * 1000; // 30s after server start
const WARMER_CONCURRENCY = 2; // reduced from 3 — gentler on provider limits
const X_FRESH_SKIP_MS = 60 * 60 * 1000; // skip an X key refreshed in the last hour

let warmerInterval: NodeJS.Timeout | null = null;
let warmerStarted = false;
let warmerRunInFlight = false;

interface WarmJob {
  source: 'web' | 'x';
  category: TrendingCategory;
}

interface WarmResult {
  source: 'web' | 'x';
  category: TrendingCategory;
  skipped: boolean;
  topics: number;
  error?: string;
}

async function runJob(job: WarmJob): Promise<WarmResult> {
  try {
    if (job.source === 'web') {
      // Skip entirely if Perplexity is in cool-down — TrendingCache will use
      // RSS fallback on demand instead.
      if (isProviderInCooldown('perplexity')) {
        console.log(`[TrendingWarmer] ⏸ web/${job.category} skipped — Perplexity in cool-down`);
        return { source: 'web', category: job.category, skipped: true, topics: 0 };
      }

      const result = await warmTrendingTopic(job.category);
      return {
        source: 'web',
        category: job.category,
        skipped: result.skipped,
        topics: result.topics,
      };
    }

    // X source — skip if xAI is in cool-down.
    if (isProviderInCooldown('xai')) {
      console.log(`[TrendingWarmer] ⏸ x/${job.category} skipped — xAI in cool-down`);
      return { source: 'x', category: job.category, skipped: true, topics: 0 };
    }

    // Skip if the in-memory X cache has a recent entry.
    const categoryFilter = job.category === 'all' ? undefined : job.category;
    const age = getXTrendingCacheAge(categoryFilter);
    if (age !== null && age < X_FRESH_SKIP_MS) {
      return { source: 'x', category: job.category, skipped: true, topics: 0 };
    }
    const result = await getXTrendingTopics(categoryFilter, 10);
    return {
      source: 'x',
      category: job.category,
      skipped: false,
      topics: result.topics.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Detect quota / rate-limit errors and set provider cool-down so we stop
    // hammering a provider that's already exhausted.
    if (isQuotaError(err)) {
      const provider = job.source === 'web' ? 'perplexity' : 'xai';
      setProviderCooldown(provider, message.slice(0, 120));
    }

    return {
      source: job.source,
      category: job.category,
      skipped: false,
      topics: 0,
      error: message,
    };
  }
}

async function runWithConcurrency(jobs: WarmJob[], limit: number): Promise<WarmResult[]> {
  const results: WarmResult[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < jobs.length) {
      const idx = cursor++;
      const job = jobs[idx];
      const res = await runJob(job);
      results.push(res);
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(limit, jobs.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

export async function runTrendingWarmer(): Promise<void> {
  // Run-lock: if a previous run is still in flight (e.g. a stuck provider),
  // skip this tick rather than doubling up.
  if (warmerRunInFlight) {
    console.log('[TrendingWarmer] ⏭ Previous run still in flight, skipping this tick');
    return;
  }
  warmerRunInFlight = true;

  const startedAt = Date.now();
  const jobs: WarmJob[] = [];

  // Web (Perplexity) — only warm the hot categories; long-tail loads on demand.
  if (!isProviderInCooldown('perplexity')) {
    for (const c of HOT_CATEGORIES) {
      jobs.push({ source: 'web', category: c });
    }
  } else {
    console.log('[TrendingWarmer] ⏸ Skipping all web jobs — Perplexity in cool-down');
  }

  // X (Grok) — same hot-category subset.
  if (process.env.XAI_API_KEY && !isProviderInCooldown('xai')) {
    for (const c of HOT_CATEGORIES) {
      jobs.push({ source: 'x', category: c });
    }
  } else if (isProviderInCooldown('xai')) {
    console.log('[TrendingWarmer] ⏸ Skipping all X jobs — xAI in cool-down');
  }

  console.log(`[TrendingWarmer] ▶️ Starting warm-up (${jobs.length} keys covering ${HOT_CATEGORIES.join(', ')}, concurrency=${WARMER_CONCURRENCY})`);

  try {
    let results: WarmResult[];
    try {
      results = await runWithConcurrency(jobs, WARMER_CONCURRENCY);
    } catch (err) {
      console.error('[TrendingWarmer] Unexpected warmer failure:', err);
      return;
    }

    const skipped = results.filter(r => r.skipped).length;
    const errored = results.filter(r => r.error).length;
    const refreshed = results.length - skipped - errored;
    const totalTopics = results.reduce((sum, r) => sum + r.topics, 0);
    const elapsedMs = Date.now() - startedAt;

    console.log(
      `[TrendingWarmer] ✅ Finished in ${Math.round(elapsedMs / 1000)}s — ` +
      `${refreshed} refreshed, ${skipped} skipped (recently fresh or in cool-down), ${errored} errored, ` +
      `${totalTopics} topics across all keys`,
    );

    for (const r of results) {
      if (r.error) {
        console.warn(`[TrendingWarmer]   ✗ ${r.source}/${r.category} → error: ${r.error}`);
      } else if (!r.skipped) {
        console.log(`[TrendingWarmer]   ✓ ${r.source}/${r.category} → ${r.topics} topics`);
      }
    }
  } finally {
    warmerRunInFlight = false;
  }
}

export function startTrendingWarmer(): void {
  if (warmerStarted) {
    console.log('[TrendingWarmer] Already started, skipping');
    return;
  }
  warmerStarted = true;

  const intervalHours = (WARMER_INTERVAL_MS / 3_600_000).toFixed(1);
  console.log(
    `[TrendingWarmer] Scheduled — initial run in 30s, then every ${intervalHours}h ` +
    `| hot categories: ${HOT_CATEGORIES.join(', ')} ` +
    `| long-tail categories load on demand only`,
  );

  setTimeout(() => {
    runTrendingWarmer().catch(err => {
      console.error('[TrendingWarmer] Initial run failed:', err);
    });
  }, WARMER_INITIAL_DELAY_MS);

  warmerInterval = setInterval(() => {
    runTrendingWarmer().catch(err => {
      console.error('[TrendingWarmer] Periodic run failed:', err);
    });
  }, WARMER_INTERVAL_MS);
}

export function stopTrendingWarmer(): void {
  if (warmerInterval) {
    clearInterval(warmerInterval);
    warmerInterval = null;
  }
  warmerStarted = false;
  console.log('[TrendingWarmer] Stopped');
}
