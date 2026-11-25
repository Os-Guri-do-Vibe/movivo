/**
 * Contagem do menu lateral e do sino (`GET /exceptions/summary`), numa única consulta agregada.
 *
 * - Fila do Profissional: conta ALUNOS, não casos. A tela mostra um cartão por aluno com uma
 *   linha por pendência, então treino + alimentar do mesmo aluno contam 1. O aluno é urgente se
 *   QUALQUER caso dele na Fila for urgente (mesma regra do cartão: uma linha basta).
 * - Alertas: continuam por caso. A tela de Alertas lista um item por caso (segurança, exame,
 *   pedido de revisão...), e cada um pede uma ação própria; contar por aluno esconderia alerta.
 * - Total (sino): a soma dos dois painéis, como o sino já apresenta.
 *
 * `exception_cases.user_id` é NOT NULL hoje; mesmo assim, um caso sem aluno contaria sozinho
 * (o `count(distinct)` ignora `NULL`, então ele é somado à parte) para a regra não depender disso.
 */
import { and, inArray, ne, sql, type SQL } from 'drizzle-orm';

import {
  type ExceptionDomain,
  type ExceptionsSummary,
  QUEUE_EXCEPTION_KINDS,
} from '@movivo/shared';

import { exceptionCases } from '../../core/database/schema';
import type { TenantTransaction } from '../../core/database/tenant-database.service';

/** Prioridades que contam como "urgente" no selo (as mesmas do `summary` desde sempre). */
export const URGENT_PRIORITIES = ['URGENT', 'HIGH'] as const;

export interface OpenCaseCounts {
  /** Alunos distintos com caso aberto na Fila. */
  queueStudents: number;
  /** Alunos distintos com ao menos um caso urgente na Fila. */
  queueUrgentStudents: number;
  /** Casos abertos em Alertas. */
  alertCases: number;
  /** Casos urgentes em Alertas. */
  alertUrgentCases: number;
}

const EMPTY_COUNTS: OpenCaseCounts = {
  queueStudents: 0,
  queueUrgentStudents: 0,
  alertCases: 0,
  alertUrgentCases: 0,
};

/** Alunos distintos que atendem ao filtro; caso sem aluno conta sozinho. */
function studentsWhere(filter: SQL): SQL<number> {
  return sql<number>`(count(distinct ${exceptionCases.userId}) filter (where ${filter}) + count(*) filter (where ${filter} and ${exceptionCases.userId} is null))::int`;
}

function casesWhere(filter: SQL): SQL<number> {
  return sql<number>`(count(*) filter (where ${filter}))::int`;
}

/**
 * A consulta (uma linha só) sobre os casos não resolvidos do domínio do profissional; `null` =
 * todos os domínios (ADMIN). Usa o índice parcial `idx_exception_cases_open`.
 */
export function openCaseCountsQuery(
  tx: Pick<TenantTransaction, 'select'>,
  domains: readonly ExceptionDomain[] | null,
) {
  const inQueue = inArray(exceptionCases.kind, [...QUEUE_EXCEPTION_KINDS]);
  const inAlerts = sql`not (${inQueue})`;
  const urgent = inArray(exceptionCases.priority, [...URGENT_PRIORITIES]);
  return tx
    .select({
      queueStudents: studentsWhere(inQueue),
      queueUrgentStudents: studentsWhere(sql`${inQueue} and ${urgent}`),
      alertCases: casesWhere(inAlerts),
      alertUrgentCases: casesWhere(sql`${inAlerts} and ${urgent}`),
    })
    .from(exceptionCases)
    .where(
      and(
        ne(exceptionCases.status, 'RESOLVED'),
        domains ? inArray(exceptionCases.domain, [...domains]) : undefined,
      ),
    );
}

export async function openCaseCounts(
  tx: Pick<TenantTransaction, 'select'>,
  domains: readonly ExceptionDomain[] | null,
): Promise<OpenCaseCounts> {
  const [row] = await openCaseCountsQuery(tx, domains);
  return row ?? EMPTY_COUNTS;
}

/** Contrato do `summary` (inalterado): cada painel com `open`/`urgent`; o total soma os dois. */
export function summaryOf(counts: OpenCaseCounts): ExceptionsSummary {
  const queue = { open: counts.queueStudents, urgent: counts.queueUrgentStudents };
  const alerts = { open: counts.alertCases, urgent: counts.alertUrgentCases };
  return {
    open: queue.open + alerts.open,
    urgent: queue.urgent + alerts.urgent,
    queue,
    alerts,
  };
}
