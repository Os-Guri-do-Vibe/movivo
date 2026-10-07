#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/provision-security.py --environment local
docker compose up -d --no-deps vault
python3 scripts/provision-security.py --environment local --vault
docker compose up -d --build --wait --wait-timeout 600
if [ -n "$(docker compose ps -q api)" ]; then
  # Reattach sidecars after a possible API/web recreation (shared network namespace).
  docker compose up -d --no-deps --force-recreate --wait --wait-timeout 60 api-tls web-tls
fi
docker compose ps
