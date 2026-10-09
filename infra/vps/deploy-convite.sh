#!/usr/bin/env bash
# =============================================================================
# MOVIVO — Publica a página de convite (THE FIRST 100) em convite.movivo.com.br
# =============================================================================
# Dono: Henrique (Platform/SRE)
#
# Uso (do Mac, na raiz do repo):
#   infra/vps/deploy-convite.sh [CAMINHO_DA_PAGINA]
#
# CAMINHO_DA_PAGINA é o checkout do repo movivo-the-first-100 (padrão:
# ../movivo-the-first-100). A página é um export estático do Next: o script
# compila, confere o resultado e sincroniza out/ para /opt/movivo/sites/convite
# na VPS. O Nginx lê essa pasta por bind mount somente leitura — publicar
# conteúdo novo NÃO precisa de deploy do produto nem de reload do Nginx.
#
# Pré-requisito (uma vez): o deploy do produto com o server_name
# convite.movivo.com.br já ter rodado (merge no main → workflow Deploy), e o
# registro A `convite` com proxy ligado na Cloudflare.
#
# As variáveis NEXT_PUBLIC_* são gravadas no bundle no build e aqui têm
# precedência sobre o .env da página (que aponta para movivo.com.br).
# Sobrescreva SITE_URL/ALLOW_INDEXING só ao abrir a página ao público.
# =============================================================================
set -euo pipefail

VPS="${VPS:-deploy@187.127.40.87}"
DEST=/opt/movivo/sites/convite
SITE_URL="${CONVITE_SITE_URL:-https://convite.movivo.com.br}"
ALLOW_INDEXING="${CONVITE_ALLOW_INDEXING:-false}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

log() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }

case "${1:-}" in -h|--help) sed -n '2,24p' "$0"; exit 0 ;; esac

page="$(cd "${1:-$REPO_ROOT/../movivo-the-first-100}" 2>/dev/null && pwd)" \
  || die "pasta da página não encontrada (passe o caminho como argumento)"
[[ -f "$page/package.json" ]] && grep -q '"name": "movivo-the-first-100"' "$page/package.json" \
  || die "$page não é o projeto movivo-the-first-100"
command -v rsync >/dev/null || die "rsync não instalado"

# -----------------------------------------------------------------------------
log "1/3 Build estático (${SITE_URL}, indexação=${ALLOW_INDEXING})"
cd "$page"
rm -rf out
npm ci --no-audit --no-fund
NEXT_PUBLIC_SITE_URL="$SITE_URL" NEXT_PUBLIC_ALLOW_INDEXING="$ALLOW_INDEXING" npm run build

[[ -s out/index.html && -s out/404.html ]] || die "build não gerou out/index.html e out/404.html"
grep -q "$SITE_URL" out/index.html || die "out/index.html não referencia ${SITE_URL} (variável NEXT_PUBLIC_SITE_URL não entrou no build)"
if [[ "$ALLOW_INDEXING" != true ]]; then
  grep -q 'Disallow: /' out/robots.txt || die "robots.txt deveria bloquear a indexação"
fi

# -----------------------------------------------------------------------------
log "2/3 Sincronizando para ${VPS}:${DEST}"
# --delete: a pasta espelha o out/ (some arquivo removido da página).
# Permissões explícitas (-a preserva): o Nginx do container roda como usuário sem
# privilégio. Feito com chmod local porque o rsync do macOS não tem --chmod.
chmod -R u=rwX,go=rX out
rsync -az --delete out/ "${VPS}:${DEST}/"

# -----------------------------------------------------------------------------
log "3/3 Smoke test pelo Cloudflare"
smoke_ok=1
for path in / /robots.txt /favicon.svg; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "${SITE_URL}${path}" || true)"
  echo "  ${code}  ${SITE_URL}${path}"
  [[ "$code" == "200" ]] || smoke_ok=0
done
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "${SITE_URL}/nao-existe/" || true)"
echo "  ${code}  ${SITE_URL}/nao-existe/ (esperado 404)"
[[ "$code" == "404" ]] || smoke_ok=0
[[ $smoke_ok -eq 1 ]] || die "smoke test falhou (o deploy do produto com o server_name convite já rodou? DNS com proxy ligado?)"
log "Convite no ar: ${SITE_URL}/"
