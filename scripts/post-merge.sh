#!/bin/bash
set -e
npm install
npm run db:push
# Collapse legacy emoji reactions (fire/insight/fun/wow) into 'listen'.
# Idempotent and safe to run after db:push — touches only podcast_likes.reaction_type.
npx tsx scripts/migrate-emoji-reactions.ts
# Recompute hot scores under the new confidence-aware formula so the
# trending feed reflects the updated ranking. Idempotent.
npx tsx scripts/backfill-hot-scores.ts
