#!/usr/bin/env bash
# Self-check da seleção de imagens do prune: bash infra/vps/maintenance/movivo-docker-prune.test.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=movivo-docker-prune.sh
source "${here}/movivo-docker-prune.sh"

api="${REGISTRY}/movivo-api"
now=1000000
old=$((now - 86400))
recent=$((now - 60))

report="$(select_images aaaaaaa bbbbbbb "$now" 7200 <<EOF
P sha256:cur
P sha256:prev
P sha256:inuse
I ${api}:aaaaaaa sha256:cur ${old} 100
I ${api}:bbbbbbb sha256:prev ${old} 100
I ${api}:ccccccc sha256:old1 ${old} 300
I ${api}:ddddddd sha256:old1 ${old} 300
I ${api}:eeeeeee sha256:inuse ${old} 500
I ${api}:fffffff sha256:new ${recent} 700
I ${api}:aliascur sha256:cur ${old} 100
I ghcr.io/outra/movivo-api:ccccccc sha256:foreign ${old} 900
I ${REGISTRY}/movivo-web:ccccccc sha256:web1 ${old} 50
EOF
)"

expect() {
  grep -qxF "$1" <<<"$report" || { echo "FALHOU: esperava '$1'" >&2; echo "$report" >&2; exit 1; }
}

expect "KEEP ${api}:aaaaaaa versao-atual"
expect "KEEP ${api}:bbbbbbb versao-anterior"
expect "KEEP ${api}:eeeeeee em-uso-ou-mesmo-id-protegido"
expect "KEEP ${api}:aliascur em-uso-ou-mesmo-id-protegido"
expect "KEEP ${api}:fffffff recente"
expect "KEEP ghcr.io/outra/movivo-api:ccccccc fora-do-escopo"
expect "REMOVE ${api}:ccccccc sha256:old1 300"
expect "REMOVE ${api}:ddddddd sha256:old1 300"
expect "REMOVE ${REGISTRY}/movivo-web:ccccccc sha256:web1 50"
# old1 (duas tags) conta uma vez: 300 + 50
expect "ESTIMATE 350 2"

# Sem versão atual, falha antes de qualquer chamada ao Docker.
env_file="$(mktemp)"
trap 'rm -f "$env_file"' EXIT
printf 'COMPOSE_PROFILES=app\nMOVIVO_PREVIOUS_VERSION=bbbbbbb\n' > "$env_file"
if out="$(PATH=/usr/bin:/bin MOVIVO_ENV_FILE="$env_file" /bin/bash -c 'source "$1"; prune_versioned_images 0' _ "${here}/movivo-docker-prune.sh" 2>&1)"; then
  echo "FALHOU: deveria falhar sem MOVIVO_VERSION" >&2
  exit 1
fi
grep -q 'MOVIVO_VERSION ausente' <<<"$out" || { echo "FALHOU: mensagem inesperada: $out" >&2; exit 1; }

echo "ok: seleção de imagens do prune"
