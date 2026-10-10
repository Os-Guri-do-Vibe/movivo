#!/usr/bin/env bash
# Troca a conta Asaas da VPS com rollback de configuração e segredos se a API falhar.
set -euo pipefail
set +x
umask 077

: "${ASAAS_PRODUCTION_API_KEY:?credencial de produção ausente}"
: "${ASAAS_PRODUCTION_WEBHOOK_TOKEN:?token do webhook de produção ausente}"
VPS="${VPS:-deploy@187.127.40.87}"
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
printf '%s\n' "$ASAAS_PRODUCTION_API_KEY" > "$staging/api_key"
printf '%s\n' "$ASAAS_PRODUCTION_WEBHOOK_TOKEN" > "$staging/webhook_token"

python3 - "$staging/api_key" "$staging/webhook_token" <<'PY'
import pathlib, sys, urllib.request
key = pathlib.Path(sys.argv[1]).read_text().strip()
token = pathlib.Path(sys.argv[2]).read_text().strip()
if not key or not 32 <= len(token) <= 255 or any(c.isspace() for c in key + token):
    raise SystemExit('Credenciais Asaas com formato inválido')
request = urllib.request.Request('https://api.asaas.com/v3/customers?limit=1', headers={
    'access_token': key, 'User-Agent': 'MOVIVO/production-activation'})
with urllib.request.urlopen(request, timeout=20) as response:
    if response.status != 200: raise SystemExit('Chave Asaas de produção não autenticou')
PY

ssh -o BatchMode=yes "$VPS" 'sudo -n /usr/local/sbin/movivo-storage-verify >/dev/null && test -s /opt/movivo/secrets/asaas_api_key && test -s /opt/movivo/secrets/asaas_webhook_secret'
ssh -o BatchMode=yes -T "$VPS" 'umask 077; cat > /opt/movivo/secrets/.asaas_api_key.next; chmod 644 /opt/movivo/secrets/.asaas_api_key.next' < "$staging/api_key"
ssh -o BatchMode=yes -T "$VPS" 'umask 077; cat > /opt/movivo/secrets/.asaas_webhook_secret.next; chmod 644 /opt/movivo/secrets/.asaas_webhook_secret.next' < "$staging/webhook_token"

ssh -o BatchMode=yes -T "$VPS" 'bash -se' <<'REMOTE'
set -Eeuo pipefail
cd /opt/movivo
trap 'rm -f secrets/.asaas_api_key.next secrets/.asaas_webhook_secret.next .api.env.asaas.next' EXIT
current_url="$(sed -n 's/^ASAAS_API_URL=//p' api.env)"
case "$current_url" in
  https://api-sandbox.asaas.com/v3|https://api.asaas.com/v3) ;;
  *) echo 'ASAAS_API_URL inesperada; troca cancelada' >&2; exit 1 ;;
esac
cmp -s secrets/asaas_api_key secrets/.asaas_api_key.next && {
  echo 'Chave nova igual à chave atual; troca cancelada' >&2; exit 1;
}
cp -p api.env .api.env.asaas.rollback
cp -p secrets/asaas_api_key secrets/.asaas_api_key.rollback
cp -p secrets/asaas_webhook_secret secrets/.asaas_webhook_secret.rollback
restore() {
  status=$?
  trap - ERR
  mv -f .api.env.asaas.rollback api.env
  mv -f secrets/.asaas_api_key.rollback secrets/asaas_api_key
  mv -f secrets/.asaas_webhook_secret.rollback secrets/asaas_webhook_secret
  docker compose --env-file .env -f compose.yml -f compose.override.yml up -d --no-deps --force-recreate --wait --wait-timeout 180 api >/dev/null || true
  echo 'Falha no corte Asaas; configuração e segredos anteriores restaurados.' >&2
  exit "$status"
}
trap restore ERR
sed 's#^ASAAS_API_URL=.*#ASAAS_API_URL=https://api.asaas.com/v3#' api.env > .api.env.asaas.next
chmod --reference=api.env .api.env.asaas.next
mv -f .api.env.asaas.next api.env
mv -f secrets/.asaas_api_key.next secrets/asaas_api_key
mv -f secrets/.asaas_webhook_secret.next secrets/asaas_webhook_secret
docker compose --env-file .env -f compose.yml -f compose.override.yml up -d --no-deps --force-recreate --wait --wait-timeout 180 api >/dev/null
[[ "$(docker inspect movivo-api --format '{{.State.Health.Status}}')" == healthy ]]
trap - ERR
rm -f .api.env.asaas.rollback secrets/.asaas_api_key.rollback secrets/.asaas_webhook_secret.rollback
echo 'API saudável com endpoint Asaas de produção.'
REMOTE

curl -fsS --max-time 20 https://api.movivo.com.br/api/v1/health >/dev/null
echo 'Saúde pública da API confirmada.'
