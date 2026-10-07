#!/usr/bin/env bash
# Executar uma vez na VPS como root, recebendo a chave binária pelo stdin de SSH.
set -euo pipefail
[[ "$(id -u)" == 0 ]] || { echo 'Execute como root.' >&2; exit 1; }
image=/srv/movivo-data.luks
mapper=/dev/mapper/movivo_data
key=/run/movivo-storage-bootstrap.key
[[ ! -e "$image" && ! -e "$mapper" ]] || {
  echo 'Armazenamento já foi preparado; nenhuma formatação foi feita.' >&2; exit 1;
}
umask 077
cat > "$key"
trap 'rm -f "$key"' EXIT
[[ "$(wc -c < "$key")" -eq 64 ]] || { echo 'Chave de 64 bytes exigida.' >&2; exit 1; }
truncate -s 48G "$image"
cryptsetup luksFormat --type luks2 --batch-mode --key-file "$key" "$image"
cryptsetup open --key-file "$key" "$image" movivo_data
mkfs.ext4 -q -F -m 0 "$mapper"
mkdir -p /mnt/movivo-secure
mount -o noatime "$mapper" /mnt/movivo-secure
chmod 0700 /mnt/movivo-secure
mkdir -p /mnt/movivo-secure/{containerd,docker,app}
echo 'LUKS2 preparado; execute pré-cópia, backup e migração antes de iniciar os serviços no volume.'
