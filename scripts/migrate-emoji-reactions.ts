/**
 * One-shot data migration: collapse legacy emoji reactions
 * (fire, insight, fun, wow) into the new like/dislike model.
 *
 * Every non-skip row in `podcast_likes` is rewritten to
 * reactionType='listen'. Skip rows (dislikes) are left alone.
 *
 * This script is idempotent — running it again is a no-op once all rows
 * are already in {'listen', 'skip'}.
 *
 * Safe to run before or after `db:push`: it only touches the
 * `podcast_likes.reaction_type` column, which is unaffected by the
 * column drops on `podcast_engagement` that are part of this change.
 *
 * Usage: npx tsx scripts/migrate-emoji-reactions.ts
 */
import { count, notInArray } from "drizzle-orm";
import { db } from "../server/db";
import { podcastLikes } from "../shared/schema";

const KEPT_REACTIONS = ["listen", "skip"] as const;

async function main() {
  console.log("[migrate-emoji-reactions] Counting legacy rows...");

  const legacyByType = await db
    .select({
      reactionType: podcastLikes.reactionType,
      count: count(),
    })
    .from(podcastLikes)
    .where(notInArray(podcastLikes.reactionType, [...KEPT_REACTIONS]))
    .groupBy(podcastLikes.reactionType);

  if (legacyByType.length === 0) {
    console.log("[migrate-emoji-reactions] No legacy rows found. Nothing to do.");
    return;
  }
  console.log("[migrate-emoji-reactions] Legacy reaction counts:", legacyByType);

  const totalLegacy = legacyByType.reduce((sum, row) => sum + Number(row.count), 0);

  await db
    .update(podcastLikes)
    .set({
      reactionType: "listen",
      updatedAt: new Date(),
    })
    .where(notInArray(podcastLikes.reactionType, [...KEPT_REACTIONS]));

  console.log(
    `[migrate-emoji-reactions] Updated ${totalLegacy} rows to reaction_type='listen'.`,
  );
}

main()
  .then(() => {
    console.log("[migrate-emoji-reactions] Done.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("[migrate-emoji-reactions] Failed:", err);
    process.exit(1);
  });
