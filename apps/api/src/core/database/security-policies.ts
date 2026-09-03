import { CONSENT_TEXTS } from '@movivo/shared';

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
  /**
   * Acesso a QUALQUER profissional CREF ativo, com consentimento de saúde do titular
   * ativo — não mais restrito a `professional_assignments` (decisão do fundador,
   * 2026-08-19): a fila de revisão é do cargo, não da pessoa. Hoje só existe um RT
   * (Leonardo), mas o modelo já precisa suportar vários CREFs revisando/editando a
   * mesma fila quando a MOVIVO contratar mais profissionais. `professional_assignments`
   * continua existindo (ex.: atribuição nominal em `protocols.professionalId`), só
   * deixou de ser o portão de RLS.
   */
  professional?: 'read' | 'write';
  /**
   * Leitura operacional do papel `SUPPORT` (Control Center — aba de suporte), restrita
   * a linhas cujo titular tem `users.role = 'USER'`. Nunca é concedida a tabela com dado
   * de saúde (anamnese, PAR-Q, protocolo, check-in, conversa): apenas cadastro (`users`)
   * e status de assinatura (`subscriptions`). Somente SELECT — nunca INSERT/UPDATE/DELETE.
   */
  support?: true;
}

const TENANT_TABLES: ReadonlyArray<TenantTable> = [
  { table: 'users', column: 'id', professional: 'read', support: true },
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
  // Sprint 2 (US-2.2): a trilha de invocações de LLM carrega snapshot pseudonimizado
  // de dado de saúde — entra sob a mesma FORCE RLS das tabelas de titular.
  { table: 'ai_jobs', column: 'user_id', professional: 'read' },
  // Sprint 2 (US-2.4): o protocolo é dado de saúde derivado (personalizado a partir de
  // condição/limitação física) — sob a mesma FORCE RLS por titular. `protocol_versions`
  // tem `user_id` denormalizado justamente para ancorar a RLS sem JOIN (Sato §4.5).
  { table: 'protocols', column: 'user_id', professional: 'write' },
  { table: 'protocol_versions', column: 'user_id', professional: 'write' },
  // Achado 2026-09-02: proposta de substituição de exercício via IA, em staging até
  // aprovação/janela de cortesia — mesma FORCE RLS por titular de `protocols`.
  { table: 'protocol_substitution_requests', column: 'user_id', professional: 'write' },
  // Sprint 3 (US-3.2): resumo de longo prazo da conversa de saúde — mesma FORCE RLS por titular.
  { table: 'coaching_sessions', column: 'user_id', professional: 'read' },
  // Sprint 3 (US-3.6): alerta/handoff ao painel CREF — dado de titular, isolado por RLS FORCE.
  { table: 'handoff_alerts', column: 'user_id', professional: 'write' },
  // Sprint 4 (US-4.1): assinatura/dado financeiro do titular — sob a mesma FORCE RLS.
  { table: 'subscriptions', column: 'user_id', professional: 'read', support: true },
  { table: 'conversations', column: 'user_id', professional: 'read' },
  { table: 'checkins', column: 'user_id', professional: 'read' },
  { table: 'reengagement_nudges', column: 'user_id', professional: 'read' },
  { table: 'audit_logs', column: 'user_id', professional: 'write' },
  // Sprint 8 (US-8.1): treino concluído do titular. Não há caminho HTTP de aluno para
  // esta tabela (não existe UI de aluno) — a RLS existe para que o painel do
  // profissional e os jobs de sistema sejam a única porta, e ela seja escopada.
  { table: 'workout_completions', column: 'user_id', professional: 'read' },
  // Sprint 8 (US-8.3): sequência de marcos do ciclo de vida do titular. Append-only
  // (ver `buildStatusTransitionsImmutabilitySql`) e sob a mesma FORCE RLS por titular.
  { table: 'user_status_transitions', column: 'user_id', professional: 'read' },
  // Sprint 8 (US-8.5): liquidação recebida do gateway. Dado financeiro do titular, como
  // `subscriptions`. Linha órfã (conciliação sem assinatura) tem `user_id` nulo e por isso
  // não casa com nenhuma política de titular — fica visível só a SYSTEM/ADMIN, que é
  // exatamente quem trata a fila de exceção. Append-only (`buildPaymentsImmutabilitySql`).
  { table: 'payments', column: 'user_id', professional: 'read' },
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
  const statements: string[] = [];

  for (const { table, column, anon, professional, support } of TENANT_TABLES) {
    const p = policyNames(table);
    const self = `("${column}"::text = ${UID})`;
    const system = `(${ROLE} = 'SYSTEM')`;
    const admin = `(${ROLE} = 'ADMIN')`;
    const base = `${self} OR ${system} OR ${admin}`;
    // Decisão do fundador (2026-08-19): a fila de revisão é do CARGO (qualquer CREF
    // ativo), não da PESSOA — antes disso, um profissional só via titulares com
    // `professional_assignments` ativo apontando pra ele, o que escondia protocolo/
    // PAR-Q/etc. de outro CREF sem essa atribuição específica. Sem EXISTS sobre
    // `professional_assignments`: só checa role + consentimento de saúde do titular.
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
      anonRead = ` OR (${orphan} AND (${SESSION} IS NULL OR ${scoped}))`;
      anonWrite = ` OR (${orphan} AND ${scoped})`;
      // INSERT: consents nasce preso à sessão (scopeAtInsert); a sessão nova não
      // tem `id` ainda, então seu INSERT é liberado pela condição de órfã.
      anonInsert = anon.scopeAtInsert ? ` OR (${orphan} AND ${scoped})` : ` OR (${orphan})`;
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

    const visibleRead = `${base}${professional ? ` OR ${linkedProfessional}` : ''}${supportRead}${anonRead}`;
    const visibleWrite = `${base}${professional === 'write' ? ` OR ${linkedProfessional}` : ''}${anonWrite}`;

    // Criação de titular / linha de fase anônima: permitida sem contexto de tenant
    // (onboarding público e operações de sistema) ou dentro do próprio contexto.
    const insertCheck =
      table === 'users'
        ? `${UID} IS NULL OR ${self} OR ${system} OR ${admin}`
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

  // O vinculo em si nao herda a policy por titular: o profissional enxerga apenas
  // suas atribuicoes; somente SYSTEM/ADMIN cria, revoga ou remove uma atribuicao.
  const assignment = policyNames('professional_assignments');
  statements.push(
    'ALTER TABLE "professional_assignments" ENABLE ROW LEVEL SECURITY',
    'ALTER TABLE "professional_assignments" FORCE ROW LEVEL SECURITY',
    `DROP POLICY IF EXISTS "${assignment.select}" ON "professional_assignments"`,
    `DROP POLICY IF EXISTS "${assignment.insert}" ON "professional_assignments"`,
    `DROP POLICY IF EXISTS "${assignment.update}" ON "professional_assignments"`,
    `DROP POLICY IF EXISTS "${assignment.delete}" ON "professional_assignments"`,
    `CREATE POLICY "${assignment.select}" ON "professional_assignments" FOR SELECT USING (professional_id::text = ${UID} OR ${ROLE} = 'SYSTEM' OR ${ROLE} = 'ADMIN')`,
    `CREATE POLICY "${assignment.insert}" ON "professional_assignments" FOR INSERT WITH CHECK (${ROLE} = 'SYSTEM' OR ${ROLE} = 'ADMIN')`,
    `CREATE POLICY "${assignment.update}" ON "professional_assignments" FOR UPDATE USING (${ROLE} = 'SYSTEM' OR ${ROLE} = 'ADMIN') WITH CHECK (${ROLE} = 'SYSTEM' OR ${ROLE} = 'ADMIN')`,
    `CREATE POLICY "${assignment.delete}" ON "professional_assignments" FOR DELETE USING (${ROLE} = 'SYSTEM' OR ${ROLE} = 'ADMIN')`,
    // Mesmo com acesso a audit_logs, o ator nao pode forjar a identidade de auditoria.
    // O terceiro disjunto cobre o evento de acesso EM MASSA (listagens do Control Center):
    // nao existe um titular unico a apontar, entao o ator registra o evento SOBRE SI MESMO
    // (`actor_id = user_id = contexto atual`). Continua impossivel forjar outro ator ou
    // atribuir o evento a outro titular. Primeiro disjunto acompanha a mesma decisão do
    // fundador (2026-08-19) do `linkedProfessional` acima: sem o EXISTS de
    // `professional_assignments` — senão um CREF sem atribuição específica conseguiria
    // editar/assinar o protocolo (RLS de `protocols` já liberado) mas a gravação da
    // própria trilha de auditoria dessa ação falharia.
    `DROP POLICY IF EXISTS "audit_logs_rls_insert" ON "audit_logs"`,
    `CREATE POLICY "audit_logs_rls_insert" ON "audit_logs" FOR INSERT WITH CHECK ((actor_id::text = ${UID} AND ${ROLE} = 'PROFESSIONAL' AND public.has_active_health_consent(audit_logs.user_id)) OR (actor_id::text = ${UID} AND user_id::text = ${UID}) OR ${ROLE} = 'SYSTEM' OR (actor_id::text = ${UID} AND ${ROLE} = 'ADMIN'))`,
  );

  // `;` como separador — executado por `sql.unsafe` (simple query, multi-statement),
  // o mesmo caminho já usado pelos grants em `migrate.ts`.
  return statements.map((s) => `${s};`).join('\n');
}

/** Tabelas cobertas — reutilizado pelo teste de integração de isolamento (US-1.8). */
export const RLS_TENANT_TABLES = [...TENANT_TABLES.map((t) => t.table), 'professional_assignments'];

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

    REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM ${appRole};
    GRANT SELECT, INSERT ON public.audit_logs TO ${appRole};
  `;
}

/**
 * `agent_config` append-only, imposto no banco (US-7.6 / TASK-7.6.2).
 *
 * Mesma defesa em profundidade de `audit_logs`, pelo mesmo motivo elevado ao quadrado: uma
 * configuracao alterada em silencio muda o que a IA diz para TODOS os alunos ao mesmo tempo.
 * Duas barreiras independentes:
 *  1. trigger que levanta excecao em UPDATE/DELETE/TRUNCATE (vale ate para quem tem grant);
 *  2. REVOKE do privilegio na role de runtime (vale ate se a trigger for derrubada).
 * A tabela nao entra na RLS por titular: e configuracao global, nao dado de aluno. O controle
 * de quem publica e por capability na API (`AI_CONFIG_WRITE`).
 */
export function buildAgentConfigImmutabilitySql(appRole: string): string {
  return `
    CREATE OR REPLACE FUNCTION public.agent_config_reject_mutation()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    BEGIN
      RAISE EXCEPTION 'agent_config is append-only' USING ERRCODE = '55000';
    END $$;

    REVOKE ALL ON FUNCTION public.agent_config_reject_mutation() FROM PUBLIC;

    DROP TRIGGER IF EXISTS trg_agent_config_immutable ON public.agent_config;
    CREATE TRIGGER trg_agent_config_immutable BEFORE UPDATE OR DELETE ON public.agent_config
      FOR EACH ROW EXECUTE FUNCTION public.agent_config_reject_mutation();
    DROP TRIGGER IF EXISTS trg_agent_config_no_truncate ON public.agent_config;
    CREATE TRIGGER trg_agent_config_no_truncate BEFORE TRUNCATE ON public.agent_config
      FOR EACH STATEMENT EXECUTE FUNCTION public.agent_config_reject_mutation();

    REVOKE UPDATE, DELETE, TRUNCATE ON public.agent_config FROM ${appRole};
    GRANT SELECT, INSERT ON public.agent_config TO ${appRole};

    -- Sprint 11 — resolução da persona por slot. A leitura de caminho quente é sempre
    -- "maior version PUBLISHED DESTE target_sex", executada a cada expiração de cache em
    -- cada instância da API. A ordem das colunas é a da query: igualdade (target_sex,
    -- status) primeiro, ordenação (version DESC) depois — assim o índice serve o
    -- ORDER BY ... LIMIT 1 sem sort. Fica aqui, e não no schema Drizzle, pelo mesmo motivo
    -- do HNSW do RAG: é índice de reconciliação, idempotente a cada migração.
    CREATE INDEX IF NOT EXISTS idx_agent_config_active
      ON public.agent_config (target_sex, status, version DESC);
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

    REVOKE UPDATE, DELETE, TRUNCATE ON public.faq_entries FROM ${appRole};
    GRANT SELECT, INSERT ON public.faq_entries TO ${appRole};
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

    REVOKE UPDATE, DELETE, TRUNCATE ON public.ai_guardrail_rules FROM ${appRole};
    GRANT SELECT, INSERT ON public.ai_guardrail_rules TO ${appRole};
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

    REVOKE UPDATE, DELETE, TRUNCATE ON public.ai_forbidden_topics FROM ${appRole};
    GRANT SELECT, INSERT ON public.ai_forbidden_topics TO ${appRole};
  `;
}

/**
 * `user_status_transitions` append-only, imposto no banco (US-8.3 / TASK-8.3.1).
 *
 * Molde idêntico ao de `agent_config` (Sprint 7), pelo mesmo motivo: uma transição editada
 * depois do fato reescreve a coorte e a taxa de conversão retroativamente, sem deixar rastro
 * — o painel do fundador e a planilha do CFO passariam a divergir em silêncio. Duas barreiras:
 *  1. trigger que levanta exceção em UPDATE/DELETE/TRUNCATE (vale até para quem tem grant);
 *  2. REVOKE do privilégio na role de runtime (vale até se a trigger for derrubada).
 * Diferente de `agent_config`, esta tabela **também** entra na RLS por titular (é dado de aluno).
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

    REVOKE UPDATE, DELETE, TRUNCATE ON public.user_status_transitions FROM ${appRole};
    GRANT SELECT, INSERT ON public.user_status_transitions TO ${appRole};
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
      IF NOT (
        actor_role = 'SYSTEM'
        OR actor_role = 'ADMIN'
        OR (actor_role = 'USER' AND actor IS NOT DISTINCT FROM target_user)
        OR actor_role = 'PROFESSIONAL'
      ) THEN
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
      IF actor_role <> 'USER' OR actor IS DISTINCT FROM target_user THEN
        RAISE EXCEPTION 'holder context required' USING ERRCODE = '42501';
      END IF;
      UPDATE public.consents SET revoked_at = now(), updated_at = now()
      WHERE user_id = target_user AND consent_type = 'HEALTH_DATA'
        AND accepted = true AND revoked_at IS NULL;
      GET DIAGNOSTICS affected = ROW_COUNT;
      UPDATE public.professional_assignments
      SET active = false, revoked_at = now(), updated_at = now()
      WHERE user_id = target_user AND active = true AND revoked_at IS NULL;
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
      IF actor_role <> 'USER' OR actor IS DISTINCT FROM target_user THEN
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
      IF actor_role <> 'SYSTEM' THEN
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
      IF actor_role <> 'ANONYMOUS' OR scoped_session IS DISTINCT FROM target_session THEN
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

    CREATE OR REPLACE FUNCTION public.assign_unique_active_professional(target_user uuid)
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    DECLARE professional uuid;
    BEGIN
      IF nullif(current_setting('app.current_role', true), '') NOT IN ('SYSTEM', 'ADMIN') THEN
        RAISE EXCEPTION 'assignment requires system context' USING ERRCODE = '42501';
      END IF;
      -- Decisão do fundador (2026-08-25): no início da MOVIVO todo ADMIN é também
      -- sócio-fundador com liberdade de aprovar/editar protocolo — mesma regra que já
      -- valia para signProtocol()/release_parq_on_signature(). Prefere o RT CREF
      -- explícito quando existe (menor id, estável); cai para o ADMIN mais antigo só
      -- quando não há nenhum CREF ativo cadastrado ainda.
      SELECT id INTO professional FROM public.users
      WHERE role = 'PROFESSIONAL' AND cref_active = true
      ORDER BY id LIMIT 1;
      IF professional IS NULL THEN
        SELECT id INTO professional FROM public.users WHERE role = 'ADMIN' ORDER BY id LIMIT 1;
      END IF;
      IF professional IS NULL THEN
        RAISE EXCEPTION 'no active CREF professional or admin available for assignment'
          USING ERRCODE = '55000';
      END IF;
      INSERT INTO public.professional_assignments (professional_id, user_id)
      VALUES (professional, target_user)
      ON CONFLICT (professional_id, user_id) DO UPDATE
      SET active = true, revoked_at = NULL, assigned_at = now(), updated_at = now();
    END $$;

    /*
     * Liberação de PAR-Q pela ASSINATURA do protocolo (2026-08-24). Substitui
     * release_parq_clearance(session, state), que a tela própria de PAR-Q chamava.
     *
     * A assinatura é por PROTOCOLO, não por sessão, e isso é a correção de segurança
     * central: com target_session vindo do cliente, um profissional podia passar o id da
     * sessão de QUALQUER titular (confused deputy) — a função só conferia o cargo dele, não
     * o vínculo entre o que ele está assinando e o que está liberando. Agora a sessão é
     * DERIVADA do protocolo, e a função ainda reconfere que sessão e protocolo pertencem
     * ao mesmo titular.
     *
     * Ordem das checagens é deliberada: autorização ANTES de qualquer RETURN NULL. Um
     * no-op silencioso avaliado cedo (protocolo sem sessão, PAR-Q já liberado) viraria um
     * oráculo de existência para quem não tem sequer papel para chamar a função.
     *
     * ADMIN entra junto de PROFESSIONAL porque DashboardService.signProtocol já o aceita
     * (decisão do fundador 2026-08-22: o único RT CREF da MOVIVO é sócio-fundador e usa
     * conta ADMIN). Sem isso, a assinatura de ADMIN estouraria aqui.
     */
    CREATE OR REPLACE FUNCTION public.release_parq_on_signature(target_protocol uuid)
    RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    DECLARE
      target_user uuid; target_session uuid; session_owner uuid;
      current_state public.parq_state; actor uuid; actor_role text;
    BEGIN
      actor_role := nullif(current_setting('app.current_role', true), '');
      actor := nullif(current_setting('app.current_user_id', true), '')::uuid;

      -- 1) AUTORIZAÇÃO PRIMEIRO — nunca RETURN NULL antes de confirmar quem está chamando.
      IF actor_role = 'ADMIN' THEN
        IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = actor AND u.role = 'ADMIN') THEN
          RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
        END IF;
      ELSIF actor_role = 'PROFESSIONAL' THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.users p
          WHERE p.id = actor AND p.role = 'PROFESSIONAL' AND p.cref_active = true
        ) THEN
          RAISE EXCEPTION 'active CREF professional required' USING ERRCODE = '42501';
        END IF;
      ELSE
        RAISE EXCEPTION 'professional or admin role required' USING ERRCODE = '42501';
      END IF;

      -- 2) protocolo -> titular -> sessão, confirmando que a sessão é DO MESMO titular.
      SELECT p.user_id, p.anamnesis_session_id INTO target_user, target_session
      FROM public.protocols p WHERE p.id = target_protocol;
      IF target_user IS NULL THEN
        RAISE EXCEPTION 'protocol not found' USING ERRCODE = 'P0002';
      END IF;
      IF target_session IS NULL THEN
        -- Linha anterior à migração 0035: sem vínculo de sessão, nada a liberar. Não é erro.
        RETURN NULL;
      END IF;
      SELECT s.user_id, s.parq_state INTO session_owner, current_state
      FROM public.anamnesis_sessions s WHERE s.id = target_session;
      IF session_owner IS DISTINCT FROM target_user THEN
        RAISE EXCEPTION 'session does not belong to protocol owner' USING ERRCODE = '42501';
      END IF;

      IF NOT public.has_active_health_consent(target_user) THEN
        RAISE EXCEPTION 'active health consent required' USING ERRCODE = '42501';
      END IF;

      -- 3) SÓ AQUI, com toda a autorização confirmada, o no-op de ESTADO é seguro.
      IF current_state IS DISTINCT FROM 'BLOQUEADO_AGUARDANDO_CLEARANCE'::public.parq_state THEN
        -- Assinatura de protocolo comum, ou PAR-Q já liberado antes — nada a fazer.
        RETURN NULL;
      END IF;

      UPDATE public.anamnesis_sessions
      SET parq_state = 'LIBERADO_COM_RESSALVA_RT', updated_at = now()
      WHERE id = target_session;
      UPDATE public.users SET requires_professional_review = false, updated_at = now()
      WHERE id = target_user;
      RETURN target_user;
    END $$;

    DROP FUNCTION IF EXISTS public.release_parq_clearance(uuid, public.parq_state);

    CREATE OR REPLACE FUNCTION public.assigned_active_professional(target_user uuid)
    RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    DECLARE actor uuid; actor_role text; assigned_professional uuid;
    BEGIN
      actor_role := nullif(current_setting('app.current_role', true), '');
      actor := nullif(current_setting('app.current_user_id', true), '')::uuid;
      IF actor_role <> 'USER' OR actor IS DISTINCT FROM target_user THEN
        RAISE EXCEPTION 'holder context required' USING ERRCODE = '42501';
      END IF;
      -- ADMIN conta como profissional elegível pelo mesmo motivo de
      -- assign_unique_active_professional() acima — precisa aceitar de volta quem
      -- aquela função pode ter atribuído.
      SELECT pa.professional_id INTO assigned_professional
      FROM public.professional_assignments pa
      INNER JOIN public.users professional ON professional.id = pa.professional_id
      WHERE pa.user_id = target_user
        AND pa.active = true AND pa.revoked_at IS NULL
        AND (
          (professional.role = 'PROFESSIONAL' AND professional.cref_active = true)
          OR professional.role = 'ADMIN'
        );
      IF assigned_professional IS NULL THEN
        RAISE EXCEPTION 'no active assigned CREF professional' USING ERRCODE = '55000';
      END IF;
      IF NOT public.has_active_health_consent(target_user) THEN
        RAISE EXCEPTION 'active health consent required' USING ERRCODE = '42501';
      END IF;
      RETURN assigned_professional;
    END $$;

    REVOKE ALL ON FUNCTION public.has_active_health_consent(uuid) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.revoke_health_data_consent(uuid) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.revoke_non_health_consent(uuid, public.consent_type) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.link_session_consents_to_user(uuid, uuid) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.record_session_consent(uuid, public.consent_type, varchar, boolean, inet, text) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.assign_unique_active_professional(uuid) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.release_parq_on_signature(uuid) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.assigned_active_professional(uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.has_active_health_consent(uuid) TO ${appRole};
    GRANT EXECUTE ON FUNCTION public.revoke_health_data_consent(uuid) TO ${appRole};
    GRANT EXECUTE ON FUNCTION public.revoke_non_health_consent(uuid, public.consent_type) TO ${appRole};
    GRANT EXECUTE ON FUNCTION public.link_session_consents_to_user(uuid, uuid) TO ${appRole};
    GRANT EXECUTE ON FUNCTION public.record_session_consent(uuid, public.consent_type, varchar, boolean, inet, text) TO ${appRole};
    GRANT EXECUTE ON FUNCTION public.assign_unique_active_professional(uuid) TO ${appRole};
    GRANT EXECUTE ON FUNCTION public.release_parq_on_signature(uuid) TO ${appRole};
    GRANT EXECUTE ON FUNCTION public.assigned_active_professional(uuid) TO ${appRole};
    REVOKE INSERT, UPDATE, DELETE ON public.consents FROM ${appRole};
  `;
}

/**
 * `expenses` append-only, imposto no banco (US-8.4 / TASK-8.4.2).
 *
 * Mesma dupla barreira de `audit_logs` e `agent_config`, pelo motivo do livro-caixa:
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

    REVOKE UPDATE, DELETE, TRUNCATE ON public.expenses FROM ${appRole};
    GRANT SELECT, INSERT ON public.expenses TO ${appRole};
  `;
}

/**
 * `payments` append-only, imposto no banco (US-8.5 / TASK-8.5.1).
 *
 * Quarta aplicacao do mesmo molde (`audit_logs`, `agent_config`, `user_status_transitions`,
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

    REVOKE UPDATE, DELETE, TRUNCATE ON public.payments FROM ${appRole};
    GRANT SELECT, INSERT ON public.payments TO ${appRole};
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

    REVOKE UPDATE, DELETE, TRUNCATE ON public.ad_spend FROM ${appRole};
    GRANT SELECT, INSERT ON public.ad_spend TO ${appRole};
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
    'methodology_versions',
    'methodology_events',
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
      IF caller_role NOT IN ('SYSTEM', 'PROFESSIONAL') THEN
        RAISE EXCEPTION 'knowledge publisher role denied' USING ERRCODE = '42501';
      END IF;
      IF caller_role = 'PROFESSIONAL' AND (actor IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.users professional
        WHERE professional.id = actor AND professional.role = 'PROFESSIONAL'
          AND professional.cref_active = true
      )) THEN
        RAISE EXCEPTION 'active CREF professional required' USING ERRCODE = '42501';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.knowledge_document_reviews review
        JOIN public.users reviewer ON reviewer.id = review.reviewer_id
        WHERE review.document_id = target_document
          AND review.decision = 'APPROVED'::public.knowledge_review_decision
          AND (
            (reviewer.role = 'PROFESSIONAL' AND reviewer.cref_active = true)
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
          AND extraction.content_sha256 = document.sha256
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
      IF nullif(current_setting('app.current_role', true), '') NOT IN ('ADMIN', 'PROFESSIONAL', 'ENGINEERING', 'SYSTEM') THEN
        RAISE EXCEPTION 'control center role required' USING ERRCODE = '42501';
      END IF;
      DELETE FROM public.knowledge_document_blobs WHERE retained_until <= now();
      GET DIAGNOSTICS affected = ROW_COUNT;
      RETURN affected;
    END $$;

    REVOKE ALL ON FUNCTION public.publish_knowledge_document(uuid) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.purge_expired_knowledge_blobs() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.publish_knowledge_document(uuid) TO ${appRole};
    GRANT EXECUTE ON FUNCTION public.purge_expired_knowledge_blobs() TO ${appRole};
    REVOKE UPDATE, DELETE, TRUNCATE ON public.knowledge_documents FROM ${appRole};
    REVOKE UPDATE, DELETE, TRUNCATE ON public.knowledge_document_reviews FROM ${appRole};
    GRANT SELECT, INSERT ON public.knowledge_documents TO ${appRole};
    GRANT SELECT, INSERT ON public.knowledge_document_reviews TO ${appRole};
    REVOKE UPDATE, DELETE, TRUNCATE ON public.knowledge_document_blobs FROM ${appRole};
    GRANT SELECT, INSERT ON public.knowledge_document_blobs TO ${appRole};
    REVOKE UPDATE, DELETE, TRUNCATE ON public.knowledge_document_events,
      public.knowledge_document_extractions, public.knowledge_staged_chunks,
      public.knowledge_chunk_embeddings, public.methodology_versions,
      public.methodology_events FROM ${appRole};
    GRANT SELECT, INSERT ON public.knowledge_document_events,
      public.knowledge_document_extractions, public.knowledge_staged_chunks,
      public.knowledge_chunk_embeddings, public.methodology_versions,
      public.methodology_events TO ${appRole};
  `;
}

/**
 * Backfill de `users.biological_sex` (Sprint 11 — persona por slot).
 *
 * A origem do dado continua sendo a anamnese (`data_block_1.biologicalSex`); a coluna em
 * `users` é denormalização de leitura, porque a resolução da persona roda a cada mensagem
 * do WhatsApp. Sem o backfill, todo titular anterior à coluna ficaria `NULL` e cairia no
 * empréstimo entre slots até refazer a anamnese.
 *
 * Roda aqui, e não como migração Drizzle, pelo mesmo motivo dos demais passos de
 * reconciliação: é **idempotente** (`u.biological_sex IS NULL` no WHERE) e precisa poder
 * reexecutar sem efeito em bancos já convergidos.
 *
 * `DISTINCT ON` fixa a escolha quando o titular tem mais de uma sessão submetida: vale a
 * mais recente. Sem isso o resultado dependeria do plano de execução.
 *
 * `->> 'biologicalSex' IS NOT NULL` no lugar do operador `?` de jsonb: `?` é caractere de
 * placeholder em vários drivers/poolers e não há ganho em depender dele aqui — a checagem
 * de valor na lista fechada logo abaixo é mais forte do que "a chave existe".
 */
export const USERS_BIOLOGICAL_SEX_BACKFILL_SQL = `
  UPDATE users u
  SET biological_sex = latest.value::biological_sex
  FROM (
    SELECT DISTINCT ON (s.user_id)
      s.user_id,
      s.data_block_1 ->> 'biologicalSex' AS value
    FROM anamnesis_sessions s
    WHERE s.user_id IS NOT NULL
      AND s.status IN ('SUBMITTED', 'PROCESSED')
      AND s.data_block_1 ->> 'biologicalSex' IN ('MALE', 'FEMALE')
    ORDER BY s.user_id, s.submitted_at DESC NULLS LAST, s.created_at DESC
  ) AS latest
  WHERE latest.user_id = u.id
    AND u.biological_sex IS NULL;
`;
