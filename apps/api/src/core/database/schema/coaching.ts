/**
 * Trilha de decisões: proposta (agente) → decisão (motor de políticas ou equipe) → execução
 * (comando determinístico de domínio). Toda ação que mexe no aluno deixa as três linhas, com a
 * versão da política aplicada — é isso que permite responder "por que a MOVIVO fez isso?" e
 * atender a revisão humana de decisão automatizada (LGPD art. 20).
 *
 * `safety_events` e `exception_cases` são o lado humano: sinais que suspendem autonomia e a
 * fila que a equipe trabalha por exceção.
 */
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, smallint, text, uuid, varchar } from 'drizzle-orm/pg-core';

import {
  coachingActionTypeSchema,
  decisionVerdictSchema,
  exceptionKindSchema,
  exceptionPrioritySchema,
  exceptionStatusSchema,
  proposalStatusSchema,
  safetyScopeSchema,
  safetySeveritySchema,
  safetySignalKindSchema,
  uncertaintySchema,
  type CoachingAction,
} from '@movivo/shared';

import {
  checkOneOf,
  eventTimestamp,
  primaryKeyColumn,
  timestampColumns,
  userIdColumn,
} from './_shared';
import { staff } from './staff';
import { users } from './users';

const ownerColumn = () =>
  userIdColumn()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });

export const coachingProposals = pgTable(
  'coaching_proposals',
  {
    id: primaryKeyColumn(),
    userId: ownerColumn(),
    /** Evento de domínio que disparou a análise (`domain_events.id`). */
    triggerEventId: uuid('trigger_event_id'),
    /** Tarefa de agente que produziu a proposta (ex.: `running.adjust_block`). */
    taskId: varchar('task_id', { length: 60 }).notNull(),
    actionType: varchar('action_type', { length: 32 }).notNull(),
    action: jsonb('action').$type<CoachingAction>().notNull(),
    rationale: jsonb('rationale').$type<string[]>().notNull(),
    evidence: jsonb('evidence').$type<string[]>().notNull(),
    assumptions: jsonb('assumptions').$type<string[]>().notNull(),
    uncertainty: varchar('uncertainty', { length: 8 }).notNull(),
    expectedOutcome: text('expected_outcome').notNull(),
    /** Versão do Estado do Aluno lida pelo agente (controle otimista na execução). */
    stateVersion: smallint('state_version').notNull(),
    modelRunId: uuid('model_run_id'),
    status: varchar('status', { length: 16 }).notNull().default('PENDING'),
    expiresAt: eventTimestamp('expires_at').notNull(),
    ...timestampColumns,
  },
  (t) => [
    index('idx_coaching_proposals_user').on(t.userId, t.createdAt),
    checkOneOf('ck_coaching_proposals_action', t.actionType, coachingActionTypeSchema.options),
    checkOneOf('ck_coaching_proposals_uncertainty', t.uncertainty, uncertaintySchema.options),
    checkOneOf('ck_coaching_proposals_status', t.status, proposalStatusSchema.options),
  ],
);

export const coachingDecisions = pgTable(
  'coaching_decisions',
  {
    id: primaryKeyColumn(),
    userId: ownerColumn(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => coachingProposals.id, { onDelete: 'cascade' }),
    verdict: varchar('verdict', { length: 16 }).notNull(),
    /** Documento de autonomia publicado (`methodology_documents.id`) aplicado à decisão. */
    policyVersionId: uuid('policy_version_id'),
    /** Regras que levaram ao veredito, em linguagem legível (para o painel e para o aluno). */
    reasons: jsonb('reasons').$type<string[]>().notNull(),
    decidedBy: varchar('decided_by', { length: 16 }).notNull(),
    staffId: uuid('staff_id').references(() => staff.id, { onDelete: 'restrict' }),
    ...timestampColumns,
  },
  (t) => [
    index('idx_coaching_decisions_user').on(t.userId, t.createdAt),
    index('idx_coaching_decisions_proposal').on(t.proposalId),
    checkOneOf('ck_coaching_decisions_verdict', t.verdict, decisionVerdictSchema.options),
    checkOneOf('ck_coaching_decisions_decided_by', t.decidedBy, ['POLICY_ENGINE', 'STAFF']),
  ],
);

export const decisionExecutions = pgTable(
  'decision_executions',
  {
    id: primaryKeyColumn(),
    userId: ownerColumn(),
    decisionId: uuid('decision_id')
      .notNull()
      .unique()
      .references(() => coachingDecisions.id, { onDelete: 'cascade' }),
    /** Comando de domínio chamado (ex.: `training.reschedule`). */
    command: varchar('command', { length: 60 }).notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    /** Ids do que foi criado/alterado, ou o motivo da falha. */
    result: jsonb('result').$type<Record<string, unknown>>().notNull(),
    ...timestampColumns,
  },
  (t) => [
    index('idx_decision_executions_user').on(t.userId, t.createdAt),
    checkOneOf('ck_decision_executions_status', t.status, ['SUCCEEDED', 'FAILED', 'SKIPPED']),
  ],
);

/** Sinal de segurança. Enquanto `ACTIVE`, suspende as ações automáticas do seu escopo. */
export const safetyEvents = pgTable(
  'safety_events',
  {
    id: primaryKeyColumn(),
    userId: ownerColumn(),
    kind: varchar('kind', { length: 32 }).notNull(),
    severity: varchar('severity', { length: 16 }).notNull(),
    scope: varchar('scope', { length: 16 }).notNull(),
    /** Origem do sinal: regra determinística ou detector sobre texto livre. */
    detectedBy: varchar('detected_by', { length: 16 }).notNull(),
    evidence: text('evidence').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('ACTIVE'),
    resolvedBy: uuid('resolved_by').references(() => staff.id, { onDelete: 'restrict' }),
    resolutionNote: text('resolution_note'),
    resolvedAt: eventTimestamp('resolved_at'),
    ...timestampColumns,
  },
  (t) => [
    index('idx_safety_events_user_active')
      .on(t.userId, t.scope)
      .where(sql`${t.status} = 'ACTIVE'`),
    checkOneOf('ck_safety_events_kind', t.kind, safetySignalKindSchema.options),
    checkOneOf('ck_safety_events_severity', t.severity, safetySeveritySchema.options),
    checkOneOf('ck_safety_events_scope', t.scope, safetyScopeSchema.options),
    checkOneOf('ck_safety_events_detected_by', t.detectedBy, ['RULE', 'DETECTOR', 'STAFF']),
    checkOneOf('ck_safety_events_status', t.status, ['ACTIVE', 'RESOLVED']),
  ],
);

/** Fila humana por exceção. */
export const exceptionCases = pgTable(
  'exception_cases',
  {
    id: primaryKeyColumn(),
    userId: ownerColumn(),
    kind: varchar('kind', { length: 32 }).notNull(),
    priority: varchar('priority', { length: 8 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('OPEN'),
    /** Domínio profissional que responde (treino → CREF, nutrição → CRN). */
    domain: varchar('domain', { length: 16 }).notNull(),
    /** Referências do caso (proposta, decisão, sinal de segurança, conversa). */
    subject: jsonb('subject').$type<Record<string, string>>().notNull(),
    /** Resumo preparado pelo copiloto profissional — dispensa ler a conversa inteira. */
    summary: text('summary').notNull(),
    assignedStaffId: uuid('assigned_staff_id').references(() => staff.id, {
      onDelete: 'restrict',
    }),
    resolution: jsonb('resolution').$type<Record<string, unknown>>(),
    resolvedAt: eventTimestamp('resolved_at'),
    ...timestampColumns,
  },
  (t) => [
    index('idx_exception_cases_open')
      .on(t.status, t.priority, t.createdAt)
      .where(sql`${t.status} <> 'RESOLVED'`),
    index('idx_exception_cases_user').on(t.userId, t.createdAt),
    checkOneOf('ck_exception_cases_kind', t.kind, exceptionKindSchema.options),
    checkOneOf('ck_exception_cases_priority', t.priority, exceptionPrioritySchema.options),
    checkOneOf('ck_exception_cases_status', t.status, exceptionStatusSchema.options),
    checkOneOf('ck_exception_cases_domain', t.domain, ['TRAINING', 'NUTRITION', 'GENERAL']),
  ],
);
