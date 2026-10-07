#!/usr/bin/env bash
# Renovação somente quando certificados entram na janela de 30 dias.
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/movivo}"
cd "$APP_DIR"
before="$(sha256sum secrets/internal_tls/*.crt)"
python3 bin/provision-security.py --root "$APP_DIR" --environment production
after="$(sha256sum secrets/internal_tls/*.crt)"
[[ "$before" != "$after" ]] || exit 0
# Bind mounts retêm inodes: recriar carrega os novos certificados.
docker compose up -d --no-deps --force-recreate vault
python3 bin/provision-security.py --root "$APP_DIR" --environment production --vault
docker compose up -d --wait --wait-timeout 300 --force-recreate \
  postgres evolution-postgres pgbouncer redis-master redis-replica redis-sentinel evolution-api
docker compose up -d --wait --wait-timeout 300 --force-recreate api web api-tls web-tls vault-token-renewer nginx

docker compose up -d --no-deps --force-recreate --wait --wait-timeout 60 api-tls web-tls
