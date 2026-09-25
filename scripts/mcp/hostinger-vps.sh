#!/usr/bin/env bash
# =============================================================================
# MOVIVO — MCP da Hostinger (só ferramentas de VPS) para o Claude Code
# =============================================================================
# Dono: Henrique (Platform/SRE)
#
# Sobe o servidor MCP oficial da Hostinger restrito ao produto VPS (64 tools,
# em vez das 401 do servidor unificado — DNS fica no Cloudflare e o domínio no
# Registro.br, então o resto seria só ruído no contexto).
#
# O token NUNCA fica em arquivo de configuração: é lido na hora do Keychain do
# macOS. Cada dev usa o próprio token:
#   security add-generic-password -U -s hostinger-api-token -a movivo -w
#   (o comando pede o token sem ecoar — não cole token em chat/issue)
# Fora do macOS (Windows/Linux), exporte HOSTINGER_API_TOKEN antes de abrir o
# Claude Code e este script o reaproveita.
#
# Registro no Claude Code (escopo de usuário, fora do repo):
#   claude mcp add --scope user hostinger-vps -- "$PWD/scripts/mcp/hostinger-vps.sh"
#
# As tools destrutivas (recreate/restore/purchase/deleteProject) estão em
# `permissions.deny` no .claude/settings.json do projeto.
# =============================================================================
set -euo pipefail

MCP_PACKAGE="@hostinger/mcp@1.63.3"   # versão fixada: supply chain (Sato)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

token="${HOSTINGER_API_TOKEN:-}"
if [[ -z "$token" ]] && command -v security >/dev/null 2>&1; then
  token="$(security find-generic-password -s hostinger-api-token \
    -a "${HOSTINGER_KEYCHAIN_ACCOUNT:-movivo}" -w 2>/dev/null || true)"
fi
if [[ -z "$token" ]]; then
  echo "hostinger-vps MCP: token ausente. Rode: security add-generic-password -U -s hostinger-api-token -a movivo -w" >&2
  exit 1
fi

# O Claude Code (principalmente pela extensão do VS Code) inicia o MCP sem o PATH
# do shell interativo — o Node do nvm não estaria visível. Usa o mesmo Node do
# projeto (.nvmrc) quando ele está instalado via nvm.
node_bin="${NVM_DIR:-$HOME/.nvm}/versions/node/v$(cat "${REPO_ROOT}/.nvmrc" 2>/dev/null)/bin"
[[ -x "${node_bin}/npx" ]] && export PATH="${node_bin}:${PATH}"

export HOSTINGER_API_TOKEN="$token"
exec npx -y -p "$MCP_PACKAGE" hostinger-vps-mcp
