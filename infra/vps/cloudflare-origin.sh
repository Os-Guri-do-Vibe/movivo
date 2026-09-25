#!/usr/bin/env bash
# =============================================================================
# MOVIVO — Certificado de origem do Cloudflare + SSL Full (strict)
# =============================================================================
# Dono: Henrique (Platform/SRE)
#
# Roda no Mac. Faz, nesta ordem:
#   1. Gera a chave privada e o CSR NA VPS — a chave nunca sai de lá.
#   2. Pede ao Cloudflare um Origin CA Certificate (RSA, 15 anos) para
#      movivo.com.br + *.movivo.com.br e grava o .pem na VPS.
#   3. Com --strict: liga SSL "Full (strict)" e "Always Use HTTPS" na zona.
#      Só faça isso com o Nginx já servindo o certificado (o deploy.sh chama).
#
# Idempotente: se a VPS já tem certificado válido por mais de 30 dias, o passo
# 1–2 é pulado (use --renew para forçar um novo).
#
# Token: Keychain (serviço cloudflare-api-token, conta movivo) ou
# CLOUDFLARE_API_TOKEN. Escopo mínimo, só na zona movivo.com.br:
#   Zone · SSL and Certificates · Edit / Zone · Zone Settings · Edit / Zone · Zone · Read
#   security add-generic-password -U -s cloudflare-api-token -a movivo -w
# =============================================================================
set -euo pipefail

VPS="${VPS:-deploy@187.127.40.87}"
ZONE_NAME="${ZONE_NAME:-movivo.com.br}"
CERT_DIR="/opt/movivo/nginx/certs"
CF_API="https://api.cloudflare.com/client/v4"

renew=0 strict=0
for arg in "$@"; do
  case "$arg" in
    --renew) renew=1 ;;
    --strict) strict=1 ;;
    *) echo "uso: $0 [--renew] [--strict]" >&2; exit 2 ;;
  esac
done

token="${CLOUDFLARE_API_TOKEN:-}"
if [[ -z "$token" ]] && command -v security >/dev/null 2>&1; then
  token="$(security find-generic-password -s cloudflare-api-token -a movivo -w 2>/dev/null || true)"
fi
[[ -n "$token" ]] || { echo "ERRO: token ausente. security add-generic-password -U -s cloudflare-api-token -a movivo -w" >&2; exit 1; }

cf() {
  curl -sS --max-time 30 -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" "$@"
}
# Aborta com as mensagens de erro do Cloudflare (nunca com o token).
cf_ok() {
  python3 -c '
import sys, json
d = json.load(sys.stdin)
if not d.get("success"):
    sys.exit("ERRO Cloudflare: " + "; ".join(e.get("message", "") for e in d.get("errors", [])))
print(json.dumps(d["result"]))'
}

zone_id="$(cf "${CF_API}/zones?name=${ZONE_NAME}" | cf_ok \
  | python3 -c 'import sys,json; r=json.load(sys.stdin); print(r[0]["id"] if r else "")')"
[[ -n "$zone_id" ]] || { echo "ERRO: zona ${ZONE_NAME} não visível para este token" >&2; exit 1; }
echo "==> zona ${ZONE_NAME} encontrada"

cert_valid=0
if ssh "$VPS" "test -s ${CERT_DIR}/origin.pem && test -s ${CERT_DIR}/origin.key \
    && openssl x509 -checkend $((30*86400)) -noout -in ${CERT_DIR}/origin.pem" >/dev/null 2>&1; then
  cert_valid=1
fi

if [[ $cert_valid -eq 1 && $renew -eq 0 ]]; then
  echo "==> certificado da origem válido por mais de 30 dias — mantido"
else
  csr="$(ssh "$VPS" "set -e; install -d -m 700 ${CERT_DIR}
    umask 077
    openssl req -new -newkey rsa:2048 -nodes -keyout ${CERT_DIR}/origin.key.new \
      -subj '/CN=${ZONE_NAME}' -out - 2>/dev/null")"

  payload="$(CSR="$csr" ZONE="$ZONE_NAME" python3 -c '
import json, os
print(json.dumps({"csr": os.environ["CSR"],
                  "hostnames": [os.environ["ZONE"], "*." + os.environ["ZONE"]],
                  "request_type": "origin-rsa", "requested_validity": 5475}))')"

  cert="$(cf -X POST "${CF_API}/certificates" -d "$payload" | cf_ok \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["certificate"])')"

  printf '%s\n' "$cert" | ssh "$VPS" "set -e; umask 077
    cat > ${CERT_DIR}/origin.pem.new
    # Só troca o par se o certificado bater com a chave gerada agora.
    [ \"\$(openssl x509 -noout -pubkey -in ${CERT_DIR}/origin.pem.new)\" = \
      \"\$(openssl pkey -pubout -in ${CERT_DIR}/origin.key.new)\" ]
    mv ${CERT_DIR}/origin.key.new ${CERT_DIR}/origin.key
    mv ${CERT_DIR}/origin.pem.new ${CERT_DIR}/origin.pem"
  echo "==> Origin Certificate emitido e instalado em ${CERT_DIR}"
  ssh "$VPS" "openssl x509 -noout -subject -enddate -ext subjectAltName -in ${CERT_DIR}/origin.pem"
fi

if [[ $strict -eq 1 ]]; then
  cf -X PATCH "${CF_API}/zones/${zone_id}/settings/ssl" -d '{"value":"strict"}' | cf_ok >/dev/null
  cf -X PATCH "${CF_API}/zones/${zone_id}/settings/always_use_https" -d '{"value":"on"}' | cf_ok >/dev/null
  cf -X PATCH "${CF_API}/zones/${zone_id}/settings/min_tls_version" -d '{"value":"1.2"}' | cf_ok >/dev/null
  echo "==> zona em SSL Full (strict), Always Use HTTPS e TLS mínimo 1.2"
fi
