#!/usr/bin/env bash
# =============================================================================
# MOVIVO — Gerador de Docker Secrets para o ambiente LOCAL
# =============================================================================
# Dono: Henrique (Platform/SRE) · US-0.6 / TASK-0.6.2
#
# Uso:
#   bash scripts/gen-local-secrets.sh              # gera o que faltar (idempotente)
#   bash scripts/gen-local-secrets.sh --force      # ROTACIONA tudo (sobrescreve)
#   bash scripts/gen-local-secrets.sh --print-path # só mostra o diretório alvo
#
# No Windows use o Git Bash (já instalado com o Git for Windows) ou rode o
# equivalente nativo: pwsh/powershell scripts/gen-local-secrets.ps1
#
# O que gera em ./secrets/ (diretório 100% ignorado pelo Git):
#   postgres_superuser_password   senha do superusuário (bootstrap do cluster)
#   postgres_app_password         senha da role movivo_app  (runtime, sem BYPASSRLS)
#   postgres_migrator_password    senha da role movivo_migrator (migrações)
#   redis_password                requirepass do Redis master/replica/sentinel
#   pgcrypto_key                  chave de criptografia de dados de saúde (Sprint 2)
#   pgbouncer_userlist.txt        auth_file do PgBouncer, derivado das senhas acima
#
# Estes valores são DESCARTÁVEIS e válidos apenas para a sua máquina. Nunca
# reutilize um secret local em staging/produção. Após `--force`, recrie os
# volumes do Postgres (`make reset`) — a senha das roles já criadas não muda
# sozinha.
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRETS_DIR="${REPO_ROOT}/secrets"

FORCE=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --print-path) echo "$SECRETS_DIR"; exit 0 ;;
    -h|--help) sed -n '2,30p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "ERRO: argumento desconhecido '$arg'" >&2; exit 2 ;;
  esac
done

# --- Geração de valor aleatório ----------------------------------------------
# Charset alfanumérico de propósito: a senha entra no userlist.txt do PgBouncer
# (delimitado por aspas) e em DSNs; aspas, barras e '@' quebrariam o parsing.
# 40 chars de [A-Za-z0-9] ≈ 238 bits de entropia — folga sobre qualquer política.
rand_token() {
  local len="${1:-40}"
  if command -v openssl >/dev/null 2>&1; then
    LC_ALL=C openssl rand -base64 256 | LC_ALL=C tr -dc 'A-Za-z0-9' | head -c "$len"
  else
    LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c "$len"
  fi
}

write_secret() {
  local name="$1" value="$2" path="${SECRETS_DIR}/$1"
  if [ -f "$path" ] && [ "$FORCE" -eq 0 ]; then
    echo "  = ${name} (mantido — use --force para rotacionar)"
    return 0
  fi
  # printf sem newline: o consumidor faz trim, mas evitamos o problema na fonte.
  printf '%s' "$value" > "$path"
  # 0644, não 0600: no Docker do Linux (CI) os secrets são bind-mount do arquivo do
  # host, e o init do Postgres roda como o usuário `postgres` (UID 999). Um arquivo
  # 0600 de outro dono é ilegível para ele — as roles nasceriam SEM senha e a
  # migração falharia com "password authentication failed". A confidencialidade na
  # máquina local é preservada pelo `chmod 700` no diretório `secrets/` abaixo:
  # outro usuário não consegue entrar na pasta, mesmo os arquivos sendo 0644.
  chmod 644 "$path" 2>/dev/null || true
  echo "  + ${name} (${#value} bytes)"
}

read_secret() { cat "${SECRETS_DIR}/$1"; }

# --- Execução -----------------------------------------------------------------
mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR" 2>/dev/null || true

echo "MOVIVO · gerando Docker Secrets locais em: ${SECRETS_DIR}"
[ "$FORCE" -eq 1 ] && echo "  (modo --force: TODOS os secrets serão rotacionados)"

write_secret "postgres_superuser_password" "$(rand_token 40)"
write_secret "postgres_app_password"       "$(rand_token 40)"
write_secret "postgres_migrator_password"  "$(rand_token 40)"
write_secret "redis_password"              "$(rand_token 48)"
write_secret "pgcrypto_key"                "$(rand_token 64)"

# --- userlist.txt do PgBouncer ------------------------------------------------
# Sempre reescrito a partir dos arquivos de senha vigentes, para nunca ficar
# dessincronizado do Postgres. Senha em claro é aceitável aqui porque o arquivo
# é um Docker Secret montado somente-leitura, fora da imagem, e o auth_type é
# scram-sha-256 — o pooler deriva o SCRAM ao falar com o servidor.
APP_USER="${POSTGRES_APP_USER:-movivo_app}"
MIGRATOR_USER="${POSTGRES_MIGRATOR_USER:-movivo_migrator}"
USERLIST="${SECRETS_DIR}/pgbouncer_userlist.txt"
{
  printf '"%s" "%s"\n' "$APP_USER"      "$(read_secret postgres_app_password)"
  printf '"%s" "%s"\n' "$MIGRATOR_USER" "$(read_secret postgres_migrator_password)"
} > "$USERLIST"
# 0644 pelo mesmo motivo dos arquivos de senha (ver write_secret): no Docker do
# Linux o PgBouncer roda como o usuário do container e precisa LER este auth_file
# bind-montado. Com 0600 de outro dono ele sobe com userlist vazio e toda auth
# via pooler falha com "SASL authentication failed". O diretório 700 protege a
# confidencialidade local.
chmod 644 "$USERLIST" 2>/dev/null || true
echo "  + pgbouncer_userlist.txt (${APP_USER}, ${MIGRATOR_USER})"

# --- Guarda de segurança ------------------------------------------------------
# Prova, no próprio script, que nada gerado aqui é visível para o Git.
if command -v git >/dev/null 2>&1 && git -C "$REPO_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  leaked="$(git -C "$REPO_ROOT" ls-files --cached --others --exclude-standard -- secrets/ \
            | grep -v -E '^secrets/(README\.md|\.gitkeep)$' || true)"
  if [ -n "$leaked" ]; then
    echo "ERRO CRÍTICO: arquivo de secret visível para o Git:" >&2
    echo "$leaked" >&2
    exit 1
  fi
  echo "  ✓ verificação: nenhum secret visível para o Git"
fi

cat <<'EOF'

Pronto. Próximos passos:
  1. cp .env.example .env                       (raiz — perfil do Docker Compose)
  2. cp apps/api/.env.example apps/api/.env     (API rodando no host)
  3. cp apps/web/.env.example apps/web/.env.local
  4. docker compose -f docker-compose.yml -f docker-compose.secrets.yml up -d   (US-0.2)

Nunca imprima, cole em chat/issue nem commite o conteúdo de secrets/.
EOF
