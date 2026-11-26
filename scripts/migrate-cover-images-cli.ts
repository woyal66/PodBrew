/**
 * Command-line entrypoint for the inline cover-image migration.
 *
 * Why this file exists:
 *   The migration logic itself lives in
 *   `scripts/migrate-cover-images-to-storage.ts` as a PURE library
 *   module — no `process.exit`, no top-level side effects — so it
 *   can be safely imported by server code (e.g. the boot-time
 *   self-heal in `server/storage.ts`) even when esbuild bundles it
 *   into `dist/index.js`. This wrapper is the ONLY place that calls
 *   `process.exit`, which means a future bundling change cannot
 *   accidentally drag exit-code logic into the running server.
 *
 * Usage:
 *   npx tsx scripts/migrate-cover-images-cli.ts
 *
 * Exit codes:
 *   0 — migration completed (rows may have been skipped for manual
 *       review; that does not fail the job).
 *   1 — at least one row failed to upload, or an unexpected error
 *       was thrown. Re-run after remediation.
 */
import { migrateInlineCoverImages } from "./migrate-cover-images-to-storage";

migrateInlineCoverImages()
  .then((result) => {
    process.exit(result.failed > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error("[migrate-cover-images] Fatal error:", err);
    process.exit(1);
  });
