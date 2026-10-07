#!/usr/bin/env bash
# Chave mantida na estação do operador; viaja somente pelo stdin de SSH/cryptsetup.
set -euo pipefail

key_file="${MOVIVO_STORAGE_KEY_FILE:-$HOME/.local/share/movivo-security/production-recovery/storage-luks.key}"
host="${MOVIVO_VPS_HOST:-deploy@187.127.40.87}"
[[ -s "$key_file" ]] || { echo 'Chave privada de armazenamento ausente.' >&2; exit 1; }
[[ "$(stat -f %Lp "$key_file")" == 600 ]] || {
  echo 'A chave deve ter permissão 0600.' >&2; exit 1;
}

ssh -o BatchMode=yes "$host" 'sudo -n cryptsetup status movivo_data >/dev/null 2>&1' || \
  ssh -o BatchMode=yes "$host" \
    'sudo -n cryptsetup open --key-file=- /srv/movivo-data.luks movivo_data' < "$key_file"
ssh -o BatchMode=yes "$host" \
  'sudo -n systemctl reset-failed movivo-storage-mount.service containerd.service docker.service movivo-vault-unseal.service; sudo -n systemctl start movivo-storage-mount.service containerd.service docker.service && cd /opt/movivo && docker compose up -d vault && sudo -n systemctl start movivo-vault-unseal.service && docker compose up -d --wait'
