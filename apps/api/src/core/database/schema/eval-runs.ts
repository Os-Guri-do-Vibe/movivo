/**
 * `eval_runs` — cada execução da avaliação de uma tarefa de agente (global, sem titular).
 *
 * Guarda o que é preciso para comparar versões: tarefa, versão do prompt, versões da
 * metodologia, modelo usado, nota por caso e o veredito. É a prova exigida antes de publicar
 * metodologia, trocar o modelo de um tier ou mudar um prompt.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { eventTimestamp, primaryKeyColumn } from './_shared';
import { staff } from './staff';

export interface EvalCaseResult {
  caseId: string;
  pass: boolean;
  score: number;
  /** Detalhe por asserção (descrição, aprovado, motivo). */
  assertions: { description: string; pass: boolean; detail: string }[];
  correctionRounds: number;
  costBrl: number;
  /** Falha ao executar (sem saída válida, provedor indisponível). */
  error: string | null;
}

export const evalRuns = pgTable(
  'eval_runs',
  {
    id: primaryKeyColumn(),
    taskId: varchar('task_id', { length: 60 }).notNull(),
    promptVersion: varchar('prompt_version', { length: 64 }).notNull(),
    methodologyVersions: jsonb('methodology_versions').$type<Record<string, number>>().notNull(),
    /** Rota forçada na comparação de modelos; nula = rotas configuradas do tier. */
    vendor: varchar('vendor', { length: 16 }),
    model: varchar('model', { length: 80 }),
    casesTotal: integer('cases_total').notNull(),
    casesPassed: integer('cases_passed').notNull(),
    passed: boolean('passed').notNull(),
    costBrl: numeric('cost_brl', { precision: 10, scale: 5, mode: 'number' }).notNull(),
    results: jsonb('results').$type<EvalCaseResult[]>().notNull(),
    /** Quem pediu (painel); nulo quando veio da CLI ou de um gate automático. */
    requestedBy: uuid('requested_by').references(() => staff.id, { onDelete: 'restrict' }),
    startedAt: eventTimestamp('started_at').notNull(),
    finishedAt: eventTimestamp('finished_at').notNull(),
  },
  (t) => [index('idx_eval_runs_task').on(t.taskId, t.finishedAt)],
);
