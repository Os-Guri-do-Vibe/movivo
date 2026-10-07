#!/usr/bin/env bash
# Evidência somente de leitura: dados vivos montados sobre o LUKS e boot fail-closed.
set -euo pipefail

mapper=/dev/mapper/movivo_data
cryptsetup isLuks /srv/movivo-data.luks
cryptsetup status movivo_data >/dev/null
[[ "$(findmnt -n -o SOURCE --target /mnt/movivo-secure)" == "$mapper" ]]
for entry in 'containerd:/var/lib/containerd' 'docker:/var/lib/docker' 'app:/opt/movivo'; do
  source_dir="${entry%%:*}"
  target="${entry#*:}"
  [[ "$(findmnt -n -o SOURCE --target "$target")" == "$mapper"\[/$source_dir\] ]]
done
for unit in containerd.service docker.service; do
  [[ " $(systemctl show -p Requires --value "$unit") " == *' movivo-storage-mount.service '* ]]
done
[[ ! -e /run/movivo-storage-bootstrap.key ]]
printf 'LUKS2 ativo; containerd, Docker e aplicação em mounts cifrados; serviços dependem do mount.\n'
