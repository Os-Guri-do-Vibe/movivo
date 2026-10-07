#!/usr/bin/env bash
# =============================================================================
# MOVIVO — Teste de restauração dos backups (Postgres, EvolutionAPI, uploads)
# =============================================================================
# Dono: Henrique (Platform/SRE)
#
# Backup que nunca foi restaurado não é backup. Este script pega o dump MAIS
# RECENTE de cada banco, decifra e restaura num Postgres descartável (mesma
# imagem da produção, sem rede, dados em tmpfs), confere o resultado e destrói
# o container. Não toca em nenhum serviço nem volume de produção.
#
# Disparado pelo movivo-restore-test.timer (domingo 04:30 BRT, depois do backup
# das 03:30). Resultado em /opt/movivo/backups/restore-test.status e no journal.
# Sai com código != 0 se: o último backup estiver velho demais, a chave não
# decifrar, o pg_restore falhar ou o banco restaurado vier vazio/sem RLS.
# =============================================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/movivo/backups}"
KEY_FILE="${KEY_FILE:-/opt/movivo/secrets/backup_encryption_key}"
STATUS_FILE="${BACKUP_DIR}/restore-test.status"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-36}"
CONTAINER="movivo-restore-test-$$"

umask 077
[[ -s "$KEY_FILE" ]] || { echo "ERRO: ${KEY_FILE} ausente" >&2; exit 1; }

log() { echo "[restore-test] $*"; }

RESTORE_SUMMARY=""
# Roda no EXIT (com `set -e` ativo no corpo): $? é o código real da execução.
finish() {
  local rc=$?
  docker rm -f -v "$CONTAINER" >/dev/null 2>&1 || true
  if (( rc == 0 )); then
    echo "$(date -Is) OK${RESTORE_SUMMARY}" > "$STATUS_FILE"
    log "OK"
  else
    echo "$(date -Is) FALHA" > "$STATUS_FILE"
    log "FALHA — veja o journal (journalctl -u movivo-restore-test.service)" >&2
  fi
}
trap finish EXIT

decrypt() {
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:${KEY_FILE}" -in "$1"
}

newest() { ls -1t "${BACKUP_DIR}/${1}"-[0-9]*."${2}" 2>/dev/null | head -n1 || true; }

assert_fresh() {
  local file="$1" age_h
  [[ -n "$file" && -f "$file" ]] || { echo "ERRO: nenhum backup encontrado" >&2; return 1; }
  age_h=$(( ($(date +%s) - $(stat -c %Y "$file")) / 3600 ))
  log "$(basename "$file") — ${age_h}h de idade"
  (( age_h <= MAX_AGE_HOURS )) || { echo "ERRO: $(basename "$file") tem ${age_h}h (limite ${MAX_AGE_HOURS}h) — o backup diário parou?" >&2; return 1; }
}

# restore_db <rótulo> <container-vivo> <superusuário> <banco> <tmpfs> <arquivo> [roles extras…]
restore_db() {
  local label="$1" live="$2" su="$3" db="$4" tmpfs="$5" file="$6"; shift 6
  local image
  image="$(docker inspect -f '{{.Config.Image}}' "$live")"
  log "${label}: restaurando em ${image} descartável"

  docker run -d --name "$CONTAINER" --network none --memory 1g \
    --tmpfs "${tmpfs}:rw,size=1g" \
    -e POSTGRES_USER="$su" -e POSTGRES_DB="$db" -e POSTGRES_PASSWORD=restore-test \
    "$image" >/dev/null
  for _ in $(seq 1 60); do
    [[ "$(docker logs "$CONTAINER" 2>&1)" == *"ready to accept connections"* ]] \
      && docker exec "$CONTAINER" pg_isready -U "$su" -q && break
    sleep 1
  done
  docker exec "$CONTAINER" pg_isready -U "$su" -q || { echo "ERRO: Postgres de teste não subiu" >&2; return 1; }

  local role
  for role in "$@"; do
    docker exec "$CONTAINER" psql -U "$su" -d "$db" -qAtc "CREATE ROLE ${role} NOLOGIN"
  done

  # Sem --clean: o banco de teste nasce vazio. --exit-on-error: qualquer erro reprova.
  decrypt "$file" | docker exec -i "$CONTAINER" pg_restore -U "$su" -d "$db" --exit-on-error --no-password

  local q_tables="select count(*) from information_schema.tables where table_schema not in ('pg_catalog','information_schema') and table_type='BASE TABLE'"
  local q_rls="select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relrowsecurity and n.nspname not in ('pg_catalog','information_schema')"
  local q_rows="select coalesce(sum((xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint),0) from information_schema.tables where table_schema not in ('pg_catalog','information_schema') and table_type='BASE TABLE'"
  local t_rest t_live rls_rest rls_live rows_rest
  t_rest="$(docker exec "$CONTAINER" psql -U "$su" -d "$db" -qAtc "$q_tables")"
  t_live="$(docker exec "$live" psql -U "$su" -d "$db" -qAtc "$q_tables")"
  rls_rest="$(docker exec "$CONTAINER" psql -U "$su" -d "$db" -qAtc "$q_rls")"
  rls_live="$(docker exec "$live" psql -U "$su" -d "$db" -qAtc "$q_rls")"
  rows_rest="$(docker exec "$CONTAINER" psql -U "$su" -d "$db" -qAtc "$q_rows")"
  log "${label}: tabelas restore=${t_rest} vivo=${t_live} · RLS restore=${rls_rest} vivo=${rls_live} · linhas restauradas=${rows_rest}"

  (( t_rest > 0 )) || { echo "ERRO: ${label} restaurou sem nenhuma tabela" >&2; return 1; }
  (( rls_rest == rls_live || t_rest != t_live )) \
    || { echo "ERRO: ${label} perdeu políticas de RLS no restore (${rls_rest} ≠ ${rls_live})" >&2; return 1; }
  (( t_rest == t_live )) || log "AVISO: ${label} difere do banco vivo — normal se houve migração depois do backup"

  if [[ "$label" == movivo ]]; then
    local ext
    for ext in vector pgcrypto uuid-ossp; do
      [[ "$(docker exec "$CONTAINER" psql -U "$su" -d "$db" -qAtc "select 1 from pg_extension where extname='${ext}'")" == 1 ]] \
        || { echo "ERRO: extensão ${ext} ausente após o restore" >&2; return 1; }
    done
    (( rls_rest > 0 )) || { echo "ERRO: banco principal restaurado sem RLS" >&2; return 1; }
  fi

  RESTORE_SUMMARY+=" ${label}=$(basename "$file"):tabelas=${t_rest},linhas=${rows_rest}"
  docker rm -f -v "$CONTAINER" >/dev/null
}

run() {
  local movivo_dump evolution_dump uploads_tar vault_snapshot vault_tmp
  movivo_dump="$(newest movivo dump.enc)"
  evolution_dump="$(newest evolution dump.enc)"
  uploads_tar="$(newest uploads tar.enc)"

  assert_fresh "$movivo_dump"
  assert_fresh "$evolution_dump"
  assert_fresh "$uploads_tar"

  restore_db movivo movivo-postgres postgres movivo /var/lib/postgresql/data "$movivo_dump" movivo_app movivo_migrator
  restore_db evolution movivo-evolution-postgres evolution evolution /var/lib/postgresql "$evolution_dump"

  decrypt "$uploads_tar" | tar -tf - >/dev/null
  log "uploads: arquivo tar íntegro"

  vault_snapshot="$(newest vault snapshot.enc)"
  assert_fresh "$vault_snapshot"
  vault_tmp="$(mktemp "${BACKUP_DIR}/.vault-restore.XXXXXX")"
  if decrypt "$vault_snapshot" > "$vault_tmp" && python3 /opt/movivo/bin/verify-vault-restore.py \
      --root /opt/movivo --environment production --snapshot "$vault_tmp"; then
    RESTORE_SUMMARY+=" vault=$(basename "$vault_snapshot"):restore=ok"
    rm -f "$vault_tmp"
  else
    rm -f "$vault_tmp"; return 1
  fi
}

run
