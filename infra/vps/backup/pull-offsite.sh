#!/usr/bin/env bash
# =============================================================================
# MOVIVO — Puxa as cópias semanais cifradas da VPS para fora do provedor
# =============================================================================
# Dono: Henrique (Platform/SRE) · rodar na máquina de um fundador (Mac), NÃO na VPS.
#
# Cópia isolada sem custo: a máquina puxa (a VPS não tem credencial para empurrar
# para lugar nenhum). Só trafegam os .enc de weekly/; as chaves de decifragem NÃO
# vão junto — ficam no Keychain (movivo-backup-encryption-key / movivo-pgcrypto-key).
# Retenção igual à da VPS (35 dias) para não estender o prazo de guarda do dado
# pessoal (LGPD; ver Política de Privacidade, "prazo de backup").
#
# Uso:  infra/vps/backup/pull-offsite.sh [-n]      (-n = só mostra o que faria)
#       DEST=/Volumes/Cofre/movivo infra/vps/backup/pull-offsite.sh
# =============================================================================
set -euo pipefail

VPS="${VPS:-deploy@187.127.40.87}"
DEST="${DEST:-$HOME/Backups/movivo}"
RETENTION_DAYS="${RETENTION_DAYS:-35}"
dry=()
[[ "${1:-}" == "-n" ]] && dry=(-n)

ssh -o BatchMode=yes "$VPS" 'test -n "$(ls /opt/movivo/backups/weekly/*.enc 2>/dev/null)"' \
  || { echo "Ainda não há cópia semanal na VPS (a primeira é gerada no domingo)." >&2; exit 0; }

umask 077
mkdir -p "$DEST"
rsync -a ${dry[@]+"${dry[@]}"} -e 'ssh -o BatchMode=yes' \
  "${VPS}:/opt/movivo/backups/weekly/" "$DEST/"
chmod -R go-rwx "$DEST"

if [[ ${#dry[@]} -eq 0 ]]; then
  find "$DEST" -type f -name '*.enc' -mtime "+${RETENTION_DAYS}" -delete
  echo "Cópias em ${DEST}:"; ls -1 "$DEST"
fi
