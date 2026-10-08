#!/usr/bin/env bash
# Remove somente artefatos Docker sem uso; volumes e containers ficam intactos.
set -euo pipefail

readonly RETENTION=168h

echo "[movivo/docker-prune] antes"
docker system df

# Cache sem uso pode ser reconstruído pelo BuildKit. A retenção de sete dias
# evita jogar fora o cache dos deploys recentes.
docker builder prune --all --force --filter "until=${RETENTION}"

# Sem --all: remove apenas imagens dangling, nunca imagens versionadas que ainda
# podem servir para rollback ou que algum container referencia.
docker image prune --force --filter "until=${RETENTION}"

echo "[movivo/docker-prune] depois"
docker system df
