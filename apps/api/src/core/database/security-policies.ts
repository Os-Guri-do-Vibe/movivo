import { CONSENT_TEXTS, ControlCenterRole } from '@movivo/shared';

import { sqlIdentifier } from './sql-identifier';
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
 * comparar. O token opaco (CSPRNG, 256 bits) é passado por `runAsToken` ao GUC
 * `app.current_anamnesis_token`: lookup e INSERT exigem o token na própria RLS,
 * mesmo quando a consulta não tem WHERE. Depois do lookup, `runAsTokenScoped`
 * usa `app.current_anamnesis_session_id` para leitura e UPDATE da sessão e para
 * SELECT/INSERT dos consentimentos. Sem token ou escopo, nenhuma órfã é visível.
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
  /**
   * Acesso a QUALQUER profissional ativo (de qualquer conselho), com consentimento de
   * saúde do titular ativo: a fila de exceções é do cargo, não da pessoa. O recorte por
   * domínio (treino, nutrição, médico) é feito pela API a partir do conselho do staff.
   */
  professional?: 'read' | 'write';
  /**
   * Leitura operacional do papel `SUPPORT` (Control Center — aba de suporte), restrita
   * a linhas cujo titular tem `users.role = 'USER'`. Nunca é concedida a tabela com dado
   * de saúde (anamnese, PAR-Q, protocolo, check-in, conversa): apenas cadastro (`users`)
   * e status de assinatura (`subscriptions`). Somente SELECT — nunca INSERT/UPDATE/DELETE.
   */
  support?: true;
  /** A coluna denormalizada deve ter o mesmo titular do recurso-pai. */
  parents?: ReadonlyArray<{ table: string; column: string }>;
}

const TENANT_TABLES: ReadonlyArray<TenantTable> = [
  { table: 'users', column: 'id', professional: 'read', support: true },
  // Conta da Plataforma Interna (login, dashboard) — não é dado de titular, então
  // sem `professional`/`support`/`anon`: o predicado genérico já é o certo aqui —
  // cada staff vê a própria linha, ADMIN/SYSTEM veem todas, e só ADMIN/SYSTEM
  // inserem (não há auto-cadastro público de staff).
  { table: 'staff', column: 'id' },
  // `consents` tem fase anônima pelo mesmo motivo da anamnese (US-1.2): o
  // consentimento de saúde é registrado na tela-ponte, ANTES de o `users` existir
  // (que só nasce no submit). A âncora nessa fase é `anamnesis_session_id`, escopada
  // ao GUC da sessão — o INSERT do consentimento já nasce preso à sessão do token.
  {
    table: 'consents',
    column: 'user_id',
    anon: { scope: 'anamnesis_session_id', scopeAtInsert: true },
  },
  {
    table: 'anamnesis_sessions',
    column: 'user_id',
    anon: { scope: 'id', scopeAtInsert: false },
    professional: 'read',
  },
  { table: 'auth_sessions', column: 'user_id' },
  // Sprint 4 (US-4.1): assinatura/dado financeiro do titular — sob a mesma FORCE RLS.
  { table: 'subscriptions', column: 'user_id', professional: 'read', support: true },
  { table: 'conversations', column: 'user_id', professional: 'read' },
  { table: 'audit_logs', column: 'user_id', professional: 'write' },
  { table: 'access_link_tokens', column: 'user_id' },
  { table: 'training_access_tokens', column: 'user_id' },
  // Sprint 8 (US-8.3): sequência de marcos do ciclo de vida do titular. Append-only
  // (ver `buildStatusTransitionsImmutabilitySql`) e sob a mesma FORCE RLS por titular.
  { table: 'user_status_transitions', column: 'user_id', professional: 'read' },
  // Sprint 8 (US-8.5): liquidação recebida do gateway. Dado financeiro do titular, como
  // `subscriptions`. Linha órfã (conciliação sem assinatura) tem `user_id` nulo e por isso
  // não casa com nenhuma política de titular — fica visível só a SYSTEM/ADMIN, que é
  // exatamente quem trata a fila de exceção. Append-only (`buildPaymentsImmutabilitySql`).
  {
    table: 'payments',
    column: 'user_id',
    professional: 'read',
    parents: [{ table: 'subscriptions', column: 'subscription_id' }],
  },
  // --- Estado do Aluno. Plano/objetivo são `write`: a equipe ajusta ao resolver uma exceção.
  { table: 'student_profiles', column: 'user_id', professional: 'read' },
  { table: 'student_health_records', column: 'user_id', professional: 'read' },
  { table: 'student_goals', column: 'user_id', professional: 'write' },
  {
    table: 'goal_milestones',
    column: 'user_id',
    professional: 'read',
    parents: [{ table: 'student_goals', column: 'goal_id' }],
  },
  {
    table: 'goal_tasks',
    column: 'user_id',
    professional: 'read',
    parents: [{ table: 'student_goals', column: 'goal_id' }],
  },
  { table: 'student_constraints', column: 'user_id', professional: 'read' },
  { table: 'student_preferences', column: 'user_id', professional: 'read' },
  { table: 'student_observations', column: 'user_id', professional: 'read' },
  { table: 'student_state_snapshots', column: 'user_id', professional: 'read' },
  // --- Treino integrado.
  { table: 'training_plans', column: 'user_id', professional: 'write' },
  {
    table: 'plan_sessions',
    column: 'user_id',
    professional: 'write',
    parents: [{ table: 'training_plans', column: 'plan_id' }],
  },
  {
    table: 'scheduled_sessions',
    column: 'user_id',
    professional: 'write',
    parents: [
      { table: 'training_plans', column: 'plan_id' },
      { table: 'plan_sessions', column: 'plan_session_id' },
    ],
  },
  { table: 'session_executions', column: 'user_id', professional: 'read' },
  {
    table: 'execution_sets',
    column: 'user_id',
    professional: 'read',
    parents: [{ table: 'session_executions', column: 'execution_id' }],
  },
  {
    table: 'execution_metrics',
    column: 'user_id',
    professional: 'read',
    parents: [{ table: 'session_executions', column: 'execution_id' }],
  },
  // --- Nutrição, corpo e check-ins.
  { table: 'nutrition_plans', column: 'user_id', professional: 'write' },
  { table: 'food_logs', column: 'user_id', professional: 'read' },
  { table: 'body_measurements', column: 'user_id', professional: 'read' },
  { table: 'body_photos', column: 'user_id', professional: 'read' },
  { table: 'body_assessments', column: 'user_id', professional: 'read' },
  { table: 'check_ins', column: 'user_id', professional: 'read' },
  { table: 'weekly_reviews', column: 'user_id', professional: 'read' },
  // --- Trilha de decisões e fila por exceção. A equipe decide (`write`) e resolve sinais/casos.
  { table: 'coaching_proposals', column: 'user_id', professional: 'read' },
  {
    table: 'coaching_decisions',
    column: 'user_id',
    professional: 'write',
    parents: [{ table: 'coaching_proposals', column: 'proposal_id' }],
  },
  {
    table: 'decision_executions',
    column: 'user_id',
    professional: 'read',
    parents: [{ table: 'coaching_decisions', column: 'decision_id' }],
  },
  { table: 'safety_events', column: 'user_id', professional: 'write' },
  { table: 'exception_cases', column: 'user_id', professional: 'write' },
  // Outbox: só o sistema lê e publica (sem acesso profissional).
  { table: 'domain_events', column: 'user_id' },
  // Registro de cada chamada de modelo (custo e auditoria por aluno; sem conteúdo do prompt).
  { table: 'model_runs', column: 'user_id', professional: 'read' },
];

// `nullif(..., '')` é OBRIGATÓRIO, não cosmético: sob PgBouncer transaction mode,
// um GUC customizado setado via `SET LOCAL` numa transação anterior reverte, no
// backend reusado, para **string vazia** (`''`) — não para "não-setado". Sem o
// `nullif`, `<guc> IS NULL` daria falso (`'' IS NULL` = false) e as políticas de
// fase anônima esconderiam a própria linha recém-criada. `nullif('', '')` = NULL
// restaura a semântica "ausente ⇒ NULL ⇒ fail-closed".
const UID = `nullif(current_setting('app.current_user_id', true), '')`;
const ROLE = `nullif(current_setting('app.current_role', true), '')`;
const AUTHENTICATED_ROLE = `${ROLE} IN (${Object.values(ControlCenterRole)
  .map((role) => `'${role}'`)
  .join(', ')})`;
/** GUC de escopo da sessão anônima (Sato — achado 1). NULL quando não setado. */
const SESSION = `nullif(current_setting('app.current_anamnesis_session_id', true), '')`;
const ANAMNESIS_TOKEN = `nullif(current_setting('app.current_anamnesis_token', true), '')`;
const HEALTH_CONSENT_VERSION = CONSENT_TEXTS.HEALTH_DATA.version.replaceAll("'", "''");
const MARKETING_CONSENT_VERSION = CONSENT_TEXTS.MARKETING.version.replaceAll("'", "''");
const TERMS_CONSENT_VERSION = CONSENT_TEXTS.TERMS_OF_SERVICE.version.replaceAll("'", "''");
/** Sprint 6 (Alexandre §5.4): ciência do uso de IA — mesmo mecanismo de prova, não revogável. */
const AI_DISCLOSURE_VERSION = CONSENT_TEXTS.AI_DISCLOSURE.version.replaceAll("'", "''");

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
  // Essas tabelas são geridas exclusivamente por este catálogo. Policies extras
  // permissivas se somariam por OR e poderiam anular o isolamento de titular.
  const statements: string[] = [
    `DO $$ DECLARE policy record; BEGIN
    FOR policy IN SELECT schemaname, tablename, policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename IN (${RLS_TENANT_TABLES.map((table) => `'${table}'`).join(', ')})
    LOOP
      EXECUTE format('DROP POLICY %I ON %I.%I', policy.policyname, policy.schemaname, policy.tablename);
    END LOOP;
  END $$`,
  ];

  for (const { table, column, anon, professional, support, parents } of TENANT_TABLES) {
    const p = policyNames(table);
    const self = `("${column}"::text = ${UID} AND ${AUTHENTICATED_ROLE})`;
    const system = `(${ROLE} = 'SYSTEM')`;
    const admin = `(${ROLE} = 'ADMIN')`;
    const base = `${self} OR ${system} OR ${admin}`;
    // A fila é do CARGO (qualquer profissional ativo), não da PESSOA: só checa role +
    // consentimento de saúde do titular.
    const linkedProfessional = `(${ROLE} = 'PROFESSIONAL' AND public.has_active_health_consent("${table}"."${column}"))`;

    // Fase anônima escopada por sessão (Sato — achado 1):
    //  - leitura: GUC ausente (lookup token→sessão) OU coluna de escopo == GUC;
    //  - escrita: exige o GUC batendo a sessão (nenhuma linha órfã de outra sessão).
    let anonRead = '';
    let anonWrite = '';
    let anonInsert = '';
    if (anon) {
      const orphan = `"${column}" IS NULL AND ${ROLE} = 'ANONYMOUS'`;
      const scoped = `"${anon.scope}"::text = ${SESSION}`;
      anonRead = ` OR (${orphan} AND (${scoped}${table === 'anamnesis_sessions' ? ` OR "token" = ${ANAMNESIS_TOKEN}` : ''}))`;
      anonWrite = ` OR (${orphan} AND ${scoped})`;
      // INSERT: consents nasce preso à sessão (scopeAtInsert); a sessão nova não
      // tem `id` ainda, então seu INSERT é liberado pela condição de órfã.
      anonInsert = anon.scopeAtInsert
        ? ` OR (${orphan} AND ${scoped})`
        : ` OR (${orphan} AND "token" = ${ANAMNESIS_TOKEN})`;
    }

    // Leitura do papel `SUPPORT`, só para linhas de titular final (`users.role = 'USER'`).
    // Em `users` a checagem compara a própria coluna: um EXISTS sobre `users` dentro da
    // policy de `users` reentraria na mesma policy ("infinite recursion detected in policy").
    // Nas demais tabelas o titular é resolvido por EXISTS — que também passa pela policy de
    // `users`, logo continua fail-closed se o SUPPORT perder o acesso ao cadastro.
    const supportRead = support
      ? table === 'users'
        ? ` OR (${ROLE} = 'SUPPORT' AND "users"."role" = 'USER')`
        : ` OR (${ROLE} = 'SUPPORT' AND EXISTS (
            SELECT 1 FROM public.users su
            WHERE su.id = "${table}"."${column}" AND su.role = 'USER'
          ))`
      : '';

    const parentCheck =
      parents
        ?.map(
          (parent) => ` AND ("${table}"."${parent.column}" IS NULL OR EXISTS (
          SELECT 1 FROM "${parent.table}" owner
          WHERE owner.id = "${table}"."${parent.column}"
            AND owner.user_id = "${table}"."${column}"
        ))`,
        )
        .join('') ?? '';
    const visibleRead = `${base}${professional ? ` OR ${linkedProfessional}` : ''}${supportRead}${anonRead}`;
    const visibleWrite = `${base}${professional === 'write' ? ` OR ${linkedProfessional}` : ''}${anonWrite}`;

    // Cadastro de aluno/staff é bootstrap explícito de SYSTEM/ADMIN. Contexto
    // ausente não autoriza INSERT; o onboarding usa runAsSystem após verificação.
    const insertCheck =
      table === 'users' || table === 'staff'
        ? `${system} OR ${admin}`
        : `${base}${professional === 'write' ? ` OR ${linkedProfessional}` : ''}${anonInsert}`;

    statements.push(
      `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`,
      // FORCE vale até para o dono — defesa contra ownership virar escape de RLS.
      `ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`,
      `DROP POLICY IF EXISTS "${p.select}" ON "${table}"`,
      `DROP POLICY IF EXISTS "${p.insert}" ON "${table}"`,
      `DROP POLICY IF EXISTS "${p.update}" ON "${table}"`,
      `DROP POLICY IF EXISTS "${p.delete}" ON "${table}"`,
      `CREATE POLICY "${p.select}" ON "${table}" FOR SELECT USING (${visibleRead})`,
      `CREATE POLICY "${p.insert}" ON "${table}" FOR INSERT WITH CHECK ((${insertCheck})${parentCheck})`,
      `CREATE POLICY "${p.update}" ON "${table}" FOR UPDATE USING (${visibleWrite}) WITH CHECK ((${visibleWrite})${parentCheck})`,
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

  statements.push(
    // Mesmo com acesso a audit_logs, o ator nao pode forjar a identidade de auditoria.
    // O terceiro disjunto cobre o evento de acesso EM MASSA (listagens do Control Center):
    // nao existe um titular unico a apontar, entao o ator registra o evento SOBRE SI MESMO
    // (`actor_id = user_id = contexto atual`). Continua impossivel forjar outro ator ou
    // atribuir o evento a outro titular. O primeiro disjunto acompanha o `linkedProfessional`
    // acima: a fila é do cargo, então qualquer profissional ativo com consentimento grava a
    // trilha da própria ação.
    `DROP POLICY IF EXISTS "audit_logs_rls_insert" ON "audit_logs"`,
    `CREATE POLICY "audit_logs_rls_insert" ON "audit_logs" FOR INSERT WITH CHECK ((actor_id::text = ${UID} AND ${ROLE} = 'PROFESSIONAL' AND public.has_active_health_consent(audit_logs.user_id)) OR (actor_id::text = ${UID} AND user_id::text = ${UID} AND ${AUTHENTICATED_ROLE}) OR ${ROLE} = 'SYSTEM' OR (actor_id::text = ${UID} AND ${ROLE} = 'ADMIN'))`,
  );

  // `;` como separador — executado por `sql.unsafe` (simple query, multi-statement),
  // o mesmo caminho já usado pelos grants em `migrate.ts`.
  return statements.map((s) => `${s};`).join('\n');
}

/** Tabelas cobertas — reutilizado pelo teste de integração de isolamento (US-1.8). */
export const RLS_TENANT_TABLES = TENANT_TABLES.map((t) => t.table);

/** Integridade criptografica e imutabilidade da trilha, impostas no banco. */
export function buildAuditIntegritySql(appRole: string): string {
  return `
    CREATE OR REPLACE FUNCTION public.audit_logs_chain_before_insert()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    DECLARE prior char(64);
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtext('movivo.audit_logs.hash_chain'));
      SELECT row_hash INTO prior FROM public.audit_logs ORDER BY id DESC LIMIT 1;
      NEW.previous_hash := prior;
      NEW.row_hash := encode(public.digest(concat_ws('|', coalesce(prior, ''), NEW.actor_id::text,
        NEW.user_id::text, NEW.action, NEW.entity_type, NEW.entity_id::text,
        NEW.changes::text, NEW.created_at::text), 'sha256'), 'hex');
      RETURN NEW;
    END $$;

    CREATE OR REPLACE FUNCTION public.audit_logs_reject_mutation()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    BEGIN
      RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = '55000';
    END $$;

    REVOKE ALL ON FUNCTION public.audit_logs_chain_before_insert() FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.audit_logs_reject_mutation() FROM PUBLIC;

    DROP TRIGGER IF EXISTS trg_audit_logs_chain ON public.audit_logs;
    CREATE TRIGGER trg_audit_logs_chain BEFORE INSERT ON public.audit_logs
      FOR EACH ROW EXECUTE FUNCTION public.audit_logs_chain_before_insert();
    DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON public.audit_logs;
    CREATE TRIGGER trg_audit_logs_immutable BEFORE UPDATE OR DELETE ON public.audit_logs
      FOR EACH ROW EXECUTE FUNCTION public.audit_logs_reject_mutation();
    DROP TRIGGER IF EXISTS trg_audit_logs_no_truncate ON public.audit_logs;
    CREATE TRIGGER trg_audit_logs_no_truncate BEFORE TRUNCATE ON public.audit_logs
      FOR EACH STATEMENT EXECUTE FUNCTION public.audit_logs_reject_mutation();

    REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM ${sqlIdentifier(appRole)};
    GRANT SELECT, INSERT ON public.audit_logs TO ${sqlIdentifier(appRole)};
  `;
}

/** FAQ é configuração global e append-only; correção/rollback sempre cria nova versão. */
export function buildFaqEntriesImmutabilitySql(appRole: string): string {
  return `
    CREATE OR REPLACE FUNCTION public.faq_entries_reject_mutation()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    BEGIN
      RAISE EXCEPTION 'faq_entries is append-only' USING ERRCODE = '55000';
    END $$;

    REVOKE ALL ON FUNCTION public.faq_entries_reject_mutation() FROM PUBLIC;

    DROP TRIGGER IF EXISTS trg_faq_entries_immutable ON public.faq_entries;
    CREATE TRIGGER trg_faq_entries_immutable BEFORE UPDATE OR DELETE ON public.faq_entries
      FOR EACH ROW EXECUTE FUNCTION public.faq_entries_reject_mutation();
    DROP TRIGGER IF EXISTS trg_faq_entries_no_truncate ON public.faq_entries;
    CREATE TRIGGER trg_faq_entries_no_truncate BEFORE TRUNCATE ON public.faq_entries
      FOR EACH STATEMENT EXECUTE FUNCTION public.faq_entries_reject_mutation();

    REVOKE UPDATE, DELETE, TRUNCATE ON public.faq_entries FROM ${sqlIdentifier(appRole)};
    GRANT SELECT, INSERT ON public.faq_entries TO ${sqlIdentifier(appRole)};
  `;
}

/** Guardrails L1 são globais e append-only; a action no banco admite somente FLAG. */
export function buildAiGuardrailRulesImmutabilitySql(appRole: string): string {
  return `
    CREATE OR REPLACE FUNCTION public.ai_guardrail_rules_reject_mutation()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    BEGIN
      RAISE EXCEPTION 'ai_guardrail_rules is append-only' USING ERRCODE = '55000';
    END $$;

    REVOKE ALL ON FUNCTION public.ai_guardrail_rules_reject_mutation() FROM PUBLIC;

    DROP TRIGGER IF EXISTS trg_ai_guardrail_rules_immutable ON public.ai_guardrail_rules;
    CREATE TRIGGER trg_ai_guardrail_rules_immutable BEFORE UPDATE OR DELETE ON public.ai_guardrail_rules
      FOR EACH ROW EXECUTE FUNCTION public.ai_guardrail_rules_reject_mutation();
    DROP TRIGGER IF EXISTS trg_ai_guardrail_rules_no_truncate ON public.ai_guardrail_rules;
    CREATE TRIGGER trg_ai_guardrail_rules_no_truncate BEFORE TRUNCATE ON public.ai_guardrail_rules
      FOR EACH STATEMENT EXECUTE FUNCTION public.ai_guardrail_rules_reject_mutation();

    REVOKE UPDATE, DELETE, TRUNCATE ON public.ai_guardrail_rules FROM ${sqlIdentifier(appRole)};
    GRANT SELECT, INSERT ON public.ai_guardrail_rules TO ${sqlIdentifier(appRole)};
  `;
}

/**
 * `ai_forbidden_topics` append-only, imposto no banco (Sprint 10).
 *
 * Mesmo molde de `ai_guardrail_rules`, com um motivo a mais para as duas barreiras: aqui o
 * match **bloqueia** a resposta ao aluno, em vez de só sinalizá-la. Uma linha editada depois
 * do fato mudaria retroativamente o que a agente se recusou a responder, sem deixar rastro —
 * e o histórico de aprovação do RT CREF (`approved_by`) deixaria de provar o que aprovou.
 *
 * `REVOKE UPDATE` também é o que impede a role de runtime de contornar o `CHECK` de
 * trilha de aprovação reescrevendo `approved_by` numa linha já gravada.
 */
export function buildAiForbiddenTopicsImmutabilitySql(appRole: string): string {
  return `
    CREATE OR REPLACE FUNCTION public.ai_forbidden_topics_reject_mutation()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    BEGIN
      RAISE EXCEPTION 'ai_forbidden_topics is append-only' USING ERRCODE = '55000';
    END $$;

    REVOKE ALL ON FUNCTION public.ai_forbidden_topics_reject_mutation() FROM PUBLIC;

    DROP TRIGGER IF EXISTS trg_ai_forbidden_topics_immutable ON public.ai_forbidden_topics;
    CREATE TRIGGER trg_ai_forbidden_topics_immutable
      BEFORE UPDATE OR DELETE ON public.ai_forbidden_topics
      FOR EACH ROW EXECUTE FUNCTION public.ai_forbidden_topics_reject_mutation();
    DROP TRIGGER IF EXISTS trg_ai_forbidden_topics_no_truncate ON public.ai_forbidden_topics;
    CREATE TRIGGER trg_ai_forbidden_topics_no_truncate
      BEFORE TRUNCATE ON public.ai_forbidden_topics
      FOR EACH STATEMENT EXECUTE FUNCTION public.ai_forbidden_topics_reject_mutation();

    REVOKE UPDATE, DELETE, TRUNCATE ON public.ai_forbidden_topics FROM ${sqlIdentifier(appRole)};
    GRANT SELECT, INSERT ON public.ai_forbidden_topics TO ${sqlIdentifier(appRole)};
  `;
}

/**
 * `user_status_transitions` append-only, imposto no banco (US-8.3 / TASK-8.3.1).
 *
 * Mesmo molde de `audit_logs`, pelo mesmo motivo: uma transição editada
 * depois do fato reescreve a coorte e a taxa de conversão retroativamente, sem deixar rastro
 * — o painel do fundador e a planilha do CFO passariam a divergir em silêncio. Duas barreiras:
 *  1. trigger que levanta exceção em UPDATE/DELETE/TRUNCATE (vale até para quem tem grant);
 *  2. REVOKE do privilégio na role de runtime (vale até se a trigger for derrubada).
 * Diferente de `audit_logs`, esta tabela **também** entra na RLS por titular (é dado de aluno).
 */
export function buildStatusTransitionsImmutabilitySql(appRole: string): string {
  return `
    CREATE OR REPLACE FUNCTION public.user_status_transitions_reject_mutation()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    BEGIN
      RAISE EXCEPTION 'user_status_transitions is append-only' USING ERRCODE = '55000';
    END $$;

    REVOKE ALL ON FUNCTION public.user_status_transitions_reject_mutation() FROM PUBLIC;

    DROP TRIGGER IF EXISTS trg_user_status_transitions_immutable ON public.user_status_transitions;
    CREATE TRIGGER trg_user_status_transitions_immutable
      BEFORE UPDATE OR DELETE ON public.user_status_transitions
      FOR EACH ROW EXECUTE FUNCTION public.user_status_transitions_reject_mutation();
    DROP TRIGGER IF EXISTS trg_user_status_transitions_no_truncate ON public.user_status_transitions;
    CREATE TRIGGER trg_user_status_transitions_no_truncate
      BEFORE TRUNCATE ON public.user_status_transitions
      FOR EACH STATEMENT EXECUTE FUNCTION public.user_status_transitions_reject_mutation();

    REVOKE UPDATE, DELETE, TRUNCATE ON public.user_status_transitions FROM ${sqlIdentifier(appRole)};
    GRANT SELECT, INSERT ON public.user_status_transitions TO ${sqlIdentifier(appRole)};
  `;
}

/** Mutacoes profissionais estreitas, sem conceder UPDATE amplo em users/anamnese. */
export function buildProfessionalAccessSql(appRole: string): string {
  return `
    CREATE OR REPLACE FUNCTION public.has_active_health_consent(target_user uuid)
    RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    DECLARE actor uuid; actor_role text;
    BEGIN
      actor_role := nullif(current_setting('app.current_role', true), '');
      actor := nullif(current_setting('app.current_user_id', true), '')::uuid;
      -- Decisão do fundador (2026-08-19): qualquer CREF ativo consulta consentimento
      -- de qualquer titular — mesma mudança do linkedProfessional em
      -- buildRlsPoliciesSql acima, senão essa checagem (chamada de dentro da própria
      -- policy) travaria de novo o acesso que acabou de ser liberado ali.
      IF (
        actor_role = 'SYSTEM'
        OR actor_role = 'ADMIN'
        OR (actor_role = 'USER' AND actor IS NOT DISTINCT FROM target_user)
        OR (actor_role = 'PROFESSIONAL' AND EXISTS (
          SELECT 1 FROM public.staff professional
          WHERE professional.id = actor AND professional.role = 'PROFESSIONAL'
            AND professional.council_active = true
        ))
      ) IS NOT TRUE THEN
        RETURN false;
      END IF;
      RETURN EXISTS (
        SELECT 1 FROM public.consents consent
        WHERE consent.user_id = target_user
          AND consent.consent_type = 'HEALTH_DATA'
          AND consent.version = '${HEALTH_CONSENT_VERSION}'
          AND consent.accepted = true AND consent.revoked_at IS NULL
      );
    END $$;

    CREATE OR REPLACE FUNCTION public.revoke_health_data_consent(target_user uuid)
    RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    DECLARE actor uuid; actor_role text; affected integer;
    BEGIN
      actor_role := nullif(current_setting('app.current_role', true), '');
      actor := nullif(current_setting('app.current_user_id', true), '')::uuid;
      IF actor_role IS DISTINCT FROM 'USER' OR actor IS DISTINCT FROM target_user THEN
        RAISE EXCEPTION 'holder context required' USING ERRCODE = '42501';
      END IF;
      UPDATE public.consents SET revoked_at = now(), updated_at = now()
      WHERE user_id = target_user AND consent_type = 'HEALTH_DATA'
        AND accepted = true AND revoked_at IS NULL;
      GET DIAGNOSTICS affected = ROW_COUNT;
      IF affected > 0 THEN
        INSERT INTO public.audit_logs (
          actor_id, user_id, action, entity_type, entity_id, changes
        ) VALUES (
          actor, target_user, 'HEALTH_CONSENT_REVOKED', 'consent', target_user,
          jsonb_build_object(
            'consentType', 'HEALTH_DATA',
            'version', '${HEALTH_CONSENT_VERSION}',
            'revoked', true
          )
        );
      END IF;
      RETURN affected > 0;
    END $$;

    CREATE OR REPLACE FUNCTION public.revoke_non_health_consent(
      target_user uuid, target_type public.consent_type
    ) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    DECLARE actor uuid; actor_role text; affected integer;
    BEGIN
      actor_role := nullif(current_setting('app.current_role', true), '');
      actor := nullif(current_setting('app.current_user_id', true), '')::uuid;
      IF actor_role IS DISTINCT FROM 'USER' OR actor IS DISTINCT FROM target_user THEN
        RAISE EXCEPTION 'holder context required' USING ERRCODE = '42501';
      END IF;
      IF target_type = 'HEALTH_DATA'::public.consent_type THEN
        RAISE EXCEPTION 'health consent requires dedicated revocation' USING ERRCODE = '22023';
      END IF;
      -- Alexandre §5.8, regra nova 1: AI_DISCLOSURE e' ciencia, nao autorizacao. Uma
      -- ciencia nao se desfaz. A recusa vive tambem no banco, e nao so no servico.
      IF target_type = 'AI_DISCLOSURE'::public.consent_type THEN
        RAISE EXCEPTION 'ai disclosure is not revocable' USING ERRCODE = '22023';
      END IF;
      UPDATE public.consents SET revoked_at = now(), updated_at = now()
      WHERE user_id = target_user AND consent_type = target_type
        AND accepted = true AND revoked_at IS NULL;
      GET DIAGNOSTICS affected = ROW_COUNT;
      IF affected > 0 THEN
        INSERT INTO public.audit_logs (
          actor_id, user_id, action, entity_type, entity_id, changes
        ) VALUES (
          actor, target_user, 'CONSENT_REVOKED', 'consent', target_user,
          jsonb_build_object('consentType', target_type::text, 'revoked', true)
        );
      END IF;
      RETURN affected > 0;
    END $$;

    CREATE OR REPLACE FUNCTION public.link_session_consents_to_user(
      target_session uuid, target_user uuid
    ) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    DECLARE actor_role text; affected integer;
    BEGIN
      actor_role := nullif(current_setting('app.current_role', true), '');
      IF actor_role IS DISTINCT FROM 'SYSTEM' THEN
        RAISE EXCEPTION 'system context required' USING ERRCODE = '42501';
      END IF;
      PERFORM pg_advisory_xact_lock(hashtext('movivo.consent-cycle:' || target_user::text));
      UPDATE public.consents AS candidate
      SET user_id = target_user,
          cycle = (
            SELECT coalesce(max(existing.cycle), 0) + 1
            FROM public.consents AS existing
            WHERE existing.user_id = target_user
              AND existing.consent_type = candidate.consent_type
              AND existing.version = candidate.version
          ),
          updated_at = now()
      WHERE candidate.anamnesis_session_id = target_session AND candidate.user_id IS NULL;
      GET DIAGNOSTICS affected = ROW_COUNT;
      RETURN affected;
    END $$;

    CREATE OR REPLACE FUNCTION public.record_session_consent(
      target_session uuid,
      target_type public.consent_type,
      target_version varchar,
      target_accepted boolean,
      source_ip inet,
      source_agent text
    ) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    DECLARE actor_role text; scoped_session uuid; expected_version text;
    BEGIN
      actor_role := nullif(current_setting('app.current_role', true), '');
      scoped_session := nullif(current_setting('app.current_anamnesis_session_id', true), '')::uuid;
      IF actor_role IS DISTINCT FROM 'ANONYMOUS' OR scoped_session IS DISTINCT FROM target_session THEN
        RAISE EXCEPTION 'anonymous session scope required' USING ERRCODE = '42501';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.anamnesis_sessions session
        WHERE session.id = target_session AND session.status = 'IN_PROGRESS'
          AND session.expires_at > now()
      ) THEN
        RAISE EXCEPTION 'active anamnesis session required' USING ERRCODE = '42501';
      END IF;
      expected_version := CASE target_type
        WHEN 'HEALTH_DATA'::public.consent_type THEN '${HEALTH_CONSENT_VERSION}'
        WHEN 'MARKETING'::public.consent_type THEN '${MARKETING_CONSENT_VERSION}'
        WHEN 'TERMS_OF_SERVICE'::public.consent_type THEN '${TERMS_CONSENT_VERSION}'
        WHEN 'AI_DISCLOSURE'::public.consent_type THEN '${AI_DISCLOSURE_VERSION}'
      END;
      IF target_version IS DISTINCT FROM expected_version THEN
        RAISE EXCEPTION 'current consent version required' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.consents (
        user_id, anamnesis_session_id, consent_type, version, accepted,
        ip_address, user_agent, accepted_at
      ) VALUES (
        NULL, target_session, target_type, target_version, target_accepted,
        source_ip, source_agent, now()
      )
      ON CONFLICT (anamnesis_session_id, consent_type, version) DO UPDATE
      SET accepted = EXCLUDED.accepted,
          accepted_at = now(),
          ip_address = EXCLUDED.ip_address,
          user_agent = EXCLUDED.user_agent,
          revoked_at = NULL,
          updated_at = now();
    END $$;

    REVOKE ALL ON FUNCTION public.has_active_health_consent(uuid) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.revoke_health_data_consent(uuid) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.revoke_non_health_consent(uuid, public.consent_type) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.link_session_consents_to_user(uuid, uuid) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.record_session_consent(uuid, public.consent_type, varchar, boolean, inet, text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.has_active_health_consent(uuid) TO ${sqlIdentifier(appRole)};
    GRANT EXECUTE ON FUNCTION public.revoke_health_data_consent(uuid) TO ${sqlIdentifier(appRole)};
    GRANT EXECUTE ON FUNCTION public.revoke_non_health_consent(uuid, public.consent_type) TO ${sqlIdentifier(appRole)};
    GRANT EXECUTE ON FUNCTION public.link_session_consents_to_user(uuid, uuid) TO ${sqlIdentifier(appRole)};
    GRANT EXECUTE ON FUNCTION public.record_session_consent(uuid, public.consent_type, varchar, boolean, inet, text) TO ${sqlIdentifier(appRole)};
    REVOKE INSERT, UPDATE, DELETE ON public.consents FROM ${sqlIdentifier(appRole)};
  `;
}

/**
 * `expenses` append-only, imposto no banco (US-8.4 / TASK-8.4.2).
 *
 * Mesma dupla barreira de `audit_logs`, pelo motivo do livro-caixa:
 * **correcao e estorno, nunca edicao**. Um valor de despesa alterado em silencio muda o
 * lucro apurado de um periodo ja fechado sem deixar rastro conferivel contra o extrato.
 *  1. trigger que levanta excecao em UPDATE/DELETE/TRUNCATE (vale ate para quem tem grant);
 *  2. REVOKE do privilegio na role de runtime (vale ate se a trigger for derrubada).
 *
 * Fora da RLS por titular: e dado da empresa, nao de aluno. Quem escreve e definido por
 * capability na API (`FINANCE_WRITE`), e toda escrita passa por `AuditService.append`.
 *
 * `model_pricing` NAO entra aqui de proposito: fechar vigencia e literalmente
 * `UPDATE valid_to`. La a garantia de historico imutavel vem da vigencia por data, nao
 * da imutabilidade da linha.
 */
export function buildExpensesImmutabilitySql(appRole: string): string {
  return `
    CREATE OR REPLACE FUNCTION public.expenses_reject_mutation()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    BEGIN
      RAISE EXCEPTION 'expenses is append-only: corrija por estorno, nunca por edicao' USING ERRCODE = '55000';
    END $$;

    REVOKE ALL ON FUNCTION public.expenses_reject_mutation() FROM PUBLIC;

    DROP TRIGGER IF EXISTS trg_expenses_immutable ON public.expenses;
    CREATE TRIGGER trg_expenses_immutable BEFORE UPDATE OR DELETE ON public.expenses
      FOR EACH ROW EXECUTE FUNCTION public.expenses_reject_mutation();
    DROP TRIGGER IF EXISTS trg_expenses_no_truncate ON public.expenses;
    CREATE TRIGGER trg_expenses_no_truncate BEFORE TRUNCATE ON public.expenses
      FOR EACH STATEMENT EXECUTE FUNCTION public.expenses_reject_mutation();

    REVOKE UPDATE, DELETE, TRUNCATE ON public.expenses FROM ${sqlIdentifier(appRole)};
    GRANT SELECT, INSERT ON public.expenses TO ${sqlIdentifier(appRole)};
  `;
}

/**
 * `payments` append-only, imposto no banco (US-8.5 / TASK-8.5.1).
 *
 * Quarta aplicacao do mesmo molde (`audit_logs`, `user_status_transitions`,
 * `expenses`) e a mais sensivel: `payments` e escrita a partir de um evento **externo**.
 * Um valor de liquidacao alterado depois muda a receita apurada de um periodo fechado e,
 * pela US-8.7, muda a base de distribuicao de lucro entre os socios.
 *  1. trigger que levanta excecao em UPDATE/DELETE/TRUNCATE (vale ate para quem tem grant);
 *  2. REVOKE do privilegio na role de runtime (vale ate se a trigger for derrubada).
 *
 * Estorno e chargeback sao **linha nova de sinal contrario**, nunca alteracao da original —
 * por isso a imutabilidade nao atrapalha a correcao: ela e o que a torna auditavel.
 *
 * A regra vale tambem para a conciliacao: o vinculo com a assinatura e resolvido ANTES do
 * insert (no worker), nunca por um UPDATE posterior. Ver `payments.ts`.
 */
export function buildPaymentsImmutabilitySql(appRole: string): string {
  return `
    CREATE OR REPLACE FUNCTION public.payments_reject_mutation()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    BEGIN
      RAISE EXCEPTION 'payments is append-only: estorno e linha nova, nunca alteracao' USING ERRCODE = '55000';
    END $$;

    REVOKE ALL ON FUNCTION public.payments_reject_mutation() FROM PUBLIC;

    DROP TRIGGER IF EXISTS trg_payments_immutable ON public.payments;
    CREATE TRIGGER trg_payments_immutable BEFORE UPDATE OR DELETE ON public.payments
      FOR EACH ROW EXECUTE FUNCTION public.payments_reject_mutation();
    DROP TRIGGER IF EXISTS trg_payments_no_truncate ON public.payments;
    CREATE TRIGGER trg_payments_no_truncate BEFORE TRUNCATE ON public.payments
      FOR EACH STATEMENT EXECUTE FUNCTION public.payments_reject_mutation();

    REVOKE UPDATE, DELETE, TRUNCATE ON public.payments FROM ${sqlIdentifier(appRole)};
    GRANT SELECT, INSERT ON public.payments TO ${sqlIdentifier(appRole)};
  `;
}

/**
 * `ad_spend` append-only, imposto no banco (US-8.6 / TASK-8.6.1).
 *
 * Quinta aplicacao do mesmo molde, pelo motivo de `expenses`: investimento em midia e o
 * NUMERADOR do CAC. Alterar um valor em silencio muda o CAC e o ROAS de um periodo ja
 * lido, e a decisao de escalar ou cortar um anuncio foi tomada sobre o numero antigo.
 * Correcao e estorno (linha negativa com `reverses_ad_spend_id`) + relancamento.
 *
 * Fora da RLS por titular: dado de negocio, nao de titular — igual a `expenses` e
 * `model_pricing`. Quem escreve e definido por capability na API (`MARKETING_WRITE`), e
 * toda escrita passa por `AuditService.append` na mesma transacao.
 */
export function buildAdSpendImmutabilitySql(appRole: string): string {
  return `
    CREATE OR REPLACE FUNCTION public.ad_spend_reject_mutation()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    BEGIN
      RAISE EXCEPTION 'ad_spend is append-only: corrija por estorno, nunca por edicao' USING ERRCODE = '55000';
    END $$;

    REVOKE ALL ON FUNCTION public.ad_spend_reject_mutation() FROM PUBLIC;

    DROP TRIGGER IF EXISTS trg_ad_spend_immutable ON public.ad_spend;
    CREATE TRIGGER trg_ad_spend_immutable BEFORE UPDATE OR DELETE ON public.ad_spend
      FOR EACH ROW EXECUTE FUNCTION public.ad_spend_reject_mutation();
    DROP TRIGGER IF EXISTS trg_ad_spend_no_truncate ON public.ad_spend;
    CREATE TRIGGER trg_ad_spend_no_truncate BEFORE TRUNCATE ON public.ad_spend
      FOR EACH STATEMENT EXECUTE FUNCTION public.ad_spend_reject_mutation();

    REVOKE UPDATE, DELETE, TRUNCATE ON public.ad_spend FROM ${sqlIdentifier(appRole)};
    GRANT SELECT, INSERT ON public.ad_spend TO ${sqlIdentifier(appRole)};
  `;
}

/** Metadados/revisoes RAG sao historico; publicacao exige revisao profissional ou ADMIN. */
export function buildKnowledgeDocumentsSecuritySql(appRole: string): string {
  const histories = [
    'knowledge_documents',
    'knowledge_document_reviews',
    'knowledge_document_events',
    'knowledge_document_extractions',
    'knowledge_staged_chunks',
    'knowledge_chunk_embeddings',
  ];
  const immutableTriggers = histories
    .map(
      (table) => `
        DROP TRIGGER IF EXISTS trg_${table}_immutable ON public.${table};
        CREATE TRIGGER trg_${table}_immutable BEFORE UPDATE OR DELETE ON public.${table}
          FOR EACH ROW EXECUTE FUNCTION public.knowledge_history_reject_mutation();
        DROP TRIGGER IF EXISTS trg_${table}_no_truncate ON public.${table};
        CREATE TRIGGER trg_${table}_no_truncate BEFORE TRUNCATE ON public.${table}
          FOR EACH STATEMENT EXECUTE FUNCTION public.knowledge_history_reject_mutation();`,
    )
    .join('\n');
  return `
    CREATE OR REPLACE FUNCTION public.knowledge_history_reject_mutation()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    BEGIN
      RAISE EXCEPTION 'knowledge history is append-only' USING ERRCODE = '55000';
    END $$;
    REVOKE ALL ON FUNCTION public.knowledge_history_reject_mutation() FROM PUBLIC;

    ${immutableTriggers}

    DROP FUNCTION IF EXISTS public.publish_knowledge_document(uuid, jsonb);
    CREATE OR REPLACE FUNCTION public.publish_knowledge_document(target_document uuid)
    RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    DECLARE actor uuid; caller_role text; affected integer; staged_count integer;
    BEGIN
      actor := nullif(current_setting('app.current_user_id', true), '')::uuid;
      caller_role := nullif(current_setting('app.current_role', true), '');
      IF coalesce(caller_role, '') NOT IN ('SYSTEM', 'PROFESSIONAL') THEN
        RAISE EXCEPTION 'knowledge publisher role denied' USING ERRCODE = '42501';
      END IF;
      IF caller_role = 'PROFESSIONAL' AND (actor IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.staff professional
        WHERE professional.id = actor AND professional.role = 'PROFESSIONAL'
          AND professional.council_active = true
      )) THEN
        RAISE EXCEPTION 'active CREF professional required' USING ERRCODE = '42501';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.knowledge_document_reviews review
        JOIN public.staff reviewer ON reviewer.id = review.reviewer_id
        WHERE review.document_id = target_document
          AND review.decision = 'APPROVED'::public.knowledge_review_decision
          AND (
            (reviewer.role = 'PROFESSIONAL' AND reviewer.council_active = true)
            OR reviewer.role = 'ADMIN'
          )
          AND review.id = (
            SELECT latest.id FROM public.knowledge_document_reviews latest
            WHERE latest.document_id = target_document
            ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1
          )
      ) THEN
        RAISE EXCEPTION 'approved professional or admin review required' USING ERRCODE = '42501';
      END IF;
      IF (
        SELECT event.status FROM public.knowledge_document_events event
        WHERE event.document_id = target_document
        ORDER BY event.sequence DESC, event.created_at DESC, event.id DESC LIMIT 1
      ) <> 'INDEXING'::public.knowledge_document_status THEN
        RAISE EXCEPTION 'document is not in indexing state' USING ERRCODE = '55000';
      END IF;
      SELECT count(*)::integer INTO staged_count
      FROM public.knowledge_staged_chunks staged WHERE staged.document_id = target_document;
      IF staged_count = 0 OR NOT EXISTS (
        SELECT 1 FROM public.knowledge_document_extractions extraction
        JOIN public.knowledge_documents document ON document.id = extraction.document_id
        WHERE extraction.document_id = target_document
          -- O hash do ORIGINAL (document.sha256) não é o do texto extraído: PDF/Word/planilha
          -- passam por um parser. A extração é atestada pelo hash do próprio conteúdo.
          AND encode(digest(convert_to(extraction.content, 'UTF8'), 'sha256'), 'hex') = extraction.content_sha256
      ) OR EXISTS (
        SELECT 1 FROM public.knowledge_staged_chunks staged
        LEFT JOIN public.knowledge_chunk_embeddings staged_embedding
          ON staged_embedding.staged_chunk_id = staged.id
          AND staged_embedding.chunk_sha256 = staged.chunk_sha256
        WHERE staged.document_id = target_document
          AND (
            staged_embedding.staged_chunk_id IS NULL
            OR staged.extraction_sha256 <> (
              SELECT extraction.content_sha256 FROM public.knowledge_document_extractions extraction
              WHERE extraction.document_id = target_document
            )
            OR encode(digest(convert_to(staged.chunk_text, 'UTF8'), 'sha256'), 'hex') <> staged.chunk_sha256
          )
      ) THEN
        RAISE EXCEPTION 'staging provenance verification failed' USING ERRCODE = '55000';
      END IF;
      INSERT INTO public.knowledge_base (
        document_id, chunk_index, chunk_text, embedding, topic, title, source_url,
        reliability, published_at, created_at, updated_at
      )
      SELECT target_document, staged.chunk_index, staged.chunk_text,
        staged_embedding.embedding, document.topic, document.title,
        document.source_url, 5, now(), now(), now()
      FROM public.knowledge_staged_chunks staged
      JOIN public.knowledge_chunk_embeddings staged_embedding
        ON staged_embedding.staged_chunk_id = staged.id
        AND staged_embedding.chunk_sha256 = staged.chunk_sha256
      JOIN public.knowledge_documents document ON document.id = staged.document_id
      WHERE staged.document_id = target_document
      ON CONFLICT (document_id, chunk_index) DO NOTHING;
      SELECT count(*)::integer INTO affected
      FROM public.knowledge_base WHERE document_id = target_document;
      IF affected <> staged_count THEN
        RAISE EXCEPTION 'published chunk count mismatch' USING ERRCODE = '55000';
      END IF;
      UPDATE public.knowledge_document_blobs
        SET retained_until = now() + interval '365 days'
        WHERE document_id = target_document;
      RETURN affected;
    END $$;

    CREATE OR REPLACE FUNCTION public.purge_expired_knowledge_blobs()
    RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    DECLARE affected integer;
    BEGIN
      IF coalesce(nullif(current_setting('app.current_role', true), ''), '') NOT IN ('ADMIN', 'PROFESSIONAL', 'ENGINEERING', 'SYSTEM') THEN
        RAISE EXCEPTION 'control center role required' USING ERRCODE = '42501';
      END IF;
      DELETE FROM public.knowledge_document_blobs WHERE retained_until <= now();
      GET DIAGNOSTICS affected = ROW_COUNT;
      RETURN affected;
    END $$;

    /*
     * Exclusão DEFINITIVA de um artigo (UI "Excluir"). O histórico é imutável para a aplicação
     * (triggers + sem DELETE), então a purga só existe aqui, numa função estreita:
     *  - só ADMIN (ou SYSTEM) a chama; remove um documento por vez, com todos os dependentes;
     *  - os triggers de imutabilidade são desligados POR TABELA e religados na mesma
     *    transação (o DDL é transacional: ninguém mais enxerga o estado desligado, e um erro
     *    desfaz tudo, deixando os triggers ativos). Não há flag/GUC que a aplicação possa
     *    forjar para burlar a imutabilidade fora desta função;
     *  - lock_timeout curto: prefere falhar a travar escritas do pipeline de ingestão.
     * Devolve quantos trechos saíram do corpus do RAG.
     */
    CREATE OR REPLACE FUNCTION public.delete_knowledge_document(target_document uuid)
    RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, public, pg_temp SET lock_timeout = '10s' AS $$
    DECLARE caller_role text; removed integer;
    BEGIN
      caller_role := nullif(current_setting('app.current_role', true), '');
      IF coalesce(caller_role, '') NOT IN ('ADMIN', 'SYSTEM') THEN
        RAISE EXCEPTION 'knowledge deleter role denied' USING ERRCODE = '42501';
      END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended('knowledge:' || target_document::text, 0));
      IF NOT EXISTS (SELECT 1 FROM public.knowledge_documents WHERE id = target_document) THEN
        RAISE EXCEPTION 'knowledge document not found' USING ERRCODE = 'P0002';
      END IF;

      ALTER TABLE public.knowledge_chunk_embeddings DISABLE TRIGGER trg_knowledge_chunk_embeddings_immutable;
      ALTER TABLE public.knowledge_staged_chunks DISABLE TRIGGER trg_knowledge_staged_chunks_immutable;
      ALTER TABLE public.knowledge_document_extractions DISABLE TRIGGER trg_knowledge_document_extractions_immutable;
      ALTER TABLE public.knowledge_document_reviews DISABLE TRIGGER trg_knowledge_document_reviews_immutable;
      ALTER TABLE public.knowledge_document_events DISABLE TRIGGER trg_knowledge_document_events_immutable;
      ALTER TABLE public.knowledge_documents DISABLE TRIGGER trg_knowledge_documents_immutable;

      DELETE FROM public.knowledge_chunk_embeddings
        WHERE staged_chunk_id IN (
          SELECT id FROM public.knowledge_staged_chunks WHERE document_id = target_document
        );
      DELETE FROM public.knowledge_base WHERE document_id = target_document;
      GET DIAGNOSTICS removed = ROW_COUNT;
      DELETE FROM public.knowledge_staged_chunks WHERE document_id = target_document;
      DELETE FROM public.knowledge_document_extractions WHERE document_id = target_document;
      DELETE FROM public.knowledge_document_reviews WHERE document_id = target_document;
      DELETE FROM public.knowledge_document_events WHERE document_id = target_document;
      DELETE FROM public.knowledge_document_blobs WHERE document_id = target_document;
      DELETE FROM public.knowledge_documents WHERE id = target_document;

      ALTER TABLE public.knowledge_documents ENABLE TRIGGER trg_knowledge_documents_immutable;
      ALTER TABLE public.knowledge_document_events ENABLE TRIGGER trg_knowledge_document_events_immutable;
      ALTER TABLE public.knowledge_document_reviews ENABLE TRIGGER trg_knowledge_document_reviews_immutable;
      ALTER TABLE public.knowledge_document_extractions ENABLE TRIGGER trg_knowledge_document_extractions_immutable;
      ALTER TABLE public.knowledge_staged_chunks ENABLE TRIGGER trg_knowledge_staged_chunks_immutable;
      ALTER TABLE public.knowledge_chunk_embeddings ENABLE TRIGGER trg_knowledge_chunk_embeddings_immutable;
      RETURN removed;
    END $$;

    REVOKE ALL ON FUNCTION public.publish_knowledge_document(uuid) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.purge_expired_knowledge_blobs() FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.delete_knowledge_document(uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.publish_knowledge_document(uuid) TO ${sqlIdentifier(appRole)};
    GRANT EXECUTE ON FUNCTION public.purge_expired_knowledge_blobs() TO ${sqlIdentifier(appRole)};
    GRANT EXECUTE ON FUNCTION public.delete_knowledge_document(uuid) TO ${sqlIdentifier(appRole)};
    REVOKE UPDATE, DELETE, TRUNCATE ON public.knowledge_documents FROM ${sqlIdentifier(appRole)};
    REVOKE UPDATE, DELETE, TRUNCATE ON public.knowledge_document_reviews FROM ${sqlIdentifier(appRole)};
    GRANT SELECT, INSERT ON public.knowledge_documents TO ${sqlIdentifier(appRole)};
    GRANT SELECT, INSERT ON public.knowledge_document_reviews TO ${sqlIdentifier(appRole)};
    REVOKE UPDATE, DELETE, TRUNCATE ON public.knowledge_document_blobs FROM ${sqlIdentifier(appRole)};
    GRANT SELECT, INSERT ON public.knowledge_document_blobs TO ${sqlIdentifier(appRole)};
    REVOKE UPDATE, DELETE, TRUNCATE ON public.knowledge_document_events,
      public.knowledge_document_extractions, public.knowledge_staged_chunks,
      public.knowledge_chunk_embeddings FROM ${sqlIdentifier(appRole)};
    GRANT SELECT, INSERT ON public.knowledge_document_events,
      public.knowledge_document_extractions, public.knowledge_staged_chunks,
      public.knowledge_chunk_embeddings TO ${sqlIdentifier(appRole)};
  `;
}
