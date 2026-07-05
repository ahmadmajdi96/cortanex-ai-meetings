#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  cp .env.example .env
fi

replace_secret() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" .env; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" .env
  else
    printf "%s=%s\n" "$key" "$value" >> .env
  fi
}

random_hex() {
  openssl rand -hex 32
}

replace_secret "RAG_API_KEYS" "$(random_hex)"
replace_secret "POSTGRES_PASSWORD" "$(random_hex)"
replace_secret "REDIS_PASSWORD" "$(random_hex)"
replace_secret "MINIO_ROOT_PASSWORD" "$(random_hex)"
replace_secret "QDRANT_API_KEY" "$(random_hex)"
replace_secret "GRAFANA_ADMIN_PASSWORD" "$(random_hex)"

rm -f .env.bak
echo "Updated .env with generated secrets."
