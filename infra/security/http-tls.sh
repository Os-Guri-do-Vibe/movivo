#!/bin/sh
set -eu
sed -e "s/@TLS_PORT@/${TLS_PORT}/g" -e "s/@UPSTREAM_PORT@/${UPSTREAM_PORT}/g" \
  /etc/movivo/http-tls.conf > /tmp/nginx.conf
exec nginx -c /tmp/nginx.conf -g 'daemon off;'
