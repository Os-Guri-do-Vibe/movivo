#!/usr/bin/env bash
# =============================================================================
# MOVIVO — Backup cifrado (Postgres + EvolutionAPI + uploads)
# =============================================================================
# Dono: Henrique (Platform/SRE)
#
# Instalado na VPS em /opt/movivo/bin/ e disparado pelo movivo-backup.timer
# (03:30 BRT). Decisão de 2026-09-24: sem storage externo — a cópia fora da VPS
# é o backup semanal da Hostinger. Retenção local: 7 dias de diários + 4 semanais
# (domingo, em weekly/) ≈ 35 dias — prazo a citar na Política de Privacidade.
# Cada dump é verificado logo após a escrita (decifra + pg_restore --list); o
# teste de restauração completo é o movivo-restore-test.sh (semanal).
#
# Formato: pg_dump custom (-Fc) → AES-256 (openssl, PBKDF2) com a chave em
# /opt/movivo/secrets/backup_encryption_key. O dump contém dado de saúde já
# cifrado pelo pgcrypto, mas também PII em claro (telefone, nome) — por isso a
# segunda camada.
#
# Restaurar (exemplo, banco principal — roteiro completo em
# docs/operacoes/deploy-producao.md):
#   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
#     -pass file:/opt/movivo/secrets/backup_encryption_key \
#     -in movivo-AAAAMMDD-HHMM.dump.enc \
#   | docker exec -i movivo-postgres pg_restore -U postgres -d movivo --clean --if-exists
# =============================================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/movivo/backups}"
KEY_FILE=/opt/movivo/secrets/backup_encryption_key
RETENTION_DAYS="${RETENTION_DAYS:-7}"
WEEKLY_DIR="${BACKUP_DIR}/weekly"
WEEKLY_RETENTION_DAYS="${WEEKLY_RETENTION_DAYS:-35}"
stamp="$(date +%Y%m%d-%H%M)"

[[ -s "$KEY_FILE" ]] || { echo "ERRO: ${KEY_FILE} ausente" >&2; exit 1; }
umask 077

encrypt() {
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:${KEY_FILE}" -out "$1"
}

# Prova que o arquivo decifra com a chave atual e que o pg_restore consegue
# ler o índice do dump — pega arquivo truncado/corrompido no mesmo dia.
verify_dump() {
  local container="$1" file="$2" entries
  entries="$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:${KEY_FILE}" -in "$file" \
    | docker exec -i "$container" pg_restore --list | grep -c '^[0-9]' || true)"
  (( entries > 0 )) || { echo "ERRO: ${file} não passou na verificação (${entries} entradas)" >&2; return 1; }
}

dump_db() {
  local container="$1" user="$2" db="$3" out="${BACKUP_DIR}/${3}-${stamp}.dump.enc"
  # pipefail: se o pg_dump falhar, o arquivo parcial é apagado e o job falha.
  if docker exec "$container" pg_dump -U "$user" -d "$db" -Fc | encrypt "${out}.tmp"; then
    mv "${out}.tmp" "$out"
    if verify_dump "$container" "$out"; then
      echo "ok  ${out} ($(du -h "$out" | cut -f1)) verificado"
    else
      mv "$out" "${out%.enc}.INVALIDO"
      return 1
    fi
  else
    rm -f "${out}.tmp"
    echo "ERRO no dump de ${db}" >&2
    return 1
  fi
}

status=0
dump_db movivo-postgres postgres movivo || status=1
dump_db movivo-evolution-postgres evolution evolution || status=1

# Vault Raft snapshot is barrier-encrypted; wrap with the separate backup key too.
# Unseal/root custody stays outside this archive and the application volumes.
vault_out="${BACKUP_DIR}/vault-${stamp}.snapshot.enc"
vault_tmp="$(mktemp "${BACKUP_DIR}/.vault-snapshot.XXXXXX")"
if python3 /opt/movivo/bin/provision-security.py --root /opt/movivo \
    --environment production --vault --snapshot "$vault_tmp" && encrypt "${vault_out}.tmp" < "$vault_tmp"; then
  mv "${vault_out}.tmp" "$vault_out"
  echo "ok  ${vault_out}"
else
  rm -f "${vault_out}.tmp"; status=1
fi
rm -f "$vault_tmp"

uploads_out="${BACKUP_DIR}/uploads-${stamp}.tar.enc"
if tar -C /opt/movivo -cf - uploads | encrypt "${uploads_out}.tmp"; then
  mv "${uploads_out}.tmp" "$uploads_out"
  echo "ok  ${uploads_out}"
else
  rm -f "${uploads_out}.tmp"; status=1
fi

# Cópia semanal (domingo) com retenção maior — só se o backup do dia deu certo.
if [[ "$status" -eq 0 && "$(date +%u)" == 7 ]]; then
  install -d -m 700 "$WEEKLY_DIR"
  cp -p "${BACKUP_DIR}"/*-"${stamp}".*.enc "$WEEKLY_DIR"/
  echo "ok  cópia semanal em ${WEEKLY_DIR}"
fi

find "$BACKUP_DIR" -maxdepth 1 -type f \( -name '*.enc' -o -name '*.INVALIDO' \) -mtime "+${RETENTION_DAYS}" -delete
[[ -d "$WEEKLY_DIR" ]] && find "$WEEKLY_DIR" -type f -name '*.enc' -mtime "+${WEEKLY_RETENTION_DAYS}" -delete
exit "$status"
