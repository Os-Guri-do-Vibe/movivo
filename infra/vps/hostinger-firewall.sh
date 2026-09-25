#!/usr/bin/env bash
# =============================================================================
# MOVIVO — Firewall de rede da VPS (Hostinger) como código
# =============================================================================
# Dono: Henrique (Platform/SRE)
#
# Reaplica, de forma atômica, as regras do firewall `movivo-producao` na borda
# da Hostinger — ANTES do tráfego chegar à VPS:
#   · TCP 22  de qualquer origem (deploy do GitHub Actions tem IP variável;
#             a proteção do SSH é chave + fail2ban, não IP)
#   · ICMP    de qualquer origem (diagnóstico)
#   · TCP 443 SÓ das faixas IPv4 publicadas pelo Cloudflare
#   · todo o resto: DROP (padrão do firewall da Hostinger)
#
# Por que existe além do UFW: portas publicadas pelo Docker passam POR FORA do
# UFW (iptables do Docker vem antes). Este firewall fica na rede do provedor e
# não tem esse furo. E, com 443 restrito ao Cloudflare, ninguém fala com a
# origem sem passar pelo WAF/DDoS da borda. Porta 80 fica fechada: em Full
# (strict) o Cloudflare só conversa com a origem em 443.
#
# Uso (rode de novo sempre que o Cloudflare mudar a lista de IPs):
#   bash infra/vps/hostinger-firewall.sh
# O token vem do Keychain (mesma entrada do MCP, ver scripts/mcp/hostinger-vps.sh)
# ou de HOSTINGER_API_TOKEN, se exportado.
#
# Nunca versione nem cole o token em chat/issue — ele controla a conta inteira.
# =============================================================================
set -euo pipefail

if [[ -z "${HOSTINGER_API_TOKEN:-}" ]] && command -v security >/dev/null 2>&1; then
  HOSTINGER_API_TOKEN="$(security find-generic-password -s hostinger-api-token \
    -a "${HOSTINGER_KEYCHAIN_ACCOUNT:-movivo}" -w 2>/dev/null || true)"
fi
: "${HOSTINGER_API_TOKEN:?token ausente: security add-generic-password -U -s hostinger-api-token -a movivo -w}"
VM_ID="${VM_ID:-2006496}"
FIREWALL_NAME="${FIREWALL_NAME:-movivo-producao}"
API="https://developers.hostinger.com/api/vps/v1"

api() {
  curl -fsS --max-time 30 \
    -H "Authorization: Bearer ${HOSTINGER_API_TOKEN}" \
    -H "Accept: application/json" -H "Content-Type: application/json" "$@"
}

wait_action() {
  local id="$1" state
  for _ in $(seq 1 36); do
    state="$(api "${API}/virtual-machines/${VM_ID}/actions/${id}" \
      | python3 -c 'import sys,json; print(json.load(sys.stdin).get("state"))')"
    case "$state" in
      success) return 0 ;;
      error) echo "ERRO: ação ${id} falhou" >&2; return 1 ;;
    esac
    sleep 5
  done
  echo "ERRO: ação ${id} não terminou em 3 min" >&2
  return 1
}

cf_ips="$(curl -fsS --max-time 15 https://www.cloudflare.com/ips-v4 | tr -d '\r' | grep -E '^[0-9./]+$')"
[[ $(wc -l <<<"$cf_ips") -ge 10 ]] || { echo "ERRO: lista de IPs do Cloudflare suspeita" >&2; exit 1; }

firewall_id="$(api "${API}/firewall" | FIREWALL_NAME="$FIREWALL_NAME" python3 -c '
import sys, json, os
d = json.load(sys.stdin)
items = d.get("data", d) if isinstance(d, dict) else d
print(next((str(f["id"]) for f in items if f.get("name") == os.environ["FIREWALL_NAME"]), ""))')"

if [[ -z "$firewall_id" ]]; then
  firewall_id="$(api -X POST "${API}/firewall" -d "{\"name\":\"${FIREWALL_NAME}\"}" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')"
  echo "==> firewall ${FIREWALL_NAME} criado (id ${firewall_id})"
fi

rules="$(CF_IPS="$cf_ips" python3 -c '
import json, os
rules = [
    {"protocol": "TCP", "port": "22", "source": "any", "source_detail": "any"},
    {"protocol": "ICMP", "port": "any", "source": "any", "source_detail": "any"},
]
rules += [{"protocol": "TCP", "port": "443", "source": "custom", "source_detail": c}
          for c in os.environ["CF_IPS"].split()]
print(json.dumps({"rules": rules, "sync": False}))')"

api -X PUT "${API}/firewall/${firewall_id}/rules" -d "$rules" >/dev/null
echo "==> $(( $(wc -l <<<"$cf_ips") + 2 )) regras gravadas"

active="$(api "${API}/virtual-machines/${VM_ID}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin).get("firewall_group_id") or "")')"
if [[ "$active" != "$firewall_id" ]]; then
  action="$(api -X POST "${API}/firewall/${firewall_id}/activate/${VM_ID}" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')"
  wait_action "$action"
  echo "==> firewall ativado na VPS ${VM_ID}"
fi

action="$(api -X POST "${API}/firewall/${firewall_id}/sync/${VM_ID}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')"
wait_action "$action"
echo "==> regras sincronizadas na VPS ${VM_ID}"
