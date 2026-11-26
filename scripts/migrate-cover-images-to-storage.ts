/**
 * One-shot data migration: move legacy inline `data:image/...;base64,...`
 * cover URIs out of `generated_podcasts.cover_image_url` into the public
 * object-storage bucket, and replace the column with the resulting
 * public URL.
 *
 * Why: list endpoints (Library, Discover) intentionally drop inline
 * data URIs to keep the payload small (see `slimCoverImageUrl` /
 * `stripDataUriCover` in `server/storage.ts`). That means legacy rows
 * whose cover art is still stored as a `data:` URI render the
 * placeholder waveform on the grid even though the bytes exist in
 * Postgres. Migrating them to object storage shrinks the column to a
 * ~120-char URL that flows through list endpoints normally.
 *
 * Idempotent: it only touches rows whose `cover_image_url` still starts
 * with `data:`, so re-running is a no-op once every legacy row has
 * been migrated. Failures on individual rows do not abort the batch.
 *
 * IMPORTANT: this file is a PURE library module — no top-level side
 * effects, no `process.exit`. It is safe to import from any server
 * code (including the boot-time self-heal in `server/storage.ts`)
 * even when esbuild bundles it into `dist/index.js` alongside the
 * server. The command-line entrypoint lives in a separate file:
 * `scripts/migrate-cover-images-cli.ts` — that wrapper is the ONLY
 * place that handles exit codes. Run it with:
 *
 *   npx tsx scripts/migrate-cover-images-cli.ts
 *
 * Background: an earlier version of this file contained the CLI
 * wrapper inline, guarded first by an `import.meta.url` check and
 * later by a `MIGRATE_COVER_IMAGES_CLI=1` env flag. Both approaches
 * were footguns — the URL check fired at server startup once the
 * file was bundled (causing a `process.exit()` boot loop in
 * production), and the env flag silently turned CLI invocations
 * into no-ops if anyone forgot to set it. Splitting the CLI into a
 * separate entry file removes both failure modes structurally.
 */
import { asc, eq, like, sql } from "drizzle-orm";
import { db } from "../server/db";
import { generatedPodcasts } from "../shared/schema";
import { ObjectStorageService } from "../server/objectStorage";

const BATCH_SIZE = 25;
const CANDIDATE_PAGE_SIZE = 500;

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

function extForMime(mime: string): string {
  const normalized = mime.toLowerCase().split(";")[0].trim();
  return MIME_TO_EXT[normalized] ?? "png";
}

export interface MigrateInlineCoverImagesResult {
  total: number;
  candidates: number;
  processed: number;
  migrated: number;
  skipped: number;
  failed: number;
  remaining: number;
  skippedIds: string[];
  failedIds: string[];
}

/**
 * Find every `generated_podcasts` row whose `cover_image_url` still
 * starts with `data:`, upload the decoded bytes to public object
 * storage, and rewrite the column to the resulting public URL.
 *
 * Idempotent: returns immediately when no inline rows exist. Per-row
 * failures are caught and reported in the result rather than thrown,
 * so callers (CLI and server-boot self-heal) can decide how to react.
 */
export async function migrateInlineCoverImages(): Promise<MigrateInlineCoverImagesResult> {
  const objectStorage = new ObjectStorageService();

  const totalRow = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(generatedPodcasts)
    .where(like(generatedPodcasts.coverImageUrl, "data:%"));
  const total = Number(totalRow[0]?.count ?? 0);

  if (total === 0) {
    console.log(
      "[migrate-cover-images] No rows with inline data: URIs found. Nothing to do.",
    );
    return {
      total: 0,
      candidates: 0,
      processed: 0,
      migrated: 0,
      skipped: 0,
      failed: 0,
      remaining: 0,
      skippedIds: [],
      failedIds: [],
    };
  }

  console.log(
    `[migrate-cover-images] Found ${total} podcast row(s) with inline cover URIs. Migrating...`,
  );

  // Snapshot the candidate IDs up-front, paged by primary key, so each
  // row is touched at most once even if its upload fails. This keeps
  // the job a true one-shot: failed rows are reported at the end and
  // the run terminates instead of looping forever on the same row.
  const candidateIds: string[] = [];
  let cursor: string | null = null;
  while (true) {
    const page = await db
      .select({ id: generatedPodcasts.id })
      .from(generatedPodcasts)
      .where(
        cursor === null
          ? like(generatedPodcasts.coverImageUrl, "data:%")
          : sql`${generatedPodcasts.coverImageUrl} LIKE 'data:%' AND ${generatedPodcasts.id} > ${cursor}`,
      )
      .orderBy(asc(generatedPodcasts.id))
      .limit(CANDIDATE_PAGE_SIZE);

    if (page.length === 0) break;
    for (const row of page) candidateIds.push(row.id);
    cursor = page[page.length - 1].id;
    if (page.length < CANDIDATE_PAGE_SIZE) break;
  }

  let processed = 0;
  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  const failedIds: string[] = [];
  const skippedIds: string[] = [];

  for (let offset = 0; offset < candidateIds.length; offset += BATCH_SIZE) {
    const ids = candidateIds.slice(offset, offset + BATCH_SIZE);
    const batch = await db
      .select({
        id: generatedPodcasts.id,
        coverImageUrl: generatedPodcasts.coverImageUrl,
      })
      .from(generatedPodcasts)
      .where(
        sql`${generatedPodcasts.id} IN (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `,
        )}) AND ${generatedPodcasts.coverImageUrl} LIKE 'data:%'`,
      );

    for (const row of batch) {
      processed++;
      const uri = row.coverImageUrl ?? "";
      const match = uri.match(/^data:([^;,]+)(?:;[^,]*)?,(.+)$/);
      if (!match) {
        skipped++;
        skippedIds.push(row.id);
        console.warn(
          `[migrate-cover-images] Row ${row.id}: unrecognized data URI format, leaving untouched for manual review.`,
        );
        continue;
      }

      const mimeType = match[1] || "image/png";
      const payload = match[2];

      try {
        const buffer = Buffer.from(payload, "base64");
        if (buffer.length === 0) {
          skipped++;
          skippedIds.push(row.id);
          console.warn(
            `[migrate-cover-images] Row ${row.id}: empty payload, leaving untouched for manual review.`,
          );
          continue;
        }

        const ext = extForMime(mimeType);
        const filename = `migrated-${row.id}.${ext}`;
        const publicUrl = await objectStorage.uploadPublicObject(
          `covers/${filename}`,
          buffer,
          mimeType.toLowerCase().split(";")[0].trim(),
        );

        await db
          .update(generatedPodcasts)
          .set({ coverImageUrl: publicUrl })
          .where(eq(generatedPodcasts.id, row.id));

        migrated++;
        if (migrated % 10 === 0 || migrated === total) {
          console.log(
            `[migrate-cover-images] Progress: ${migrated} migrated / ${processed} processed`,
          );
        }
      } catch (err) {
        failed++;
        failedIds.push(row.id);
        console.error(
          `[migrate-cover-images] Row ${row.id}: failed to migrate -`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  // Post-run verification so we can confirm completion (or surface
  // remaining work) directly from the script's output.
  const remainingRow = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(generatedPodcasts)
    .where(like(generatedPodcasts.coverImageUrl, "data:%"));
  const remaining = Number(remainingRow[0]?.count ?? 0);

  console.log("[migrate-cover-images] Done.");
  console.log(`  candidates: ${candidateIds.length}`);
  console.log(`  processed:  ${processed}`);
  console.log(`  migrated:   ${migrated}`);
  console.log(`  skipped:    ${skipped}`);
  console.log(`  failed:     ${failed}`);
  console.log(`  remaining:  ${remaining}`);

  if (skippedIds.length > 0) {
    console.log(
      `[migrate-cover-images] Skipped row IDs (manual review required):`,
    );
    for (const id of skippedIds) console.log(`  - ${id}`);
  }
  if (failedIds.length > 0) {
    console.log(
      `[migrate-cover-images] Failed row IDs (re-run after remediation):`,
    );
    for (const id of failedIds) console.log(`  - ${id}`);
  }

  return {
    total,
    candidates: candidateIds.length,
    processed,
    migrated,
    skipped,
    failed,
    remaining,
    skippedIds,
    failedIds,
  };
}
