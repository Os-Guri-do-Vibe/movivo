#!/usr/bin/env bash
# =============================================================================
# MOVIVO — Gera os segredos INTERNOS de produção, NA PRÓPRIA VPS
# =============================================================================
# Dono: Henrique (Platform/SRE)
#
# Roda na VPS como `deploy` (o deploy.sh chama via `ssh ... bash -s`). Os valores
# nascem e ficam em /opt/movivo/secrets — nunca passam pelo Mac, pelo Git nem
# pelo chat. Nada aqui é reaproveitado do dev.
#
# SEM --force, de propósito: o Postgres grava as senhas das roles no initdb, e o
# pgcrypto_key cifra dado de saúde em repouso. "Regenerar" qualquer um deles com
# o banco já criado tranca a aplicação fora do banco ou torna dado ilegível.
# Rotação é procedimento próprio (docs/SECURITY.md), não flag de script.
# Arquivo que já existe é mantido; só o que falta é criado.
#
# Chaves de API de terceiros (OpenAI, Anthropic, DeepSeek, Groq, AraraHQ, Asaas)
# NÃO são geradas aqui — vêm do deploy.sh.
# =============================================================================
set -euo pipefail

SECRETS_DIR="${SECRETS_DIR:-/opt/movivo/secrets}"

rand_token() {
  LC_ALL=C openssl rand -base64 512 | LC_ALL=C tr -dc 'A-Za-z0-9' | head -c "$1"
}

# 0644 dentro de um diretório 0700: o Compose monta cada arquivo por bind mount e
# o Postgres do container lê como uid 999; o 0700 do diretório é o que impede
# outro usuário do host de chegar nos arquivos.
write_if_missing() {
  local name="$1" value="$2" path="${SECRETS_DIR}/$1"
  if [[ -s "$path" ]]; then
    echo "  = ${name} (mantido)"
    return 0
  fi
  (umask 022; printf '%s' "$value" > "$path")
  chmod 644 "$path"
  echo "  + ${name}"
}

install -d -m 700 "$SECRETS_DIR"
echo "MOVIVO · segredos internos de produção em ${SECRETS_DIR}"

write_if_missing postgres_superuser_password "$(rand_token 40)"
write_if_missing postgres_app_password       "$(rand_token 40)"
write_if_missing postgres_migrator_password  "$(rand_token 40)"
write_if_missing redis_password              "$(rand_token 48)"
write_if_missing pgcrypto_key                "$(rand_token 64)"
write_if_missing evolution_postgres_password "$(rand_token 40)"
write_if_missing evolution_api_key           "$(rand_token 40)"
write_if_missing evolution_webhook_token     "$(rand_token 48)"
# authToken que o Asaas manda no header `asaas-access-token` (schema: 32–255).
write_if_missing asaas_webhook_secret        "$(rand_token 48)"
# Chave do backup (backup/movivo-backup.sh). Perdê-la = perder os dumps.
write_if_missing backup_encryption_key       "$(rand_token 64)"

if [[ -s "${SECRETS_DIR}/jwt_private_key" && -s "${SECRETS_DIR}/jwt_public_key" ]]; then
  echo "  = jwt_private_key/jwt_public_key (mantidos)"
else
  (umask 022
   openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 \
     -out "${SECRETS_DIR}/jwt_private_key" 2>/dev/null
   openssl pkey -in "${SECRETS_DIR}/jwt_private_key" -pubout \
     -out "${SECRETS_DIR}/jwt_public_key" 2>/dev/null)
  chmod 644 "${SECRETS_DIR}/jwt_private_key" "${SECRETS_DIR}/jwt_public_key"
  echo "  + jwt_private_key + jwt_public_key (RS256, 2048 bits)"
fi

# Derivado das duas senhas acima — sempre reescrito, coerente por construção.
{
  printf '"%s" "%s"\n' movivo_app      "$(cat "${SECRETS_DIR}/postgres_app_password")"
  printf '"%s" "%s"\n' movivo_migrator "$(cat "${SECRETS_DIR}/postgres_migrator_password")"
} > "${SECRETS_DIR}/pgbouncer_userlist.txt"
chmod 644 "${SECRETS_DIR}/pgbouncer_userlist.txt"
echo "  + pgbouncer_userlist.txt (derivado)"
