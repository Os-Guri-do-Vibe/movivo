#!/usr/bin/env bash
# Verifica o contrato operacional da Base de Conhecimento sem carregar (`source`)
# nenhum arquivo .env. O modo `runtime` acrescenta I/O real no stack Docker local.
set -uo pipefail

cd "$(dirname "$0")/.."

MODE="${1:-config}"
ENV_FILE="${KNOWLEDGE_ENV_FILE:-apps/api/.env}"
PASS=0
FAIL=0

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red() { printf '\033[31m%s\033[0m\n' "$1"; }

pass() {
  green "  PASS  $1"
  PASS=$((PASS + 1))
}

fail() {
  red "  FAIL  $1"
  FAIL=$((FAIL + 1))
}

check() {
  local description="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    pass "$description"
  else
    fail "$description"
  fi
}

# Ambiente do processo tem precedência. O parser abaixo aceita somente `CHAVE=valor`
# literal e nunca executa o conteúdo do arquivo, evitando command injection no verificador.
env_value() {
  local key="$1" fallback="$2" value
  if value="$(printenv "$key" 2>/dev/null)"; then
    printf '%s' "$value"
    return
  fi
  if [ -f "$ENV_FILE" ]; then
    value="$(awk -v wanted="$key" '
      index($0, wanted "=") == 1 { value = substr($0, length(wanted) + 2) }
      END { if (value != "") print value }
    ' "$ENV_FILE")"
    if [ -n "$value" ]; then
      printf '%s' "$value"
      return
    fi
  fi
  printf '%s' "$fallback"
}

max_bytes="$(env_value KNOWLEDGE_UPLOAD_MAX_BYTES 10485760)"

printf 'MOVIVO — readiness da Base de Conhecimento (%s)\n' "$MODE"

if printf '%s' "$max_bytes" | grep -Eq '^[0-9]+$' &&
  [ "$max_bytes" -ge 1024 ] && [ "$max_bytes" -le 10485760 ]; then
  pass "teto de upload está entre 1 KiB e 10 MiB"
else
  fail "KNOWLEDGE_UPLOAD_MAX_BYTES deve estar entre 1024 e 10485760"
fi

check "teto de upload versionado no .env.example da raiz" grep -q '^KNOWLEDGE_UPLOAD_MAX_BYTES=' .env.example
check "teto de upload versionado no .env.example da API" grep -q '^KNOWLEDGE_UPLOAD_MAX_BYTES=' apps/api/.env.example
check "fila knowledge-processing registrada no BullMQ" grep -q "knowledge-processing" apps/api/src/modules/jobs/jobs.config.ts
check "teto de upload é validado no boot" grep -q "KNOWLEDGE_UPLOAD_MAX_BYTES" apps/api/src/core/config/env.schema.ts

if [ "$MODE" = "runtime" ]; then
  check "Docker Compose é sintaticamente válido" docker compose config --quiet

  for service in postgres pgbouncer redis-master redis-sentinel; do
    container_id="$(docker compose ps -q "$service" 2>/dev/null)"
    if [ -n "$container_id" ] &&
      [ "$(docker inspect --format '{{.State.Health.Status}}' "$container_id" 2>/dev/null)" = healthy ]; then
      pass "serviço '$service' está healthy"
    else
      fail "serviço '$service' não está healthy"
    fi
  done

  check "Redis mantém noeviction para o BullMQ" docker compose exec -T redis-master sh -c \
    'test "$(REDISCLI_AUTH="$(cat /run/secrets/redis_password)" redis-cli --tls --cacert /run/secrets/internal_ca --sni localhost --raw CONFIG GET maxmemory-policy | tail -1)" = noeviction'

  table_check="$(docker compose exec -T postgres sh -c \
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "$1"' _ \
    "SELECT count(*) = 3 FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('knowledge_documents','knowledge_document_blobs','knowledge_base');" \
    2>/dev/null | tr -d '[:space:]')"
  if [ "$table_check" = "t" ]; then
    pass "tabelas persistentes da Base de Conhecimento existem"
  else
    fail "tabelas persistentes da Base de Conhecimento não estão completas"
  fi

  check "contadores das filas podem ser lidos sem payload" bash scripts/infra.sh knowledge-status
elif [ "$MODE" != "config" ]; then
  fail "modo desconhecido '$MODE' (use config ou runtime)"
fi

printf '\nResultado: %d passaram, %d falharam.\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
green "Gate operacional da Base de Conhecimento satisfeito."
