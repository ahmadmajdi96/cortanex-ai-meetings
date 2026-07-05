#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
    cp .env.example .env
fi

replace_env() {
    local key="$1"
    local value="$2"

    perl -0pi -e "s#^${key}=.*#${key}=${value}#m" .env
}

replace_env JWT_APP_SECRET "$(openssl rand -hex 32)"
replace_env APP_AUTH_JWT_SECRET "$(openssl rand -hex 32)"

./gen-passwords.sh

echo "Generated .env secrets. Edit PUBLIC_URL, LETSENCRYPT_DOMAIN, LETSENCRYPT_EMAIL, CORTANEX_APP_URL, and CORS_ALLOWED_ORIGINS before production deploy."
