#!/usr/bin/env bash
# =============================================================================
# MOVIVO — Atalhos interativos do ambiente local (equivalente multiplataforma
# dos alvos do Makefile que precisam ler um secret).
# =============================================================================
# Dono: Henrique Matsuda (Platform/SRE) · US-0.2 / TASK-0.2.4
#
# Uso:  bash scripts/infra.sh <comando>
#       (ou `pnpm run infra:psql`, `infra:pools`, `infra:redis`, ...)
#
# Existe porque `make` não está disponível por padrão no Windows, mas todos
# estes comandos precisam injetar uma senha lida de `secrets/` — algo que não
# cabe num campo "scripts" do package.json de forma portável.
#
# A senha é passada por variável de ambiente do `docker compose exec` (processo
# efêmero) e NUNCA é escrita em arquivo, log ou no compose. Ela não aparece em
# `docker inspect` porque não é parte da definição do serviço.
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1   # Git Bash: não converter /run/secrets/... em C:\...

read_secret() {
  local path="secrets/$1"
  if [ ! -s "$path" ]; then
    echo "ERRO: secret '$path' ausente ou vazio. Rode: pnpm run infra:secrets" >&2
    exit 1
  fi
  tr -d '\r\n' < "$path"
}

case "${1:-help}" in
  # Caminho da APLICAÇÃO: role movivo_app, sempre via PgBouncer na 5433.
  psql)
    exec docker compose exec -e PGPASSWORD="$(read_secret postgres_app_password)" \
      pgbouncer psql -h 127.0.0.1 -p 5433 -U movivo_app -d movivo "${@:2}"
    ;;

  # Caminho de MIGRAÇÃO/DDL: role movivo_migrator, direto na 5432.
  # Nunca use este atalho para simular o comportamento da aplicação — ele
  # ignora o pooler e tem privilégios que a app não tem.
  psql-admin)
    exec docker compose exec -e PGPASSWORD="$(read_secret postgres_migrator_password)" \
      postgres psql -h 127.0.0.1 -p 5432 -U movivo_migrator -d movivo "${@:2}"
    ;;

  # Console administrativo do PgBouncer — confirma pool_mode/estado dos pools.
  pools)
    exec docker compose exec -e PGPASSWORD="$(read_secret postgres_migrator_password)" \
      pgbouncer psql -h 127.0.0.1 -p 5433 -U movivo_migrator -d pgbouncer -c 'SHOW POOLS;'
    ;;

  stats)
    exec docker compose exec -e PGPASSWORD="$(read_secret postgres_migrator_password)" \
      pgbouncer psql -h 127.0.0.1 -p 5433 -U movivo_migrator -d pgbouncer -c 'SHOW STATS;'
    ;;

  # A senha é lida DENTRO do container, a partir do secret montado — assim ela
  # não transita pelo shell do host.
  redis-cli)
    exec docker compose exec redis-master sh -c \
      'redis-cli --no-auth-warning -a "$(cat /run/secrets/redis_password)"'
    ;;

  sentinel)
    exec docker compose exec -T redis-sentinel sh -c \
      'redis-cli --no-auth-warning -a "$(cat /run/secrets/redis_password)" -p 26379 sentinel master movivo-master'
    ;;

  # Contadores operacionais sem payload, título de documento ou PII. Os nomes das
  # chaves seguem o prefixo central do BullMQ; este comando é diagnóstico local,
  # não substitui as métricas/alertas definidos no runbook de produção.
  knowledge-status)
    key_prefix="${REDIS_KEY_PREFIX:-}"
    if [ -z "$key_prefix" ] && [ -f .env ]; then
      key_prefix="$(awk -F= '$1 == "REDIS_KEY_PREFIX" { value=$2 } END { print value }' .env)"
    fi
    key_prefix="${key_prefix:-movivo}:bull"
    exec docker compose exec -T -e MOVIVO_KB_QUEUE_KEY="$key_prefix:knowledge-processing" \
      -e MOVIVO_DLQ_KEY="$key_prefix:dead-letter" redis-master sh -c '
        set -eu
        redis() {
          redis-cli --no-auth-warning -a "$(cat /run/secrets/redis_password)" --raw "$@"
        }
        count_key() {
          kind="$(redis TYPE "$1")"
          case "$kind" in
            list) redis LLEN "$1" ;;
            zset) redis ZCARD "$1" ;;
            set) redis SCARD "$1" ;;
            none) printf "0\n" ;;
            *) printf "n/a\n" ;;
          esac
        }
        printf "queue\tstate\tcount\n"
        for state in wait active delayed failed paused; do
          printf "knowledge-processing\t%s\t%s\n" "$state" "$(count_key "$MOVIVO_KB_QUEUE_KEY:$state")"
        done
        for state in wait active delayed failed; do
          printf "dead-letter\t%s\t%s\n" "$state" "$(count_key "$MOVIVO_DLQ_KEY:$state")"
        done
      '
    ;;

  *)
    cat <<'EOF'
MOVIVO — scripts/infra.sh

  psql         psql como movivo_app VIA PGBOUNCER (5433) — o caminho da aplicação
  psql-admin   psql como movivo_migrator DIRETO na 5432 — só migração/DDL
  pools        SHOW POOLS no console admin do PgBouncer
  stats        SHOW STATS no console admin do PgBouncer
  redis-cli    redis-cli autenticado no master
  sentinel     estado do master conforme o Sentinel
  knowledge-status  contadores (sem payload) da ingestão e DLQ

Ciclo de vida do stack: pnpm run infra:up | infra:down | infra:reset | infra:verify
EOF
    ;;
esac
