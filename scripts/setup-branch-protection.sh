#!/usr/bin/env bash
# =============================================================================
# MOVIVO — Branch protection de `main`  ·  US-0.7 / TASK-0.7.5 · Sprint 0
# =============================================================================
# Dono: Henrique Matsuda (Platform/SRE) · Requisito: Sato §12.2 · Mariana §Contrato.
#
# POR QUE ESTE SCRIPT EXISTE, E NÃO FOI EXECUTADO POR MIM (Henrique/agente):
#   Configurar branch protection é uma escrita na API de administração do
#   GitHub. Exige um `gh` AUTENTICADO com escopo de admin no repositório. No
#   ambiente onde a Sprint 0 foi construída o `gh` está instalado mas NÃO
#   autenticado, e `gh auth login` é interativo. Portanto entrego este script
#   idempotente para VOCÊ (mantenedor) rodar após `gh auth login`.
#
# PRÉ-REQUISITOS:
#   1. gh instalado (>= 2.x).
#   2. gh auth login  → escolha GitHub.com, protocolo HTTPS, e um token/OAuth
#      com permissão de ADMIN no repositório Os-Guri-do-Vibe/movivo.
#   3. O workflow .github/workflows/ci.yml já precisa ter rodado ao menos uma
#      vez em um PR/branch para o GitHub "conhecer" os nomes dos status checks.
#
# USO:
#   bash scripts/setup-branch-protection.sh
#   REPO=Os-Guri-do-Vibe/movivo BRANCH=main bash scripts/setup-branch-protection.sh
#   DRY_RUN=1 bash scripts/setup-branch-protection.sh   # só imprime o payload
#
# O QUE APLICA (idempotente — reexecutar converge para o mesmo estado):
#   · PR obrigatório antes de merge, com >= 1 aprovação.
#   · Dispensa aprovações obsoletas quando novo commit é enviado.
#   · TODOS os status checks do CI verdes e atualizados (strict) antes do merge:
#       quality · integration · e2e · secret-scan · sast · sca
#   · Proíbe force-push e deleção da branch.
#   · Aplica as regras também a administradores (enforce_admins).
#   · Exige resolução de conversas antes do merge.
# =============================================================================
set -euo pipefail

REPO="${REPO:-Os-Guri-do-Vibe/movivo}"
BRANCH="${BRANCH:-main}"
DRY_RUN="${DRY_RUN:-0}"

# Nomes EXATOS dos status checks = campo `name:` de cada job em ci.yml.
# Se você renomear um job no workflow, atualize aqui também.
read -r -d '' PAYLOAD <<'JSON' || true
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["quality", "integration", "e2e", "secret-scan", "sast", "sca"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 1
  },
  "required_conversation_resolution": true,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON

echo "MOVIVO · branch protection"
echo "  repo:   ${REPO}"
echo "  branch: ${BRANCH}"

if [ "$DRY_RUN" = "1" ]; then
  echo "  (DRY_RUN=1 — nada será aplicado; payload abaixo)"
  echo "$PAYLOAD"
  exit 0
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "ERRO: 'gh' não encontrado. Instale o GitHub CLI e rode 'gh auth login'." >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "ERRO: 'gh' não está autenticado. Rode 'gh auth login' (escopo admin do repo)." >&2
  exit 1
fi

# PUT é idempotente: substitui a proteção inteira pelo estado declarado acima.
echo "$PAYLOAD" | gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  "repos/${REPO}/branches/${BRANCH}/protection" \
  --input - >/dev/null

echo "  ✓ branch protection aplicada em ${REPO}@${BRANCH}"
echo "  Verifique em: https://github.com/${REPO}/settings/branches"
