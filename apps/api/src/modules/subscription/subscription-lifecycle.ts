/**
 * Derivação e emissão dos marcos de ciclo de vida do aluno (US-8.3 / TASK-8.3.1).
 *
 * ## Por que aqui e não em cada caso de uso
 * A varredura do código mostrou que **todo** ponto que muda `subscriptions.status` passa por
 * `SubscriptionRepository.insert`/`patch` — webhook do gateway, cancelamento, pausa, retomada
 * e início de trial, todos. Emitir a transição em cada caso de uso significaria seis pontos
 * para esquecer um; emitir no repositório é um ponto só, e nenhum caminho escapa por
 * construção. É a mesma razão pela qual a hash chain de `audit_logs` vive num trigger.
 *
 * ## Definição de "convertido" — DECISÃO PROVISÓRIA
 * A definição fechada por Eduardo é **primeiro pagamento liquidado**. A tabela `payments` (e o
 * webhook de liquidação) só existe na US-8.5, que ainda não foi implementada. Até lá o proxy é
 * `subscriptions.status` indo de `TRIALING` para `ACTIVE` — o que hoje corresponde ao
 * `CHECKOUT_CONFIRMED` do gateway, ou seja, pagamento *autorizado*, não liquidado. A diferença
 * é reembolso e falha de liquidação pós-autorização, que inflam a conversão para cima.
 * **Revisitar quando a US-8.5 existir**: trocar a origem do marco `CONVERTED` para o primeiro
 * `payments` liquidado e reprocessar o backfill. A ressalva está exposta na definição da
 * métrica no Control Center, não só neste comentário.
 */
import { sql } from 'drizzle-orm';
import type { SubscriptionStatus } from '@movivo/shared';

import { userStatusTransitions } from '../../core/database/schema';
import type { TenantTransaction } from '../../core/database/tenant-database.service';

export type LifecycleMarker =
  | 'TRIAL_STARTED'
  | 'CONVERTED'
  | 'RENEWED'
  | 'PAUSED'
  | 'RESUMED'
  | 'CANCELED';

export type TransitionActor = 'SYSTEM' | 'USER' | 'PROFESSIONAL' | 'BACKFILL';

/**
 * Marco correspondente a (status anterior → status novo). `null` quando a mudança não tem
 * significado de ciclo de vida — hoje só `PAST_DUE` e `EXPIRED`, que são estados de cobrança
 * e de fim de período, e não marcos do funil de Eduardo. Nunca inventar um marco para eles:
 * um `CONVERTED` fabricado a partir de `PAST_DUE → ACTIVE` (que é recuperação de dunning, e
 * é `RENEWED`) contaria o mesmo aluno duas vezes na coorte.
 */
export function lifecycleMarkerFor(
  from: SubscriptionStatus | null,
  to: SubscriptionStatus,
): LifecycleMarker | null {
  if (from === to && to !== 'ACTIVE') return null;
  switch (to) {
    case 'TRIALING':
      return from === null ? 'TRIAL_STARTED' : null;
    case 'CANCELED':
      return 'CANCELED';
    case 'PAUSED':
      return 'PAUSED';
    case 'ACTIVE':
      if (from === 'PAUSED') return 'RESUMED';
      // Proxy provisório de "convertido" — ver cabeçalho do arquivo.
      if (from === 'TRIALING') return 'CONVERTED';
      // ACTIVE→ACTIVE (novo período no gateway) e PAST_DUE→ACTIVE (dunning recuperado).
      return from === 'ACTIVE' || from === 'PAST_DUE' ? 'RENEWED' : null;
    default:
      return null;
  }
}

/**
 * Grava a transição na tabela append-only. `from_status` é o último marco do titular, lido
 * por subconsulta escalar dentro do próprio INSERT: a alternativa (mapear o status anterior da
 * assinatura para um marco) é ambígua — `ACTIVE` tanto pode ter vindo de `CONVERTED` quanto de
 * `RESUMED`. `onConflictDoNothing` sobre `(user_id, to_status, occurred_at)` é o que torna o
 * backfill idempotente sem uma segunda consulta de existência.
 */
export async function recordLifecycleTransition(
  tx: TenantTransaction,
  input: {
    userId: string;
    toStatus: LifecycleMarker;
    actor: TransitionActor;
    reason?: string | null;
    occurredAt?: Date;
  },
): Promise<void> {
  await tx
    .insert(userStatusTransitions)
    .values({
      userId: input.userId,
      fromStatus: sql`(
        select prior.to_status from user_status_transitions prior
        where prior.user_id = ${input.userId}
        order by prior.occurred_at desc, prior.created_at desc limit 1
      )`,
      toStatus: input.toStatus,
      actor: input.actor,
      reason: input.reason ?? null,
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    })
    .onConflictDoNothing();
}
