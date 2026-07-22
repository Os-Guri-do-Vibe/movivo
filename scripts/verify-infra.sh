#!/usr/bin/env bash
# =============================================================================
# MOVIVO — Verificação do ambiente local (Definição de Pronto da US-0.2)
# =============================================================================
# Dono: Henrique Matsuda (Platform/SRE) · US-0.2 / TASK-0.2.4
#
# Executa, contra o stack NO AR, todas as checagens que a DoD da US-0.2 exige —
# incluindo o checklist de segurança de Sato. Existe para que "está verde" seja
# um comando reproduzível por qualquer dev, e não um print colado num PR.
#
# Uso:  bash scripts/verify-infra.sh      (ou `make verify` / `pnpm run infra:verify`)
# Saída: relatório linha a linha; exit 1 se QUALQUER checagem falhar.
#
# Roda em Git Bash (Windows), WSL, Linux e macOS.
# =============================================================================
set -uo pipefail

cd "$(dirname "$0")/.."

# Evita a conversão automática de caminho do Git Bash no Windows, que
# transformaria "/run/secrets/..." em "C:/Program Files/Git/run/secrets/...".
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

DC="docker compose"
PASS=0
FAIL=0

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }

section() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

# check <descrição> <comando...> — o comando deve retornar 0 para passar.
check() {
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then
    green "  PASS  $desc"; PASS=$((PASS + 1))
  else
    red   "  FAIL  $desc"; FAIL=$((FAIL + 1))
  fi
}

# check_out <descrição> <regex esperado> <comando...>
check_out() {
  local desc="$1" expected="$2"; shift 2
  local out
  out="$("$@" 2>/dev/null)"
  if printf '%s' "$out" | grep -Eq "$expected"; then
    green "  PASS  $desc"; PASS=$((PASS + 1))
  else
    red   "  FAIL  $desc  (esperado /$expected/)"; FAIL=$((FAIL + 1))
  fi
}

psql_su()  { $DC exec -T postgres psql -U postgres -d movivo -tAc "$1"; }
redis_m()  { $DC exec -T redis-master   sh -c "redis-cli --no-auth-warning -a \"\$(cat /run/secrets/redis_password)\" $1"; }
redis_r()  { $DC exec -T redis-replica  sh -c "redis-cli --no-auth-warning -a \"\$(cat /run/secrets/redis_password)\" $1"; }
sentinel() { $DC exec -T redis-sentinel sh -c "redis-cli --no-auth-warning -a \"\$(cat /run/secrets/redis_password)\" -p 26379 $1"; }

echo "MOVIVO — verificação do ambiente local (US-0.2)"

# ---------------------------------------------------------------------------
section "1. Serviços e healthchecks"
for svc in postgres pgbouncer redis-master redis-replica redis-sentinel; do
  check_out "serviço '$svc' está healthy" '^healthy$' \
    bash -c "docker inspect --format '{{.State.Health.Status}}' \$($DC ps -q $svc)"
done

# ---------------------------------------------------------------------------
section "2. PostgreSQL — extensões (TASK-0.2.1)"
for ext in vector uuid-ossp pgcrypto; do
  check_out "extensão '$ext' instalada" '^1$' \
    psql_su "SELECT count(*) FROM pg_extension WHERE extname = '$ext';"
done

# ---------------------------------------------------------------------------
section "3. PostgreSQL — roles e regra inegociável #8"
check_out "role movivo_migrator existe"        '^1$' psql_su "SELECT count(*) FROM pg_roles WHERE rolname='movivo_migrator';"
check_out "role movivo_app existe"             '^1$' psql_su "SELECT count(*) FROM pg_roles WHERE rolname='movivo_app';"
check_out "movivo_app SEM BYPASSRLS"           '^f$' psql_su "SELECT rolbypassrls FROM pg_roles WHERE rolname='movivo_app';"
check_out "movivo_app NÃO é superusuário"      '^f$' psql_su "SELECT rolsuper FROM pg_roles WHERE rolname='movivo_app';"
check_out "movivo_migrator SEM BYPASSRLS"      '^f$' psql_su "SELECT rolbypassrls FROM pg_roles WHERE rolname='movivo_migrator';"
check_out "movivo_app não é dona de nenhuma tabela" '^0$' \
  psql_su "SELECT count(*) FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE r.rolname='movivo_app' AND c.relkind IN ('r','p');"
check_out "schema public pertence a movivo_migrator" '^movivo_migrator$' \
  psql_su "SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='public';"
check_out "movivo_app NÃO pode criar objetos em public" '^f$' \
  psql_su "SELECT has_schema_privilege('movivo_app','public','CREATE');"
check_out "movivo_app pode usar o schema public" '^t$' \
  psql_su "SELECT has_schema_privilege('movivo_app','public','USAGE');"

# ---------------------------------------------------------------------------
section "4. PgBouncer — transaction mode na 5433 (TASK-0.2.2)"
PGB_ADMIN() {
  $DC exec -T -e PGPASSWORD="$(cat secrets/postgres_migrator_password)" pgbouncer \
    psql -h 127.0.0.1 -p 5433 -U movivo_migrator -d pgbouncer -tAc "$1"
}
check_out "pool_mode = transaction"   'transaction' PGB_ADMIN "SHOW CONFIG;"
check_out "default_pool_size = 50"    '(^|\|)50(\||$)' bash -c "$DC exec -T -e PGPASSWORD=\"\$(cat secrets/postgres_migrator_password)\" pgbouncer psql -h 127.0.0.1 -p 5433 -U movivo_migrator -d pgbouncer -tAc 'SHOW CONFIG;' | grep '^default_pool_size'"
check_out "listen_port = 5433"        '(^|\|)5433(\||$)' bash -c "$DC exec -T -e PGPASSWORD=\"\$(cat secrets/postgres_migrator_password)\" pgbouncer psql -h 127.0.0.1 -p 5433 -U movivo_migrator -d pgbouncer -tAc 'SHOW CONFIG;' | grep '^listen_port'"
check_out "auth_file aponta para o Docker Secret" '/run/secrets/pgbouncer_userlist' bash -c "$DC exec -T -e PGPASSWORD=\"\$(cat secrets/postgres_migrator_password)\" pgbouncer psql -h 127.0.0.1 -p 5433 -U movivo_migrator -d pgbouncer -tAc 'SHOW CONFIG;' | grep '^auth_file'"
check_out "movivo_app conecta na 5433 e chega ao Postgres" '^movivo_app$' bash -c \
  "$DC exec -T -e PGPASSWORD=\"\$(cat secrets/postgres_app_password)\" pgbouncer psql -h 127.0.0.1 -p 5433 -U movivo_app -d movivo -tAc 'SELECT current_user;'"

# ---------------------------------------------------------------------------
section "5. Redis — CVE-2025-49844 (RediShell) e HA (TASK-0.2.3)"
# Versão mínima segura: 8.2.2 / 8.0.4 / 7.4.6 / 7.2.11.
REDIS_VER="$(redis_m 'INFO server' | tr -d '\r' | sed -n 's/^redis_version://p')"
echo "  (versão reportada pelo servidor: ${REDIS_VER:-DESCONHECIDA})"
check "Redis em versão patcheada contra a RediShell" bash -c '
  v="'"$REDIS_VER"'"
  [ -n "$v" ] || exit 1
  IFS=. read -r M m p <<EOF
$v
EOF
  case "$M.$m" in
    8.2) [ "$p" -ge 2 ] ;;
    8.0) [ "$p" -ge 4 ] ;;
    7.4) [ "$p" -ge 6 ] ;;
    7.2) [ "$p" -ge 11 ] ;;
    *)   [ "$M" -gt 8 ] || { [ "$M" -eq 8 ] && [ "$m" -gt 2 ]; } ;;
  esac'
check_out "AOF habilitado (appendonly yes)"   'yes'       redis_m "CONFIG GET appendonly"
check_out "appendfsync = everysec"            'everysec'  redis_m "CONFIG GET appendfsync"
check_out "maxmemory-policy = noeviction (exigido pelo BullMQ)" 'noeviction' redis_m "CONFIG GET maxmemory-policy"
check_out "master com 1 réplica conectada"    'connected_slaves:1' redis_m "INFO replication"
check_out "réplica com master_link_status:up" 'master_link_status:up' redis_r "INFO replication"
check_out "Sentinel monitora 'movivo-master'" 'movivo-master' sentinel "SENTINEL master movivo-master"
check_out "Sentinel enxerga 1 réplica"        '^1$' bash -c \
  "$DC exec -T redis-sentinel sh -c 'redis-cli --no-auth-warning -a \"\$(cat /run/secrets/redis_password)\" -p 26379 SENTINEL master movivo-master' | grep -A1 '^num-slaves\$' | tail -1 | tr -d '\r'"
check "Redis exige autenticação (NOAUTH sem senha)" bash -c \
  "! $DC exec -T redis-master redis-cli PING 2>&1 | grep -q PONG"

# ---------------------------------------------------------------------------
section "6. Checklist de segurança (Sato) — segredos e exposição"
# 6.1 Nenhum valor de secret pode aparecer no compose resolvido nem no inspect.
LEAK=0
for f in secrets/postgres_app_password secrets/postgres_migrator_password \
         secrets/postgres_superuser_password secrets/redis_password; do
  [ -s "$f" ] || continue
  val="$(tr -d '\r\n' < "$f")"
  if $DC config 2>/dev/null | grep -qF "$val"; then
    red "  FAIL  valor de $f aparece em 'docker compose config'"; LEAK=1
  fi
  if docker inspect $($DC ps -q) 2>/dev/null | grep -qF "$val"; then
    red "  FAIL  valor de $f aparece em 'docker inspect'"; LEAK=1
  fi
done
if [ "$LEAK" -eq 0 ]; then
  green "  PASS  nenhum valor de secret em 'docker compose config' nem em 'docker inspect'"
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
fi

# 6.2 Nenhuma porta pode estar publicada em 0.0.0.0 / :: (só loopback).
if $DC ps --format '{{.Ports}}' | grep -Eq '(^|[^0-9.])0\.0\.0\.0:|(^|[^:])\[::\]:'; then
  red "  FAIL  há porta publicada em 0.0.0.0/:: — deve ser apenas 127.0.0.1"
  $DC ps --format '{{.Name}} {{.Ports}}'
  FAIL=$((FAIL + 1))
else
  green "  PASS  todas as portas publicadas estão restritas a 127.0.0.1"
  PASS=$((PASS + 1))
fi

# 6.3 O secret está montado somente-leitura dentro do container.
check_out "secret montado read-only no postgres" 'true' bash -c \
  "docker inspect --format '{{range .Mounts}}{{if eq .Destination \"/run/secrets/postgres_app_password\"}}{{not .RW}}{{end}}{{end}}' \$($DC ps -q postgres)"

# 6.4 Nenhum arquivo de secret visível para o Git.
# Nota: `check_out` com regex '^$' NÃO serviria aqui — entrada vazia tem zero
# linhas e o grep nunca casa. A ausência de saída é testada com `test -z`.
check "nenhum secret rastreável pelo Git" bash -c \
  'test -z "$(git ls-files --cached --others --exclude-standard -- secrets/ | grep -v -E "^secrets/(README\.md|\.gitkeep)$")"'

# ---------------------------------------------------------------------------
printf '\n\033[1mResultado: %d passaram, %d falharam.\033[0m\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
green "Ambiente local verde — Definição de Pronto da US-0.2 satisfeita."
