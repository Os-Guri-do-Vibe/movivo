#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/provision-security.py --environment local
docker compose up -d --no-deps vault
python3 scripts/provision-security.py --environment local --vault
docker compose up -d --build --wait --wait-timeout 600
docker compose ps
