#!/usr/bin/env bash
# Monta apenas um LUKS já desbloqueado. Sem chave no host ou fallback em disco aberto.
set -euo pipefail

[[ "$(id -u)" == 0 ]] || { echo 'Execute como root.' >&2; exit 1; }
mapper=/dev/mapper/movivo_data
secure=/mnt/movivo-secure
[[ -b "$mapper" ]] || { echo 'Volume MOVIVO bloqueado; Docker não pode iniciar.' >&2; exit 1; }

if ! mountpoint -q "$secure"; then
  mkdir -p "$secure"
  mount -o noatime "$mapper" "$secure"
fi
[[ "$(findmnt -n -o SOURCE --target "$secure")" == "$mapper" ]] || {
  echo 'Origem do armazenamento MOVIVO inválida.' >&2; exit 1;
}
[[ -f "$secure/.movivo-storage-ready" ]] || {
  echo 'Migração do armazenamento MOVIVO não concluída.' >&2; exit 1;
}

for entry in 'containerd:/var/lib/containerd' 'docker:/var/lib/docker' 'app:/opt/movivo'; do
  source_dir="$secure/${entry%%:*}"
  target="${entry#*:}"
  [[ -d "$source_dir" ]] || { echo 'Diretório cifrado ausente.' >&2; exit 1; }
  mkdir -p "$target"
  if ! mountpoint -q "$target"; then
    mount --bind "$source_dir" "$target"
  fi
  [[ "$(findmnt -n -o SOURCE --target "$target")" == "$mapper"\[*\] ]] || {
    echo 'Origem do bind MOVIVO inválida.' >&2; exit 1;
  }
done
