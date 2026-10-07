#!/bin/sh
set -eu
umask 077
mkdir -p /tmp/tls
cp /run/secrets/postgres_tls_key /tmp/tls/server.key
cp /run/secrets/postgres_tls_cert /tmp/tls/server.crt
chown -R postgres:postgres /tmp/tls
chmod 600 /tmp/tls/server.key
exec docker-entrypoint.sh "$@" -c ssl=on -c ssl_cert_file=/tmp/tls/server.crt \
  -c ssl_key_file=/tmp/tls/server.key -c ssl_min_protocol_version=TLSv1.2 \
  -c hba_file=/etc/movivo/pg_hba.conf
