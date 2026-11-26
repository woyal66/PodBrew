/**
 * Per-provider quota / rate-limit circuit breaker.
 *
 * When a provider (Perplexity, xAI) returns a quota-exhausted or rate-limit
 * error we call setProviderCooldown() to suppress further calls to that
 * provider for PROVIDER_COOLDOWN_MS (default 6h). During cool-down every
 * TrendingCache fetch transparently falls back to Google News RSS instead.
 *
 * State is in-process only — no DB writes, resets on server restart, which is
 * fine: a fresh server boot is a natural cool-down reset.
 */

const PROVIDER_COOLDOWN_MS = parseInt(
  process.env.TRENDING_PROVIDER_COOLDOWN_MS ?? '',
  10,
) || 6 * 60 * 60 * 1000; // 6 hours

interface CooldownEntry {
  until: number;
  reason: string;
}

const cooldowns = new Map<string, CooldownEntry>();

/** True when an error looks like a quota exhaustion or hard rate limit. */
export function isQuotaError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    /insufficient.quota/i.test(msg) ||
    /exceeded.*quota/i.test(msg) ||
    /monthly.*spending.*limit/i.test(msg) ||
    /used all available credits/i.test(msg) ||
    // HTTP status prefix written by our callers: "Perplexity API 401 — …"
    /API 401/.test(msg) ||
    // xAI RateLimitError (429)
    /RateLimitError/.test(msg) ||
    /rate.limit/i.test(msg)
  );
}

/** Put a provider into cool-down for durationMs (default PROVIDER_COOLDOWN_MS). */
export function setProviderCooldown(
  provider: string,
  reason: string,
  durationMs: number = PROVIDER_COOLDOWN_MS,
): void {
  const until = Date.now() + durationMs;
  cooldowns.set(provider, { until, reason });
  const untilStr = new Date(until).toISOString();
  console.warn(`[QuotaGuard] 🔴 Provider "${provider}" in cool-down until ${untilStr} — ${reason}`);
}

/** True when the provider is currently in cool-down. */
export function isProviderInCooldown(provider: string): boolean {
  const entry = cooldowns.get(provider);
  if (!entry) return false;
  if (Date.now() >= entry.until) {
    cooldowns.delete(provider);
    console.log(`[QuotaGuard] 🟢 Provider "${provider}" cool-down expired, resuming`);
    return false;
  }
  return true;
}

/** Remaining cool-down milliseconds (0 if not in cool-down). */
export function providerCooldownRemaining(provider: string): number {
  const entry = cooldowns.get(provider);
  if (!entry) return 0;
  const remaining = entry.until - Date.now();
  if (remaining <= 0) {
    cooldowns.delete(provider);
    return 0;
  }
  return remaining;
}

/** Status snapshot for diagnostics / health endpoints. */
export function getProviderStatus(): Record<string, { cooldownUntil: number; remainingMs: number; reason: string } | { active: true }> {
  const out: Record<string, any> = {};
  const now = Date.now();
  for (const [provider, entry] of Array.from(cooldowns.entries())) {
    if (entry.until > now) {
      out[provider] = {
        cooldownUntil: entry.until,
        remainingMs: entry.until - now,
        reason: entry.reason,
      };
    }
  }
  return out;
}
