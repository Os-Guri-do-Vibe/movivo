#!/usr/bin/env bash
# =============================================================================
# MOVIVO — Deploy de produção na VPS (Docker Compose)
# =============================================================================
# Dono: Henrique (Platform/SRE)
#
# Uso (do Mac, na raiz do repo):
#   infra/vps/deploy.sh --build        constrói as imagens NA VPS a partir do commit
#                                      HEAD (git archive — só o que está commitado)
#   infra/vps/deploy.sh [SHA]          usa imagens já publicadas no GHCR (padrão: HEAD)
#   infra/vps/deploy.sh --rollback     volta api/web para a versão anterior
#
# --build é o caminho enquanto o pipeline GitHub Actions → GHCR não está no
# main; a imagem é a mesma (mesmo Dockerfile, mesma tag = SHA curto).
#
# O que vai para a VPS: compose, api.env, nginx/conf.d, infra/{postgres,
# pgbouncer,redis} e o backup — da ÁRVORE DE TRABALHO. Imagens: do COMMIT.
#
# Etapas: config → segredos → certificado → imagens → dados → migração → app
#         → timer de backup → smoke test pelo Cloudflare.
#
# Migrações são só para frente: --rollback troca a imagem, não desfaz schema.
# Toda migração precisa manter a versão anterior da API funcionando.
# =============================================================================
set -euo pipefail

VPS="${VPS:-deploy@187.127.40.87}"
APP_DIR=/opt/movivo
REGISTRY=ghcr.io/os-guri-do-vibe
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# Uma conexão SSH reaproveitada por todas as etapas.
ctl="$(mktemp -u "${TMPDIR:-/tmp}/movivo-ssh.XXXXXX")"
SSH=(ssh -o ControlMaster=auto -o ControlPath="$ctl" -o ControlPersist=120 "$VPS")

log() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }

build=0 rollback=0 version=""
for arg in "$@"; do
  case "$arg" in
    --build) build=1 ;;
    --rollback) rollback=1 ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    -*) die "opção desconhecida: $arg" ;;
    *) version="$arg" ;;
  esac
done

if [[ $rollback -eq 1 ]]; then
  log "Rollback de api/web"
  "${SSH[@]}" "set -e; cd ${APP_DIR}
    cur=\$(sed -n 's/^MOVIVO_VERSION=//p' .env); prev=\$(sed -n 's/^MOVIVO_PREVIOUS_VERSION=//p' .env)
    [ -n \"\$prev\" ] || { echo 'não há versão anterior registrada' >&2; exit 1; }
    printf 'MOVIVO_VERSION=%s\nMOVIVO_PREVIOUS_VERSION=%s\n' \"\$prev\" \"\$cur\" > .env
    docker compose up -d --wait --wait-timeout 180 api web
    echo \"api/web: \$cur → \$prev\""
  exit 0
fi

version="${version:-HEAD}"
git rev-parse --verify --quiet "${version}^{commit}" >/dev/null || die "commit ${version} não existe"
# Exatamente 7 caracteres (= ${GITHUB_SHA::7} do workflow), mesmo se o --short
# precisasse de mais para desambiguar.
version="$(git rev-parse "${version}^{commit}" | cut -c1-7)"

# -----------------------------------------------------------------------------
log "1/8 Configuração (versão ${version})"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"; ssh -o ControlPath="$ctl" -O exit "$VPS" 2>/dev/null || true' EXIT
mkdir -p "$stage/nginx/conf.d" "$stage/infra" "$stage/bin"
cp infra/vps/docker-compose.prod.yml "$stage/compose.yml"
cp infra/vps/api.env "$stage/api.env"
cp infra/vps/nginx/conf.d/movivo.conf "$stage/nginx/conf.d/"
cp -R infra/postgres infra/pgbouncer infra/redis "$stage/infra/"
cp infra/vps/backup/movivo-backup.sh infra/vps/backup/movivo-backup.service \
   infra/vps/backup/movivo-backup.timer "$stage/bin/"

# Faixas do Cloudflare (mesma fonte do hostinger-firewall.sh) → IP real e o
# filtro de origem do Nginx.
cf_v4="$(curl -fsS --max-time 15 https://www.cloudflare.com/ips-v4 | tr -d '\r' | grep -E '^[0-9./]+$')"
cf_v6="$(curl -fsS --max-time 15 https://www.cloudflare.com/ips-v6 | tr -d '\r' | grep -E '^[0-9a-f:./]+$')"
[[ $(wc -l <<<"$cf_v4") -ge 10 && $(wc -l <<<"$cf_v6") -ge 5 ]] || die "lista de IPs do Cloudflare suspeita"
for cidr in $cf_v4 $cf_v6; do echo "set_real_ip_from ${cidr};"; done > "$stage/nginx/conf.d/cloudflare-realip.inc"
for cidr in $cf_v4 $cf_v6; do echo "${cidr} 1;"; done > "$stage/nginx/conf.d/cloudflare-geo.inc"

# pgbouncer.ini e templates do Redis são bind mount de ARQUIVO: o container
# segura o inode antigo, então mudança neles exige recriar esses serviços.
COPYFILE_DISABLE=1 tar -C "$stage" --no-xattrs --no-mac-metadata -cf - \
    compose.yml api.env nginx infra bin \
  | "${SSH[@]}" "set -e; cd ${APP_DIR}
      before=\$(sha256sum infra/pgbouncer/pgbouncer.ini infra/redis/*.tpl 2>/dev/null || true)
      tar --no-overwrite-dir --warning=no-unknown-keyword -xf -
      chmod 755 bin/movivo-backup.sh
      after=\$(sha256sum infra/pgbouncer/pgbouncer.ini infra/redis/*.tpl)
      if [ -n \"\$before\" ] && [ \"\$before\" != \"\$after\" ]; then touch .recreate-data; fi"

# -----------------------------------------------------------------------------
log "2/8 Segredos"
"${SSH[@]}" 'bash -s' < infra/vps/gen-prod-secrets.sh
# Chaves de API de terceiros: as mesmas do dev (decisão de 2026-09-24). Copiadas
# só se ainda não existem na VPS — trocar uma delas é editar direto na VPS.
for key in asaas_api_key deepseek_api_key openai_api_key anthropic_api_key groq_api_key ararahq_api_key; do
  if "${SSH[@]}" "test -s ${APP_DIR}/secrets/${key}"; then
    echo "  = ${key} (já na VPS)"
    continue
  fi
  [[ -s "secrets/${key}" ]] || die "secrets/${key} não existe no Mac nem na VPS"
  "${SSH[@]}" "umask 022; cat > ${APP_DIR}/secrets/${key}; chmod 644 ${APP_DIR}/secrets/${key}" < "secrets/${key}"
  echo "  + ${key} (copiada do dev)"
done

# -----------------------------------------------------------------------------
log "3/8 Certificado da origem"
"${SSH[@]}" "test -s ${APP_DIR}/nginx/certs/origin.pem && test -s ${APP_DIR}/nginx/certs/origin.key" \
  || die "certificado ausente — rode antes: infra/vps/cloudflare-origin.sh"

# -----------------------------------------------------------------------------
log "4/8 Imagens"
api_image="${REGISTRY}/movivo-api:${version}"
web_image="${REGISTRY}/movivo-web:${version}"
if [[ $build -eq 1 ]]; then
  [[ "$(git rev-parse HEAD | cut -c1-7)" == "$version" ]] || die "--build só constrói o HEAD"
  git archive --format=tar "$version" \
    | "${SSH[@]}" "docker build -q -f apps/api/Dockerfile -t ${api_image} -"
  git archive --format=tar "$version" \
    | "${SSH[@]}" "docker build -q -f apps/web/Dockerfile \
        --build-arg NEXT_PUBLIC_APP_ENV=production \
        --build-arg NEXT_PUBLIC_SITE_URL=https://movivo.com.br \
        --build-arg NEXT_PUBLIC_API_URL=https://api.movivo.com.br/api/v1 \
        --build-arg NEXT_PUBLIC_ADMIN_URL=https://admin.movivo.com.br \
        -t ${web_image} -"
else
  # No Actions, o GITHUB_TOKEN do job autentica o pull e expira com o job; o
  # logout logo depois garante que nenhuma credencial fique na VPS.
  if [[ -n "${GHCR_TOKEN:-}" ]]; then
    printf '%s' "$GHCR_TOKEN" | "${SSH[@]}" "docker login ghcr.io -u github-actions --password-stdin >/dev/null"
  fi
  "${SSH[@]}" "docker image inspect ${api_image} >/dev/null 2>&1 || docker pull -q ${api_image}
    docker image inspect ${web_image} >/dev/null 2>&1 || docker pull -q ${web_image}
    docker logout ghcr.io >/dev/null 2>&1 || true"
fi

"${SSH[@]}" "set -e; cd ${APP_DIR}
  cur=\$(sed -n 's/^MOVIVO_VERSION=//p' .env 2>/dev/null || true)
  prev=\$(sed -n 's/^MOVIVO_PREVIOUS_VERSION=//p' .env 2>/dev/null || true)
  [ \"\$cur\" = '${version}' ] || prev=\"\$cur\"
  printf 'MOVIVO_VERSION=%s\nMOVIVO_PREVIOUS_VERSION=%s\n' '${version}' \"\$prev\" > .env"

# -----------------------------------------------------------------------------
log "5/8 Camada de dados"
"${SSH[@]}" "set -e; cd ${APP_DIR}
  docker compose up -d --wait --wait-timeout 300 \
    postgres pgbouncer redis-master redis-replica redis-sentinel evolution-postgres evolution-api
  if [ -f .recreate-data ]; then
    docker compose up -d --wait --wait-timeout 180 --force-recreate \
      pgbouncer redis-master redis-replica redis-sentinel
    rm -f .recreate-data
  fi"

log "6/8 Migração"
"${SSH[@]}" "cd ${APP_DIR} && docker compose run --rm migrate"

log "7/8 API, web e Nginx"
"${SSH[@]}" "set -e; cd ${APP_DIR}
  docker compose up -d --wait --wait-timeout 240 --remove-orphans
  docker compose exec -T nginx nginx -t -q
  docker compose exec -T nginx nginx -s reload
  docker compose ps --format 'table {{.Service}}\t{{.Image}}\t{{.Status}}'"

# -----------------------------------------------------------------------------
log "8/8 Backup diário e smoke test"
"${SSH[@]}" "set -e
  sudo install -m 644 ${APP_DIR}/bin/movivo-backup.service ${APP_DIR}/bin/movivo-backup.timer /etc/systemd/system/
  sudo systemctl daemon-reload
  sudo systemctl enable --now movivo-backup.timer >/dev/null
  systemctl list-timers movivo-backup.timer --no-pager | head -2"

smoke_ok=1
for url in https://api.movivo.com.br/api/v1/health https://movivo.com.br/; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$url" || true)"
  echo "  ${code}  ${url}"
  [[ "$code" == "200" ]] || smoke_ok=0
done
[[ $smoke_ok -eq 1 ]] || die "smoke test falhou (se é o 1º deploy, rode infra/vps/cloudflare-origin.sh --strict)"
log "Deploy ${version} no ar"
