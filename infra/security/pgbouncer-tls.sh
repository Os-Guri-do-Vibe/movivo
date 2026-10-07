#!/bin/sh
set -eu
umask 077
mkdir -p /tmp/tls
cp /run/secrets/pgbouncer_tls_key /tmp/tls/server.key
cp /run/secrets/pgbouncer_tls_cert /tmp/tls/server.crt
chown -R postgres:postgres /tmp/tls
cp /etc/pgbouncer/pgbouncer.ini /tmp/pgbouncer.ini
cat >> /tmp/pgbouncer.ini <<'EOF'
client_tls_sslmode = require
client_tls_key_file = /tmp/tls/server.key
client_tls_cert_file = /tmp/tls/server.crt
client_tls_protocols = secure
server_tls_sslmode = verify-full
server_tls_ca_file = /run/secrets/internal_ca
server_tls_protocols = secure
EOF
chown postgres:postgres /tmp/pgbouncer.ini
exec su postgres -s /bin/sh -c '/usr/bin/pgbouncer /tmp/pgbouncer.ini'
