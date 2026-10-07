#!/bin/sh
set -eu
umask 077
mkdir -p /tmp/tls
cp /run/secrets/vault_tls_key /tmp/tls/server.key
cp /run/secrets/vault_tls_cert /tmp/tls/server.crt
chown -R vault:vault /tmp/tls
chmod 600 /tmp/tls/server.key
mkdir -p /vault/data
chown vault:vault /vault/data
# Vault 2.x image has no setcap; unlimited memlock is inherited by the vault user.
export SKIP_SETCAP=1
export SKIP_CHOWN=1
exec docker-entrypoint.sh server
