import { drizzle } from 'drizzle-orm/postgres-js';
import { describe, expect, it, vi } from 'vitest';

import type { TenantTransaction } from '../../core/database/tenant-database.service';
import {
  type OpenCaseCounts,
  openCaseCounts,
  openCaseCountsQuery,
  summaryOf,
} from './exception-summary';

const db = drizzle.mock() as unknown as Pick<TenantTransaction, 'select'>;
const compiled = (domains: Parameters<typeof openCaseCountsQuery>[1]) =>
  openCaseCountsQuery(db, domains).toSQL();

const counts = (partial: Partial<OpenCaseCounts>): OpenCaseCounts => ({
  queueStudents: 0,
  queueUrgentStudents: 0,
  alertCases: 0,
  alertUrgentCases: 0,
  ...partial,
});

/** `tx` falso: devolve as linhas dadas para a consulta agregada. */
function txReturning(rows: OpenCaseCounts[]) {
  const where = vi.fn(() => Promise.resolve(rows));
  const tx = { select: () => ({ from: () => ({ where }) }) };
  return tx as unknown as Pick<TenantTransaction, 'select'>;
}

describe('consulta da contagem', () => {
  it('é uma linha agregada: a Fila por aluno distinto, Alertas por caso', () => {
    const { sql } = compiled(null);
    // Fila: alunos distintos (+ caso sem aluno, que conta sozinho).
    expect(sql).toContain('count(distinct "user_id") filter (where "exception_cases"."kind" in');
    expect(sql).toContain('and "user_id" is null');
    // Alertas: casos, fora dos tipos da Fila.
    expect(sql).toContain('count(*) filter (where not ("exception_cases"."kind" in');
    // Só abertos; sem GROUP BY nem LIMIT (o total não é mais cortado em 200 casos).
    expect(sql).toContain('"exception_cases"."status" <> $');
    expect(sql).not.toMatch(/group by|limit/i);
  });

  it('o aluno é urgente na Fila se QUALQUER caso dele for URGENT ou HIGH', () => {
    const { sql, params } = compiled(null);
    expect(sql).toMatch(
      /count\(distinct "user_id"\) filter \(where "exception_cases"\."kind" in \([^)]*\) and "exception_cases"\."priority" in/,
    );
    expect(params).toEqual(expect.arrayContaining(['PROTOCOL_REVIEW', 'DECISION_FAILURE']));
    expect(params).toEqual(expect.arrayContaining(['URGENT', 'HIGH', 'RESOLVED']));
  });

  it('profissional vê só o domínio do conselho; ADMIN vê todos', () => {
    const scoped = compiled(['TRAINING', 'GENERAL']);
    expect(scoped.sql).toContain('"exception_cases"."domain" in');
    expect(scoped.params).toEqual(expect.arrayContaining(['TRAINING', 'GENERAL']));
    expect(compiled(null).sql).not.toContain('"exception_cases"."domain"');
  });

  it('sem casos abertos, tudo zero', async () => {
    await expect(openCaseCounts(txReturning([]), null)).resolves.toEqual(counts({}));
  });
});

describe('summaryOf', () => {
  it('aluno com protocolo de treino e alimentar (2 casos) conta 1 na Fila', () => {
    // O que a consulta devolve para 1 aluno com 2 casos abertos na Fila.
    const summary = summaryOf(counts({ queueStudents: 1 }));
    expect(summary.queue).toEqual({ open: 1, urgent: 0 });
    expect(summary.open).toBe(1);
  });

  it('aluno com caso obrigatório (HIGH) e opcional (NORMAL) conta 1 aberto e 1 urgente', () => {
    const summary = summaryOf(counts({ queueStudents: 1, queueUrgentStudents: 1 }));
    expect(summary.queue).toEqual({ open: 1, urgent: 1 });
    expect(summary.urgent).toBe(1);
  });

  it('Alertas seguem por caso e o sino soma os dois painéis', () => {
    const summary = summaryOf(
      counts({ queueStudents: 2, queueUrgentStudents: 1, alertCases: 3, alertUrgentCases: 2 }),
    );
    expect(summary).toEqual({
      open: 5,
      urgent: 3,
      queue: { open: 2, urgent: 1 },
      alerts: { open: 3, urgent: 2 },
    });
  });

  it('caso sem aluno conta sozinho (a consulta já o soma ao número de alunos)', () => {
    // 1 aluno com 2 casos + 1 caso sem aluno = 2 na Fila.
    expect(summaryOf(counts({ queueStudents: 2 })).queue.open).toBe(2);
  });

  it('sem casos: o mesmo formato, zerado', () => {
    expect(summaryOf(counts({}))).toEqual({
      open: 0,
      urgent: 0,
      queue: { open: 0, urgent: 0 },
      alerts: { open: 0, urgent: 0 },
    });
  });
});
