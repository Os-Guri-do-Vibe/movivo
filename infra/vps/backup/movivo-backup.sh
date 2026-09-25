#!/usr/bin/env bash
# =============================================================================
# MOVIVO — Backup diário cifrado (Postgres + EvolutionAPI + uploads)
# =============================================================================
# Dono: Henrique (Platform/SRE)
#
# Instalado na VPS em /opt/movivo/bin/ e disparado pelo movivo-backup.timer
# (03:30 BRT). Decisão de 2026-09-24: sem storage externo — a cópia fora da VPS
# é o backup semanal/snapshot da Hostinger. Retenção local: 7 dias.
#
# Formato: pg_dump custom (-Fc) → AES-256 (openssl, PBKDF2) com a chave em
# /opt/movivo/secrets/backup_encryption_key. O dump contém dado de saúde já
# cifrado pelo pgcrypto, mas também PII em claro (telefone, nome) — por isso a
# segunda camada.
#
# Restaurar (exemplo, banco principal):
#   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
#     -pass file:/opt/movivo/secrets/backup_encryption_key \
#     -in movivo-AAAAMMDD-HHMM.dump.enc \
#   | docker exec -i movivo-postgres pg_restore -U postgres -d movivo --clean --if-exists
# =============================================================================
set -euo pipefail

BACKUP_DIR=/opt/movivo/backups
KEY_FILE=/opt/movivo/secrets/backup_encryption_key
RETENTION_DAYS="${RETENTION_DAYS:-7}"
stamp="$(date +%Y%m%d-%H%M)"

[[ -s "$KEY_FILE" ]] || { echo "ERRO: ${KEY_FILE} ausente" >&2; exit 1; }
umask 077

encrypt() {
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:${KEY_FILE}" -out "$1"
}

dump_db() {
  local container="$1" user="$2" db="$3" out="${BACKUP_DIR}/${3}-${stamp}.dump.enc"
  # pipefail: se o pg_dump falhar, o arquivo parcial é apagado e o job falha.
  if docker exec "$container" pg_dump -U "$user" -d "$db" -Fc | encrypt "${out}.tmp"; then
    mv "${out}.tmp" "$out"
    echo "ok  ${out} ($(du -h "$out" | cut -f1))"
  else
    rm -f "${out}.tmp"
    echo "ERRO no dump de ${db}" >&2
    return 1
  fi
}

status=0
dump_db movivo-postgres postgres movivo || status=1
dump_db movivo-evolution-postgres evolution evolution || status=1

uploads_out="${BACKUP_DIR}/uploads-${stamp}.tar.enc"
if tar -C /opt/movivo -cf - uploads | encrypt "${uploads_out}.tmp"; then
  mv "${uploads_out}.tmp" "$uploads_out"
  echo "ok  ${uploads_out}"
else
  rm -f "${uploads_out}.tmp"; status=1
fi

find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.enc' -mtime "+${RETENTION_DAYS}" -delete
exit "$status"
