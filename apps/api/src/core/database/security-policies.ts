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
  /** Acesso somente quando existe vinculo profissional ativo com o titular. */
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
    const linkedProfessional = `(${ROLE} = 'PROFESSIONAL' AND EXISTS (
      SELECT 1 FROM public.professional_assignments pa
      WHERE pa.professional_id::text = ${UID}
        AND pa.user_id = "${table}"."${column}"
        AND pa.active = true AND pa.revoked_at IS NULL
    ) AND public.has_active_health_consent("${table}"."${column}"))`;

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
    // atribuir o evento a outro titular.
    `DROP POLICY IF EXISTS "audit_logs_rls_insert" ON "audit_logs"`,
    `CREATE POLICY "audit_logs_rls_insert" ON "audit_logs" FOR INSERT WITH CHECK ((actor_id::text = ${UID} AND ${ROLE} = 'PROFESSIONAL' AND EXISTS (SELECT 1 FROM public.professional_assignments pa WHERE pa.professional_id::text = ${UID} AND pa.user_id = audit_logs.user_id AND pa.active = true AND pa.revoked_at IS NULL) AND public.has_active_health_consent(audit_logs.user_id)) OR (actor_id::text = ${UID} AND user_id::text = ${UID}) OR ${ROLE} = 'SYSTEM' OR ${ROLE} = 'ADMIN')`,
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

/** Mutacoes profissionais estreitas, sem conceder UPDATE amplo em users/anamnese. */
export function buildProfessionalAccessSql(appRole: string): string {
  return `
    CREATE OR REPLACE FUNCTION public.has_active_health_consent(target_user uuid)
    RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    DECLARE actor uuid; actor_role text;
    BEGIN
      actor_role := nullif(current_setting('app.current_role', true), '');
      actor := nullif(current_setting('app.current_user_id', true), '')::uuid;
      IF NOT (
        actor_role = 'SYSTEM'
        OR (actor_role = 'USER' AND actor IS NOT DISTINCT FROM target_user)
        OR (actor_role = 'PROFESSIONAL' AND EXISTS (
          SELECT 1 FROM public.professional_assignments pa
          WHERE pa.professional_id = actor AND pa.user_id = target_user
            AND pa.active = true AND pa.revoked_at IS NULL
        ))
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
    DECLARE professional uuid; professionals_count integer;
    BEGIN
      IF nullif(current_setting('app.current_role', true), '') NOT IN ('SYSTEM', 'ADMIN') THEN
        RAISE EXCEPTION 'assignment requires system context' USING ERRCODE = '42501';
      END IF;
      SELECT (array_agg(id ORDER BY id))[1], count(*)::int INTO professional, professionals_count
      FROM public.users WHERE role = 'PROFESSIONAL' AND cref_active = true;
      IF professionals_count <> 1 THEN
        RAISE EXCEPTION 'expected exactly one active CREF professional, found %', professionals_count
          USING ERRCODE = '55000';
      END IF;
      INSERT INTO public.professional_assignments (professional_id, user_id)
      VALUES (professional, target_user)
      ON CONFLICT (professional_id, user_id) DO UPDATE
      SET active = true, revoked_at = NULL, assigned_at = now(), updated_at = now();
    END $$;

    CREATE OR REPLACE FUNCTION public.release_parq_clearance(target_session uuid, new_state public.parq_state)
    RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    DECLARE target_user uuid; actor uuid; actor_role text;
    BEGIN
      actor_role := nullif(current_setting('app.current_role', true), '');
      actor := nullif(current_setting('app.current_user_id', true), '')::uuid;
      IF actor_role <> 'PROFESSIONAL' OR actor IS NULL THEN
        RAISE EXCEPTION 'active CREF professional role required' USING ERRCODE = '42501';
      END IF;
      IF new_state <> 'LIBERADO'::public.parq_state THEN
        RAISE EXCEPTION 'invalid PAR-Q release state' USING ERRCODE = '22023';
      END IF;
      SELECT user_id INTO target_user FROM public.anamnesis_sessions
      WHERE id = target_session AND parq_state = 'BLOQUEADO_AGUARDANDO_CLEARANCE';
      IF target_user IS NULL THEN
        RAISE EXCEPTION 'PAR-Q session not awaiting clearance' USING ERRCODE = 'P0002';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.professional_assignments pa
        INNER JOIN public.users professional ON professional.id = pa.professional_id
        WHERE pa.professional_id = actor AND pa.user_id = target_user
          AND pa.active = true AND pa.revoked_at IS NULL
          AND professional.role = 'PROFESSIONAL'
          AND professional.cref_active = true
      ) THEN
        RAISE EXCEPTION 'active CREF professional is not assigned to holder' USING ERRCODE = '42501';
      END IF;
      IF NOT public.has_active_health_consent(target_user) THEN
        RAISE EXCEPTION 'active health consent required' USING ERRCODE = '42501';
      END IF;
      UPDATE public.anamnesis_sessions SET parq_state = new_state, updated_at = now()
      WHERE id = target_session;
      UPDATE public.users SET requires_professional_review = false, updated_at = now()
      WHERE id = target_user;
      RETURN target_user;
    END $$;

    CREATE OR REPLACE FUNCTION public.assigned_active_professional(target_user uuid)
    RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    DECLARE actor uuid; actor_role text; assigned_professional uuid;
    BEGIN
      actor_role := nullif(current_setting('app.current_role', true), '');
      actor := nullif(current_setting('app.current_user_id', true), '')::uuid;
      IF actor_role <> 'USER' OR actor IS DISTINCT FROM target_user THEN
        RAISE EXCEPTION 'holder context required' USING ERRCODE = '42501';
      END IF;
      SELECT pa.professional_id INTO assigned_professional
      FROM public.professional_assignments pa
      INNER JOIN public.users professional ON professional.id = pa.professional_id
      WHERE pa.user_id = target_user
        AND pa.active = true AND pa.revoked_at IS NULL
        AND professional.role = 'PROFESSIONAL'
        AND professional.cref_active = true;
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
    REVOKE ALL ON FUNCTION public.release_parq_clearance(uuid, public.parq_state) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.assigned_active_professional(uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.has_active_health_consent(uuid) TO ${appRole};
    GRANT EXECUTE ON FUNCTION public.revoke_health_data_consent(uuid) TO ${appRole};
    GRANT EXECUTE ON FUNCTION public.revoke_non_health_consent(uuid, public.consent_type) TO ${appRole};
    GRANT EXECUTE ON FUNCTION public.link_session_consents_to_user(uuid, uuid) TO ${appRole};
    GRANT EXECUTE ON FUNCTION public.record_session_consent(uuid, public.consent_type, varchar, boolean, inet, text) TO ${appRole};
    GRANT EXECUTE ON FUNCTION public.assign_unique_active_professional(uuid) TO ${appRole};
    GRANT EXECUTE ON FUNCTION public.release_parq_clearance(uuid, public.parq_state) TO ${appRole};
    GRANT EXECUTE ON FUNCTION public.assigned_active_professional(uuid) TO ${appRole};
    REVOKE INSERT, UPDATE, DELETE ON public.consents FROM ${appRole};
  `;
}
