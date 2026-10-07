#!/bin/sh
set -eu
umask 077
role="$1"
test -s /run/secrets/redis_password
sed "s|@REDIS_PASSWORD@|$(cat /run/secrets/redis_password)|g" \
  "/etc/movivo/${role}.conf.tpl" | sed -E '/^port /d' > /tmp/redis.conf
cat >> /tmp/redis.conf <<EOF
port 0
tls-port ${REDIS_TLS_PORT:-6379}
tls-cert-file /run/secrets/redis_tls_cert
tls-key-file /run/secrets/redis_tls_key
tls-ca-cert-file /run/secrets/internal_ca
tls-auth-clients no
tls-replication yes
tls-protocols "TLSv1.2 TLSv1.3"
EOF
if [ "$role" = sentinel ]; then
  exec redis-sentinel /tmp/redis.conf
fi
exec redis-server /tmp/redis.conf
