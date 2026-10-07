#!/usr/bin/env bash
# Janela única de migração: backup/restauração devem passar antes de executar.
set -euo pipefail
[[ "$(id -u)" == 0 ]] || { echo 'Execute como root.' >&2; exit 1; }
secure=/mnt/movivo-secure
suffix=.plain-before-luks-20261007
[[ -b /dev/mapper/movivo_data && -f /opt/movivo/compose.yml ]] || {
  echo 'LUKS desbloqueado e Compose de produção são obrigatórios.' >&2; exit 1;
}
[[ "$(findmnt -n -o SOURCE --target "$secure")" == /dev/mapper/movivo_data ]] || exit 1
for path in /var/lib/containerd /var/lib/docker /opt/movivo; do
  if [[ -e "${path}${suffix}" ]] || mountpoint -q "$path"; then
    echo 'Migração já iniciada ou origem montada.' >&2; exit 1;
  fi
done

cd /opt/movivo
docker compose down --remove-orphans
systemctl stop movivo-vault-unseal.timer
systemctl mask --runtime docker.socket docker.service containerd.service
systemctl stop docker.socket docker.service containerd.service
if systemctl is-active --quiet docker.socket docker.service containerd.service || \
  pgrep -x dockerd >/dev/null || pgrep -x containerd >/dev/null; then
  echo 'Docker ou containerd ainda está ativo; não copiar dados ativos.' >&2; exit 1
fi

rsync -aHAX --numeric-ids --one-file-system --delete /var/lib/containerd/ "$secure/containerd/"
rsync -aHAX --numeric-ids --one-file-system --delete /var/lib/docker/ "$secure/docker/"
rsync -aHAX --numeric-ids --one-file-system --delete /opt/movivo/ "$secure/app/"
sync

mv /var/lib/containerd "/var/lib/containerd${suffix}"
mv /var/lib/docker "/var/lib/docker${suffix}"
mv /opt/movivo "/opt/movivo${suffix}"
mkdir -p /var/lib/containerd /var/lib/docker /opt/movivo
touch "$secure/.movivo-storage-ready"

install -m 0755 /tmp/movivo-storage-mount.sh /usr/local/sbin/movivo-storage-mount
install -m 0755 /tmp/verify-movivo-storage.sh /usr/local/sbin/movivo-storage-verify
install -m 0644 /tmp/movivo-storage-mount.service /etc/systemd/system/movivo-storage-mount.service
for unit in containerd.service docker.service; do
  install -d -m 0755 "/etc/systemd/system/${unit}.d"
  install -m 0644 /tmp/require-movivo-storage.conf \
    "/etc/systemd/system/${unit}.d/require-movivo-storage.conf"
done
systemctl daemon-reload
/usr/local/sbin/movivo-storage-mount
systemctl enable --now movivo-storage-mount.service
systemctl unmask --runtime docker.socket docker.service containerd.service
systemctl start containerd.service docker.service
cd /opt/movivo
docker compose up -d vault
systemctl start movivo-vault-unseal.service
systemctl start movivo-vault-unseal.timer
docker compose up -d --wait
echo 'Migração ativada. Valide serviços, TLS e restore antes de remover as origens em claro.'
