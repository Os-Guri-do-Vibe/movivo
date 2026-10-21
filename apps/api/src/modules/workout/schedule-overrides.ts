/**
 * Leitura dos ajustes de agenda ativos do protocolo, como mapa data → sessão.
 *
 * Função solta (e não método do `WorkoutScheduleService`) para que quem só LÊ o calendário
 * efetivo — o contexto do Coach, o diário — a use com o `tx` que já tem aberto, sem depender
 * do módulo de treino por injeção.
 */
import { and, asc, eq, gte, isNull } from 'drizzle-orm';

import { workoutScheduleAdjustments } from '../../core/database/schema';
import type { TenantTransaction } from '../../core/database/tenant-database.service';
import { overridesFromAdjustments } from './schedule-planner';

/** Quanto tempo de ajustes o calendário efetivo lê (cobre a janela de 14 dias do alerta de frequência). */
export const ADJUSTMENT_LOOKBACK_DAYS = 35;

export async function loadScheduleOverrides(
  tx: TenantTransaction,
  userId: string,
  protocolId: string,
  now = new Date(),
): Promise<Map<string, string | null>> {
  const since = new Date(now.getTime() - ADJUSTMENT_LOOKBACK_DAYS * 86_400_000);
  const rows = await tx
    .select({ assignments: workoutScheduleAdjustments.assignments })
    .from(workoutScheduleAdjustments)
    .where(
      and(
        eq(workoutScheduleAdjustments.userId, userId),
        eq(workoutScheduleAdjustments.protocolId, protocolId),
        isNull(workoutScheduleAdjustments.undoneAt),
        gte(workoutScheduleAdjustments.createdAt, since),
      ),
    )
    .orderBy(asc(workoutScheduleAdjustments.createdAt));
  return overridesFromAdjustments(rows);
}
