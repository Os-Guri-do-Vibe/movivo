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
 * ## Fase anônima da anamnese (TASK-1.1.4) + escopo por sessão (Sato — achado 1)
 * Enquanto `anamnesis_sessions.user_id IS NULL`, a linha não tem titular para a RLS
 * comparar. A defesa primária é o **token opaco** (CSPRNG, 256 bits) + `WHERE token`
 * na aplicação, que nunca aceita `user_id` do cliente (IDOR — Sato §8.1). Mas isso
 * deixava a única barreira na aplicação: uma policy anônima checando apenas
 * `user_id IS NULL AND role='ANONYMOUS'` liberava QUALQUER linha órfã. Adicionamos
 * **defense-in-depth por sessão** com o GUC `app.current_anamnesis_session_id`
 * (setado por `runAsTokenScoped`):
 *  - **leitura** anônima: permitida quando o GUC não está setado (o lookup inicial
 *    `token → sessão`, que ainda não conhece o id — o token é o segredo que protege)
 *    OU quando a coluna de escopo bate o GUC;
 *  - **escrita** anônima (UPDATE/INSERT de consentimento): exige o GUC batendo a
 *    sessão — sem o GUC certo, nenhuma linha órfã de outra sessão é alterada.
 *
 * A criação de uma sessão nova (`INSERT` em `anamnesis_sessions`) é a exceção: o `id`
 * é gerado pelo banco e ainda não existe para comparar — o INSERT anônimo é liberado
 * pela condição de órfã, pois criar a própria linha nova não vaza outra sessão.
 * No submit o `user_id` é vinculado (contexto `SYSTEM`) e a linha passa a RLS por titular.
 */

/**
 * Tabelas de Sprint 1 sob RLS e a coluna-âncora do titular em cada uma.
 * `users` ancora pela própria PK (`id`); as demais, por `user_id`.
 */
interface TenantTable {
  table: string;
  /** Coluna-âncora do titular (RLS por `user_id`). `users` ancora pela PK. */
  column: string;
  /**
   * Configuração da fase anônima (anamnese/consent). `scope` é a coluna comparada
   * ao GUC `app.current_anamnesis_session_id`; `scopeAtInsert` exige o escopo já no
   * INSERT (consents) — quando o INSERT cria a própria sessão (`id` gerado no banco)
   * o escopo não é aplicável (anamnesis_sessions), então fica `false`.
   */
  anon?: { scope: string; scopeAtInsert: boolean };
}

const TENANT_TABLES: ReadonlyArray<TenantTable> = [
  { table: 'users', column: 'id' },
  // `consents` tem fase anônima pelo mesmo motivo da anamnese (US-1.2): o
  // consentimento de saúde é registrado na tela-ponte, ANTES de o `users` existir
  // (que só nasce no submit). A âncora nessa fase é `anamnesis_session_id`, escopada
  // ao GUC da sessão — o INSERT do consentimento já nasce preso à sessão do token.
  {
    table: 'consents',
    column: 'user_id',
    anon: { scope: 'anamnesis_session_id', scopeAtInsert: true },
  },
  { table: 'anamnesis_sessions', column: 'user_id', anon: { scope: 'id', scopeAtInsert: false } },
  { table: 'auth_sessions', column: 'user_id' },
  // Sprint 2 (US-2.2): a trilha de invocações de LLM carrega snapshot pseudonimizado
  // de dado de saúde — entra sob a mesma FORCE RLS das tabelas de titular.
  { table: 'ai_jobs', column: 'user_id' },
  // Sprint 2 (US-2.4): o protocolo é dado de saúde derivado (personalizado a partir de
  // condição/limitação física) — sob a mesma FORCE RLS por titular. `protocol_versions`
  // tem `user_id` denormalizado justamente para ancorar a RLS sem JOIN (Sato §4.5).
  { table: 'protocols', column: 'user_id' },
  { table: 'protocol_versions', column: 'user_id' },
  // Sprint 3 (US-3.2): resumo de longo prazo da conversa de saúde — mesma FORCE RLS por titular.
  { table: 'coaching_sessions', column: 'user_id' },
  // Sprint 3 (US-3.6): alerta/handoff ao painel CREF — dado de titular, isolado por RLS FORCE.
  { table: 'handoff_alerts', column: 'user_id' },
  // Sprint 4 (US-4.1): assinatura/dado financeiro do titular — sob a mesma FORCE RLS.
  { table: 'subscriptions', column: 'user_id' },
];

// `nullif(..., '')` é OBRIGATÓRIO, não cosmético: sob PgBouncer transaction mode,
// um GUC customizado setado via `SET LOCAL` numa transação anterior reverte, no
// backend reusado, para **string vazia** (`''`) — não para "não-setado". Sem o
// `nullif`, `<guc> IS NULL` daria falso (`'' IS NULL` = false) e as políticas de
// fase anônima esconderiam a própria linha recém-criada. `nullif('', '')` = NULL
// restaura a semântica "ausente ⇒ NULL ⇒ fail-closed".
const UID = `nullif(current_setting('app.current_user_id', true), '')`;
const ROLE = `nullif(current_setting('app.current_role', true), '')`;
/** GUC de escopo da sessão anônima (Sato — achado 1). NULL quando não setado. */
const SESSION = `nullif(current_setting('app.current_anamnesis_session_id', true), '')`;

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

  for (const { table, column, anon } of TENANT_TABLES) {
    const p = policyNames(table);
    const self = `("${column}"::text = ${UID})`;
    const system = `(${ROLE} = 'SYSTEM')`;
    const admin = `(${ROLE} = 'ADMIN')`;
    const base = `${self} OR ${system} OR ${admin}`;

    // Fase anônima escopada por sessão (Sato — achado 1):
    //  - leitura: GUC ausente (lookup token→sessão) OU coluna de escopo == GUC;
    //  - escrita: exige o GUC batendo a sessão (nenhuma linha órfã de outra sessão).
    let anonRead = '';
    let anonWrite = '';
    let anonInsert = '';
    if (anon) {
      const orphan = `"${column}" IS NULL AND ${ROLE} = 'ANONYMOUS'`;
      const scoped = `"${anon.scope}"::text = ${SESSION}`;
      anonRead = ` OR (${orphan} AND (${SESSION} IS NULL OR ${scoped}))`;
      anonWrite = ` OR (${orphan} AND ${scoped})`;
      // INSERT: consents nasce preso à sessão (scopeAtInsert); a sessão nova não
      // tem `id` ainda, então seu INSERT é liberado pela condição de órfã.
      anonInsert = anon.scopeAtInsert ? ` OR (${orphan} AND ${scoped})` : ` OR (${orphan})`;
    }

    const visibleRead = `${base}${anonRead}`;
    const visibleWrite = `${base}${anonWrite}`;

    // Criação de titular / linha de fase anônima: permitida sem contexto de tenant
    // (onboarding público e operações de sistema) ou dentro do próprio contexto.
    const insertCheck =
      table === 'users'
        ? `${UID} IS NULL OR ${self} OR ${system} OR ${admin}`
        : `${base}${anonInsert}`;

    statements.push(
      `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`,
      // FORCE vale até para o dono — defesa contra ownership virar escape de RLS.
      `ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`,
      `DROP POLICY IF EXISTS "${p.select}" ON "${table}"`,
      `DROP POLICY IF EXISTS "${p.insert}" ON "${table}"`,
      `DROP POLICY IF EXISTS "${p.update}" ON "${table}"`,
      `DROP POLICY IF EXISTS "${p.delete}" ON "${table}"`,
      `CREATE POLICY "${p.select}" ON "${table}" FOR SELECT USING (${visibleRead})`,
      `CREATE POLICY "${p.insert}" ON "${table}" FOR INSERT WITH CHECK (${insertCheck})`,
      `CREATE POLICY "${p.update}" ON "${table}" FOR UPDATE USING (${visibleWrite}) WITH CHECK (${visibleWrite})`,
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
