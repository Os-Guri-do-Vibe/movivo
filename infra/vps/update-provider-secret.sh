#!/usr/bin/env bash
# Executar NA VPS: ./infra/vps/update-provider-secret.sh openai_api_key < arquivo-privado
# Só depois do sucesso revogue a chave anterior no console do fornecedor.
set -euo pipefail
set +x
umask 077
cd /opt/movivo
key=${1:-}
case "$key" in
  asaas_api_key|openai_api_key|anthropic_api_key|deepseek_api_key|groq_api_key) ;;
  *) echo 'Fornecedor inválido; use uma das cinco chaves suportadas.' >&2; exit 2 ;;
esac
[[ $(stat -c %a secrets) == 700 ]] || { echo 'O diretório secrets deve ter modo 0700.' >&2; exit 1; }
exec 9>secrets/.provider-update.lock
flock -n 9 || { echo 'Outra atualização de credencial está em execução.' >&2; exit 1; }
candidate=$(mktemp "secrets/.${key}.candidate.XXXXXX")
previous=$(mktemp "secrets/.${key}.previous.XXXXXX")
trap 'rm -f "$candidate" "$previous"' EXIT
cat > "$candidate"
# Credencial nunca vira argumento/env; resposta do fornecedor é descartada.
python3 - "$key" "$candidate" <<'PY'
import pathlib, sys, urllib.request, urllib.error
name, filename = sys.argv[1:]
value = pathlib.Path(filename).read_text().rstrip('\r\n')
if not value or len(value) > 4096 or any(c.isspace() for c in value):
    raise SystemExit('Credencial vazia ou formato inválido.')
endpoints = {
 'asaas_api_key': 'https://api-sandbox.asaas.com/v3/customers?limit=1',
 'openai_api_key': 'https://api.openai.com/v1/models',
 'anthropic_api_key': 'https://api.anthropic.com/v1/models?limit=1',
 'deepseek_api_key': 'https://api.deepseek.com/models',
 'groq_api_key': 'https://api.groq.com/openai/v1/models',
}
headers = {'User-Agent': 'MOVIVO-secret-validation/1'}
if name == 'asaas_api_key':
    env = dict(line.split('=', 1) for line in pathlib.Path('api.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
    if env.get('ASAAS_API_URL', 'https://api-sandbox.asaas.com/v3') != 'https://api-sandbox.asaas.com/v3':
        raise SystemExit('Asaas precisa permanecer no Sandbox até aprovação do gate PCI.')
    headers['access_token'] = value
elif name == 'anthropic_api_key':
    headers.update({'x-api-key': value, 'anthropic-version': '2023-06-01'})
else:
    headers['Authorization'] = 'Bearer ' + value
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        return None

opener = urllib.request.build_opener(NoRedirect)
try:
    with opener.open(urllib.request.Request(endpoints[name], headers=headers), timeout=20) as response:
        if response.status != 200: raise SystemExit('Fornecedor não validou a nova credencial.')
except (urllib.error.URLError, TimeoutError):
    raise SystemExit('Fornecedor não validou a nova credencial; nenhuma substituição realizada.')
pathlib.Path(filename).write_text(value + '\n')
PY
[[ -s "secrets/$key" ]] || { echo 'Credencial anterior ausente; use provisionamento inicial.' >&2; exit 1; }
cp "secrets/$key" "$previous"
chmod 600 "$previous"
chmod 644 "$candidate" # Bind mount lido pelo UID sem privilégio; diretório pai é 0700.
mv "$candidate" "secrets/$key"
healthy() {
  for ((attempt=0; attempt<60; attempt++)); do
    [[ $(docker inspect movivo-api --format '{{.State.Health.Status}}' 2>/dev/null || true) == healthy ]] && return 0
    sleep 2
  done
  return 1
}
if docker compose --env-file .env -f compose.yml up -d --no-deps --force-recreate api >/dev/null 2>&1 && healthy; then
  echo 'Nova credencial validada e API saudável. Revogue a anterior no console do fornecedor.'
else
  chmod 644 "$previous"
  mv "$previous" "secrets/$key"
  docker compose --env-file .env -f compose.yml up -d --no-deps --force-recreate api >/dev/null 2>&1 || true
  if healthy; then
    echo 'Atualização falhou; credencial anterior restaurada. Não revogue a anterior.' >&2
  else
    echo 'Atualização falhou e recuperação não ficou saudável; investigar sem imprimir secrets.' >&2
  fi
  exit 1
fi
