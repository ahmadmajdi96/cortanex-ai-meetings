#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

TS="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="data/backups/${TS}"
mkdir -p "$OUT_DIR"

docker compose exec -T postgres pg_dump \
  -U "${POSTGRES_USER:-rag}" \
  -d "${POSTGRES_DB:-rag}" \
  > "${OUT_DIR}/postgres.sql"

echo "Wrote ${OUT_DIR}/postgres.sql"
