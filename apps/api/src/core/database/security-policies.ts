/**
 * Políticas de Row-Level Security (US-1.1 / TASK-1.1.2 / TASK-1.1.4 — Sato §4).
 *
 * ## Por que aqui, e não numa migração versionada do drizzle-kit
 * O `drizzle-kit` não emite `FORCE ROW LEVEL SECURITY` nem políticas que dependem
 * de `current_setting('app.current_user_id')`. Seguimos o **mesmo padrão** que a
 * Sprint 0 já adotou para as coisas que o gerador não expressa (extensões e grants
 * em `migrate.ts`): reconciliar por SQL **idempotente** no runner de migração. Assim
 * `db:generate` continua sem diff residual (a RLS não está no schema TS) e a política
 * é reaplicada de forma determinística em todo banco (dev, CI, staging, prod).
 *
 * ## Contexto de tenant (GUCs de sessão)
 * O `TenantDatabase` emite, por transação, via `set_config(..., is_local := true)`:
 *  - `app.current_user_id` — UUID do titular (ausente/NULL nos contextos anônimo e sistema);
 *  - `app.current_role`    — `USER` | `PROFESSIONAL` | `ADMIN` | `SYSTEM` | `ANONYMOUS`.
 *
 * `current_setting(name, true)` usa o 2º argumento `true` → devolve NULL quando o
 * GUC não foi setado, em vez de erro. NULL em qualquer comparação ⇒ falso ⇒
 * **fail-closed**: sem contexto, nenhuma linha é visível.
 *
 * ## Fase anônima da anamnese (TASK-1.1.4)
 * Enquanto `anamnesis_sessions.user_id IS NULL`, a linha não tem titular para a RLS
 * comparar. O isolamento dessa fase é dado pelo **token opaco de 122 bits** (CSPRNG)
 * + filtro `WHERE token = $1` na aplicação, que **nunca** aceita `user_id` do cliente
 * (proteção IDOR — Sato §8.1). A policy só **permite** o acesso à fase anônima quando
 * `app.current_role = 'ANONYMOUS'`; ela não substitui o filtro por token. No submit, o
 * `user_id` é vinculado (contexto `SYSTEM`) e a linha passa a ser protegida por RLS
 * como as demais.
 */

/**
 * Tabelas de Sprint 1 sob RLS e a coluna-âncora do titular em cada uma.
 * `users` ancora pela própria PK (`id`); as demais, por `user_id`.
 */
const TENANT_TABLES: ReadonlyArray<{ table: string; column: string; anonymousPhase?: boolean }> = [
  { table: 'users', column: 'id' },
  // `consents` tem fase anônima pelo mesmo motivo da anamnese (US-1.2): o
  // consentimento de saúde é registrado na tela-ponte, ANTES de o `users` existir
  // (que só nasce no submit). A âncora nessa fase é `anamnesis_session_id`, e o
  // acesso é token-scoped no serviço — a policy só não pode bloquear a linha órfã.
  { table: 'consents', column: 'user_id', anonymousPhase: true },
  { table: 'anamnesis_sessions', column: 'user_id', anonymousPhase: true },
  { table: 'auth_sessions', column: 'user_id' },
];

const UID = `current_setting('app.current_user_id', true)`;
const ROLE = `current_setting('app.current_role', true)`;

/** Nomes de política determinísticos por tabela (permite DROP idempotente). */
function policyNames(table: string) {
  return {
    select: `${table}_rls_select`,
    insert: `${table}_rls_insert`,
    update: `${table}_rls_update`,
    delete: `${table}_rls_delete`,
  };
}

/**
 * SQL idempotente que ativa RLS `FORCE` e (re)cria as políticas de todas as
 * tabelas de titular de Sprint 1. Roda como `movivo_migrator` (dono das tabelas)
 * no runner de migração, logo após os grants.
 *
 * `FORCE ROW LEVEL SECURITY` sujeita **até o dono** à RLS — por isso a role de
 * manutenção (`movivo_migrator`) precisa de `BYPASSRLS` para seeds e migrações de
 * dados (ver `infra/postgres/init/02-roles.sh`). A role de runtime `movivo_app`
 * permanece `NOBYPASSRLS` e não-dona: para ela, a RLS é inescapável.
 */
export function buildRlsPoliciesSql(): string {
  const statements: string[] = [];

  for (const { table, column, anonymousPhase } of TENANT_TABLES) {
    const p = policyNames(table);
    const self = `("${column}"::text = ${UID})`;
    const system = `(${ROLE} = 'SYSTEM')`;
    const admin = `(${ROLE} = 'ADMIN')`;

    // Visibilidade padrão: o próprio titular, mais os contextos de sistema/admin.
    let visible = `${self} OR ${system} OR ${admin}`;
    // Anamnese: acrescenta a fase anônima (linha sem titular + contexto ANONYMOUS).
    if (anonymousPhase) {
      visible += ` OR ("${column}" IS NULL AND ${ROLE} = 'ANONYMOUS')`;
    }

    // Criação de titular / linha de fase anônima: permitida sem contexto de tenant
    // (onboarding público e operações de sistema) ou dentro do próprio contexto.
    const insertCheck =
      table === 'users' ? `${UID} IS NULL OR ${self} OR ${system} OR ${admin}` : visible;

    statements.push(
      `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`,
      // FORCE vale até para o dono — defesa contra ownership virar escape de RLS.
      `ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`,
      `DROP POLICY IF EXISTS "${p.select}" ON "${table}"`,
      `DROP POLICY IF EXISTS "${p.insert}" ON "${table}"`,
      `DROP POLICY IF EXISTS "${p.update}" ON "${table}"`,
      `DROP POLICY IF EXISTS "${p.delete}" ON "${table}"`,
      `CREATE POLICY "${p.select}" ON "${table}" FOR SELECT USING (${visible})`,
      `CREATE POLICY "${p.insert}" ON "${table}" FOR INSERT WITH CHECK (${insertCheck})`,
      `CREATE POLICY "${p.update}" ON "${table}" FOR UPDATE USING (${visible}) WITH CHECK (${visible})`,
    );

    // DELETE: `consents` é append-only (revogação = UPDATE em `revoked_at`), então
    // **não** recebe policy de DELETE — todo DELETE é negado (fail-closed), o que
    // reforça a trilha de prova de consentimento (Sato §11 / schema `consents.ts`).
    // As demais só permitem DELETE em contexto de sistema/admin (expurgo/limpeza).
    if (table !== 'consents') {
      statements.push(
        `CREATE POLICY "${p.delete}" ON "${table}" FOR DELETE USING (${system} OR ${admin})`,
      );
    }
  }

  // `;` como separador — executado por `sql.unsafe` (simple query, multi-statement),
  // o mesmo caminho já usado pelos grants em `migrate.ts`.
  return statements.map((s) => `${s};`).join('\n');
}

/** Tabelas cobertas — reutilizado pelo teste de integração de isolamento (US-1.8). */
export const RLS_TENANT_TABLES = TENANT_TABLES.map((t) => t.table);
