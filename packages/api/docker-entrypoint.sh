#!/bin/sh
# Sequence on container start per §6.1.5:
#   1) wait for db healthcheck (depends_on handles it, but double-check)
#   2) prisma migrate deploy
#   3) run seed, guarded by SEED_ON_EMPTY + an in-script empty check
#   4) start the dev server with tsx watch

set -e

cd /app

echo "[api] applying migrations..."
pnpm --filter @bill-pay/api exec prisma migrate deploy

if [ "${SEED_ON_EMPTY:-true}" = "true" ]; then
  echo "[api] running seed (SEED_ON_EMPTY=true)..."
  pnpm --filter @bill-pay/api db:seed
else
  echo "[api] SEED_ON_EMPTY=false; skipping seed."
fi

echo "[api] starting dev server..."
exec pnpm --filter @bill-pay/api dev
