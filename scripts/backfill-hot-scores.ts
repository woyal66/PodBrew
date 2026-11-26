/**
 * Backfill hot scores for every podcast (public and private) using the
 * current `updateEngagementScore` implementation. Run after the hot-score
 * formula changes so existing engagement rows get rescored under the new
 * logic. Private podcasts are included too so their scores stay correct
 * if they're ever flipped public later.
 *
 * Idempotent: re-running it just recomputes scores from current counts.
 *
 * Usage: npx tsx scripts/backfill-hot-scores.ts
 */
import { db } from "../server/db";
import { generatedPodcasts } from "../shared/schema";
import { storage } from "../server/storage";

async function main() {
  console.log("[backfill-hot-scores] Loading podcasts...");

  const podcasts = await db
    .select({ id: generatedPodcasts.id })
    .from(generatedPodcasts);

  console.log(`[backfill-hot-scores] Rescoring ${podcasts.length} podcasts.`);

  let done = 0;
  let failed = 0;
  for (const { id } of podcasts) {
    try {
      await storage.updateEngagementScore(id);
      done += 1;
      if (done % 100 === 0) {
        console.log(`[backfill-hot-scores] ${done}/${podcasts.length} rescored`);
      }
    } catch (err) {
      failed += 1;
      console.warn(`[backfill-hot-scores] Failed for ${id}:`, err);
    }
  }

  console.log(
    `[backfill-hot-scores] Complete. Rescored ${done}, failed ${failed}.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill-hot-scores] Fatal:", err);
    process.exit(1);
  });
