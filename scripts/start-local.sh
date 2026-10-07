#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" == Darwin ]] && ! fdesetup status | grep -q 'FileVault is On.'; then
  echo 'FileVault deve estar ativo antes de iniciar dados locais da MOVIVO.' >&2
  exit 1
fi
python3 scripts/provision-security.py --environment local
docker compose up -d --no-deps vault
python3 scripts/provision-security.py --environment local --vault
docker compose up -d --build --wait --wait-timeout 600
if [ -n "$(docker compose ps -q api)" ]; then
  # Reattach sidecars after a possible API/web recreation (shared network namespace).
  docker compose up -d --no-deps --force-recreate --wait --wait-timeout 60 api-tls web-tls
fi
docker compose ps
