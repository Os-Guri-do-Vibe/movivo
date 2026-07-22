#!/bin/bash
# =============================================================================
# MOVIVO — Criação das roles de migração e de runtime do PostgreSQL
# =============================================================================
# Dono: Henrique (Platform/SRE) · US-0.2 / TASK-0.2.1
# Requisitos de origem:
#   · Sprint 0, regra inegociável #8 — `movivo_app` NUNCA com BYPASSRLS e nunca
#     dona das tabelas.
#   · ARQUITETURA.md §8 / §12.13 — RLS forçada sob PgBouncer transaction mode.
#   · 11-relatorio-sato.md §4.3 — separação migrador/aplicação (least privilege).
#   · SECURITY.md §2 — senhas SÓ via Docker Secret; nada em `environment:`.
#
# POR QUE UM .sh E NÃO UM .sql:
#   as senhas vivem em /run/secrets/* e precisam ser lidas em tempo de execução.
#   Um .sql não consegue ler arquivo do host. Aqui lemos o secret e o passamos ao
#   psql como VARIÁVEL (-v), nunca por interpolação de shell dentro do SQL: o
#   psql aplica o quoting correto com :'var' (literal) e :"var" (identificador),
#   o que elimina qualquer possibilidade de injeção via conteúdo do secret.
#
# A senha NUNCA aparece em `ps`: `psql -v` recebe o valor via argv do psql, que
# roda dentro do container de init e morre em seguida. Mesmo assim, o valor não
# é ecoado em nenhum ponto deste script.
#
# Este script é executado pelo entrypoint da imagem oficial, que faz `source`
# nos .sh de /docker-entrypoint-initdb.d/ quando eles não têm bit de execução
# (é o nosso caso: o repositório é clonado em Windows). Por isso TODO o corpo
# roda dentro de um subshell: `set -euo pipefail` aqui dentro não vaza para o
# shell do entrypoint, e um erro nosso ainda aborta o init via `|| exit 1`.
# =============================================================================

( # ── início do subshell isolado ──────────────────────────────────────────────
set -euo pipefail

APP_USER="${POSTGRES_APP_USER:-movivo_app}"
MIGRATOR_USER="${POSTGRES_MIGRATOR_USER:-movivo_migrator}"

APP_PASSWORD_FILE="${POSTGRES_APP_PASSWORD_FILE:-/run/secrets/postgres_app_password}"
MIGRATOR_PASSWORD_FILE="${POSTGRES_MIGRATOR_PASSWORD_FILE:-/run/secrets/postgres_migrator_password}"

# Falha rápida e explícita: um banco que sobe sem as roles é pior que um banco
# que não sobe — o erro só apareceria no boot da API, longe da causa.
for f in "$APP_PASSWORD_FILE" "$MIGRATOR_PASSWORD_FILE"; do
  if [ ! -s "$f" ]; then
    echo "[movivo/init] ERRO FATAL: secret ausente ou vazio: $f" >&2
    echo "[movivo/init] Rode scripts/gen-local-secrets.(sh|ps1) antes do 'up'." >&2
    exit 1
  fi
done

# `tr -d` remove um newline final acidental: ele entraria DENTRO da senha e
# quebraria a autenticação silenciosamente (o gerador já grava sem newline,
# mas isto protege contra um secret editado à mão).
APP_PASSWORD="$(tr -d '\r\n' < "$APP_PASSWORD_FILE")"
MIGRATOR_PASSWORD="$(tr -d '\r\n' < "$MIGRATOR_PASSWORD_FILE")"

echo "[movivo/init] criando roles '${MIGRATOR_USER}' (migrações) e '${APP_USER}' (runtime)..."

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  -v app_user="$APP_USER" \
  -v app_pw="$APP_PASSWORD" \
  -v migrator_user="$MIGRATOR_USER" \
  -v migrator_pw="$MIGRATOR_PASSWORD" \
  -v db_name="$POSTGRES_DB" <<'EOSQL'

-- ---------------------------------------------------------------------------
-- 1. Roles
-- ---------------------------------------------------------------------------
-- `movivo_migrator`: dono do schema. Roda drizzle-kit (US-0.4) conectando
-- DIRETO na 5432 — DDL e advisory locks de migração não sobrevivem ao
-- transaction pooling do PgBouncer. NUNCA é usada em runtime.
-- NOBYPASSRLS também aqui: como dona das tabelas ela já ignora RLS por
-- definição (a menos que FORCE ROW LEVEL SECURITY esteja ativo), então o
-- atributo não deve somar mais um caminho de escape.
CREATE ROLE :"migrator_user"
  LOGIN
  PASSWORD :'migrator_pw'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOBYPASSRLS
  NOREPLICATION
  INHERIT;

-- `movivo_app`: a ÚNICA role usada pela API em runtime, sempre via PgBouncer
-- (5433). NOBYPASSRLS é a regra inegociável #8 da Sprint 0 — sem ela, a RLS
-- que protege o isolamento entre titulares de dados de saúde seria decorativa.
CREATE ROLE :"app_user"
  LOGIN
  PASSWORD :'app_pw'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOBYPASSRLS
  NOREPLICATION
  INHERIT;

-- ---------------------------------------------------------------------------
-- 2. Privilégios de banco — fecha o default permissivo do PostgreSQL
-- ---------------------------------------------------------------------------
REVOKE ALL ON DATABASE :"db_name" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"db_name" TO :"migrator_user";
-- O app NÃO recebe TEMPORARY: não precisa de tabelas temporárias e isso remove
-- um vetor de consumo de disco por sessão sob transaction pooling.
GRANT CONNECT ON DATABASE :"db_name" TO :"app_user";

-- ---------------------------------------------------------------------------
-- 3. Schema public — propriedade vai para o migrador
-- ---------------------------------------------------------------------------
-- Consequência prática: tudo que o drizzle-kit criar nasce com owner
-- `movivo_migrator`. `movivo_app` jamais será dona de uma tabela, o que é
-- exatamente o que a regra #8 exige (dono de tabela contorna RLS não-FORCE).
ALTER SCHEMA public OWNER TO :"migrator_user";
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO :"migrator_user";
GRANT USAGE ON SCHEMA public TO :"app_user";   -- USAGE, nunca CREATE.

-- ---------------------------------------------------------------------------
-- 4. Default privileges — o app enxerga o que o migrador criar, sem ser dono
-- ---------------------------------------------------------------------------
-- Sem isto, cada migração exigiria um GRANT manual e alguém acabaria "resolvendo"
-- rodando a app como dona das tabelas. Automatizar aqui protege a regra #8.
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_user" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_user" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_user" IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO :"app_user";

-- Objetos que já existem (tabelas de catálogo das extensões do 01-extensions).
GRANT SELECT ON ALL TABLES IN SCHEMA public TO :"app_user";
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO :"app_user";

-- ---------------------------------------------------------------------------
-- 5. Defaults de sessão por role
-- ---------------------------------------------------------------------------
-- search_path fixo: sob PgBouncer transaction mode a sessão é reciclada entre
-- clientes; depender de um search_path setado em runtime é fonte de bug sutil.
ALTER ROLE :"migrator_user" IN DATABASE :"db_name" SET search_path = public;
ALTER ROLE :"app_user"      IN DATABASE :"db_name" SET search_path = public;

-- Guarda-corpo de disponibilidade: uma query travada em transaction pooling
-- segura um server slot do pool e derruba a latência de todo mundo.
ALTER ROLE :"app_user" IN DATABASE :"db_name" SET statement_timeout = '30s';
ALTER ROLE :"app_user" IN DATABASE :"db_name" SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE :"app_user" IN DATABASE :"db_name" SET lock_timeout = '5s';
-- O migrador precisa de folga: CREATE INDEX em tabela grande pode passar de 30s.
ALTER ROLE :"migrator_user" IN DATABASE :"db_name" SET statement_timeout = '0';

EOSQL

echo "[movivo/init] verificando atributos das roles (guarda de regressão da regra #8)..."
# A verificação roda AQUI, no init, e não só no relatório: se um dia alguém
# afrouxar o CREATE ROLE acima, o container falha no boot em vez de subir um
# banco onde a RLS é decorativa.
# Nota de psql: a substituição de :'var' NÃO acontece dentro de string
# dollar-quoted ($$...$$). Por isso o nome da role entra por um GUC de sessão
# (set_config) e o bloco PL/pgSQL o lê com current_setting().
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_user="$APP_USER" -v migrator_user="$MIGRATOR_USER" <<'EOSQL'
SELECT set_config('movivo.app_user', :'app_user', false);

DO $$
DECLARE
  v_role    text := current_setting('movivo.app_user');
  v_bypass  boolean;
  v_super   boolean;
  v_ntables integer;
BEGIN
  SELECT rolbypassrls, rolsuper INTO v_bypass, v_super
    FROM pg_roles WHERE rolname = v_role;

  IF v_bypass IS NULL THEN
    RAISE EXCEPTION 'FALHA: a role de aplicacao "%" nao foi criada.', v_role;
  END IF;
  IF v_bypass THEN
    RAISE EXCEPTION 'FALHA DE SEGURANCA: a role "%" tem BYPASSRLS (regra #8).', v_role;
  END IF;
  IF v_super THEN
    RAISE EXCEPTION 'FALHA DE SEGURANCA: a role "%" e superusuario.', v_role;
  END IF;

  SELECT count(*) INTO v_ntables
    FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
   WHERE r.rolname = v_role AND c.relkind IN ('r', 'p');
  IF v_ntables > 0 THEN
    RAISE EXCEPTION 'FALHA DE SEGURANCA: a role "%" e dona de % tabela(s).', v_role, v_ntables;
  END IF;
END $$;

\echo '--- atributos finais das roles MOVIVO ---'
SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin
  FROM pg_roles
 WHERE rolname IN (:'app_user', :'migrator_user')
 ORDER BY rolname;
EOSQL

echo "[movivo/init] OK — roles criadas; ${APP_USER} sem BYPASSRLS e sem ownership."

) || exit 1
# ── fim do subshell isolado ─────────────────────────────────────────────────
