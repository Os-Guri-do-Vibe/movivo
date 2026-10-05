#!/bin/sh
# Nginx e sanitizador compartilham o ciclo de vida: sem coletor, não há proxy.
set -eu
umask 077
mkdir -p /run/movivo-logs
fifo=/run/movivo-logs/error.pipe
rm -f "$fifo"
mkfifo -m 600 "$fifo"
awk -f /opt/movivo-logging/sanitize-error.awk < "$fifo" >&2 &
collector_pid=$!
printf '%s\n' "$collector_pid" > /run/movivo-logs/collector.pid
/docker-entrypoint.sh nginx -e stderr -g 'daemon off;' 2> "$fifo" &
nginx_pid=$!
cleanup() {
    trap - EXIT TERM INT
    kill -TERM "$nginx_pid" 2>/dev/null || true
    wait "$nginx_pid" 2>/dev/null || true
    kill -TERM "$collector_pid" 2>/dev/null || true
    wait "$collector_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 0' TERM INT
# Monitorar ambos explicitamente: BusyBox wait -n não observa de forma confiável
# a morte sinalizada do coletor. Falha de qualquer processo encerra o proxy.
while kill -0 "$nginx_pid" 2>/dev/null && kill -0 "$collector_pid" 2>/dev/null; do
    sleep 1 &
    wait "$!" || break
done
exit 1
