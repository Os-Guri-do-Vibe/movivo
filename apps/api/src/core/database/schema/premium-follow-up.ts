/**
 * Acompanhamento premium: os dados que fazem o aluno ser acompanhado de verdade todos os dias.
 *
 *  · `student_reports`: tudo o que o aluno conta (no chat ou nos check-ins) vira dado
 *    comparável: sono, estresse, energia, humor, corpo, doença, viagem, trabalho.
 *  · `student_day_digests`: o estudo do dia, uma linha por aluno e dia, com todos os sinais juntos.
 *  · `session_snapshots`: cada treino concluído lado a lado com a disposição do dia e com a
 *    última vez que o aluno fez a mesma sessão.
 *  · `student_commitments`: o "próximo passo" combinado e o que aconteceu com ele.
 *  · `agent_outreaches`: cada contato que a MOVIVO iniciou e se o aluno respondeu.
 *  · `message_quality_reviews`: a auditoria de qualidade das mensagens que os agentes enviam.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  smallint,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import {
  bytea,
  checkOneOf,
  eventTimestamp,
  primaryKeyColumn,
  timestampColumns,
  userIdColumn,
} from './_shared';
import { sessionExecutions } from './training';
import { users } from './users';

// --- Observações do aluno -----------------------------------------------------------------

export const OBSERVATION_KINDS = [
  'SLEEP',
  'STRESS',
  'ENERGY',
  'MOOD',
  'SORENESS',
  'HUNGER',
  'DIGESTION',
  'ILLNESS',
  'ALCOHOL',
  'TRAVEL',
  'WORK',
  'SOCIAL',
  'OTHER',
] as const;
export type ObservationKind = (typeof OBSERVATION_KINDS)[number];

/** Em relação ao treino do dia: antes, depois ou sem relação. */
export const OBSERVATION_PHASES = ['BEFORE', 'AFTER', 'NONE'] as const;
export type ObservationPhase = (typeof OBSERVATION_PHASES)[number];

export const OBSERVATION_SOURCES = ['CHAT', 'CHECK_IN', 'SESSION'] as const;
export type ObservationSource = (typeof OBSERVATION_SOURCES)[number];

export const studentReports = pgTable(
  'student_reports',
  {
    id: primaryKeyColumn(),
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    onDate: date('on_date').notNull(),
    kind: varchar('kind', { length: 12 }).notNull(),
    /** 1 a 5 na mesma escala do check-in do dia (1 = pior; estresse: 1 = sem estresse). */
    score: smallint('score'),
    /** Quantidade quando faz sentido (horas de sono, doses de álcool). */
    valueNum: numeric('value_num', { precision: 6, scale: 2, mode: 'number' }),
    phase: varchar('phase', { length: 8 }).notNull().default('NONE'),
    source: varchar('source', { length: 10 }).notNull(),
    /** O que o aluno disse, em poucas palavras (cifrado: pode ser dado de saúde). */
    note: bytea('note'),
    recordedAt: eventTimestamp('recorded_at').notNull().defaultNow(),
    ...timestampColumns,
  },
  (t) => [
    index('idx_student_reports_user').on(t.userId, t.onDate),
    checkOneOf('ck_student_reports_kind', t.kind, OBSERVATION_KINDS),
    checkOneOf('ck_student_reports_phase', t.phase, OBSERVATION_PHASES),
    checkOneOf('ck_student_reports_source', t.source, OBSERVATION_SOURCES),
    check(
      'ck_student_reports_score',
      sql`${t.score} is null or ${t.score} between 1 and 5`,
    ),
  ],
);

// --- Estudo do dia -------------------------------------------------------------------------

export const studentDayDigests = pgTable(
  'student_day_digests',
  {
    id: primaryKeyColumn(),
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    onDate: date('on_date').notNull(),
    /** O dia em números (ver `progress/day-digest.ts`); sem texto livre do aluno. */
    digest: jsonb('digest').$type<Record<string, unknown>>().notNull(),
    ...timestampColumns,
  },
  (t) => [
    unique('uq_student_day_digests_day').on(t.userId, t.onDate),
    index('idx_student_day_digests_user').on(t.userId, t.onDate),
  ],
);

// --- Snapshot de sessão --------------------------------------------------------------------

export const sessionSnapshots = pgTable(
  'session_snapshots',
  {
    id: primaryKeyColumn(),
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    executionId: uuid('execution_id')
      .notNull()
      .references(() => sessionExecutions.id, { onDelete: 'cascade' }),
    performedOn: date('performed_on').notNull(),
    modality: varchar('modality', { length: 16 }).notNull(),
    /** Chave estável da sessão do plano (título normalizado): compara "a mesma sessão" no tempo. */
    sessionKey: varchar('session_key', { length: 80 }).notNull(),
    /** Disposição do dia (check-in + relatos do chat): sono, energia, corpo, humor, estresse. */
    readiness: jsonb('readiness').$type<Record<string, unknown>>().notNull(),
    /** Desempenho: volume, esforço, proximidade da falha, ritmo, frequência cardíaca. */
    performance: jsonb('performance').$type<Record<string, unknown>>().notNull(),
    /** Variação contra a(s) última(s) vez(es) que o aluno fez a mesma sessão. */
    comparison: jsonb('comparison').$type<Record<string, unknown>>().notNull(),
    ...timestampColumns,
  },
  (t) => [
    unique('uq_session_snapshots_execution').on(t.executionId),
    index('idx_session_snapshots_user').on(t.userId, t.performedOn),
    index('idx_session_snapshots_key').on(t.userId, t.sessionKey, t.performedOn),
  ],
);

// --- Compromissos --------------------------------------------------------------------------

export const COMMITMENT_STATUSES = ['OPEN', 'KEPT', 'PARTIAL', 'NOT_KEPT', 'DROPPED'] as const;
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number];

export const studentCommitments = pgTable(
  'student_commitments',
  {
    id: primaryKeyColumn(),
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Quem combinou: treinador, nutricionista ou hábitos. */
    source: varchar('source', { length: 10 }).notNull(),
    text: varchar('text', { length: 240 }).notNull(),
    createdOn: date('created_on').notNull(),
    dueOn: date('due_on').notNull(),
    status: varchar('status', { length: 10 }).notNull().default('OPEN'),
    /** O que nos dados sustenta o veredito. */
    evidence: varchar('evidence', { length: 200 }),
    reviewedAt: eventTimestamp('reviewed_at'),
    /** Quando a MOVIVO lembrou o aluno no meio da semana (uma vez por compromisso). */
    nudgedAt: eventTimestamp('nudged_at'),
    ...timestampColumns,
  },
  (t) => [
    index('idx_student_commitments_user').on(t.userId, t.status, t.dueOn),
    checkOneOf('ck_student_commitments_source', t.source, ['TRAINING', 'NUTRITION', 'HABITS']),
    checkOneOf('ck_student_commitments_status', t.status, COMMITMENT_STATUSES),
  ],
);

// --- Contatos iniciados pela MOVIVO --------------------------------------------------------

export const OUTREACH_KINDS = [
  'LOGGING_GAP',
  'MISSED_SESSION',
  'SILENCE',
  'COMMITMENT_NUDGE',
  'SPECIALIST_DAILY',
] as const;
export type OutreachKind = (typeof OUTREACH_KINDS)[number];

export const agentOutreaches = pgTable(
  'agent_outreaches',
  {
    id: primaryKeyColumn(),
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 20 }).notNull(),
    /** Degrau da escada de silêncio (1 a 4); nulo nos demais. */
    level: smallint('level'),
    /** Abordagem que o especialista escolheu (para medir o que funciona e não repetir). */
    strategy: varchar('strategy', { length: 32 }),
    sentAt: eventTimestamp('sent_at').notNull().defaultNow(),
    /** Primeira mensagem do aluno depois do contato (dentro de 72 horas). */
    respondedAt: eventTimestamp('responded_at'),
    ...timestampColumns,
  },
  (t) => [
    index('idx_agent_outreaches_user').on(t.userId, t.sentAt),
    checkOneOf('ck_agent_outreaches_kind', t.kind, OUTREACH_KINDS),
    check('ck_agent_outreaches_level', sql`${t.level} is null or ${t.level} between 1 and 4`),
  ],
);

// --- Qualidade das mensagens ---------------------------------------------------------------

export const QUALITY_VERDICTS = ['OK', 'REVIEW'] as const;
export type QualityVerdict = (typeof QUALITY_VERDICTS)[number];

export const messageQualityReviews = pgTable(
  'message_quality_reviews',
  {
    id: primaryKeyColumn(),
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Identificação do envio (dedupeId do agente) e do agente que o originou. */
    dedupeId: varchar('dedupe_id', { length: 120 }).notNull(),
    flow: varchar('flow', { length: 40 }).notNull(),
    /** Checagens do código (sempre rodam): repetição, tamanho, números fora dos dados, culpa. */
    checks: jsonb('checks').$type<Record<string, unknown>>().notNull(),
    /** Notas do juiz (1 a 5 por critério) quando a mensagem foi amostrada. */
    scores: jsonb('scores').$type<Record<string, unknown>>(),
    judged: boolean('judged').notNull().default(false),
    verdict: varchar('verdict', { length: 8 }).notNull(),
    /** Média das notas do juiz (ou nulo quando só o código avaliou). */
    overall: numeric('overall', { precision: 3, scale: 2, mode: 'number' }),
    reviewedByStaffAt: eventTimestamp('reviewed_by_staff_at'),
    ...timestampColumns,
  },
  (t) => [
    unique('uq_message_quality_reviews_send').on(t.userId, t.dedupeId),
    index('idx_message_quality_reviews_flow').on(t.flow, t.createdAt),
    index('idx_message_quality_reviews_verdict').on(t.verdict, t.createdAt),
    checkOneOf('ck_message_quality_reviews_verdict', t.verdict, QUALITY_VERDICTS),
  ],
);
