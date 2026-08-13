/**
 * `PaymentReconciliationWorker` (US-8.5 / TASK-8.5.3) — grava a receita **recebida**.
 *
 * O webhook (`PaymentWebhookService`) faz o mínimo e responde rápido: verifica a assinatura
 * e enfileira. Aqui acontece o trabalho: vincular o evento à assinatura, calcular o líquido
 * de taxa e gravar **uma** linha em `payments`.
 *
 * ## Por que a gravação é aqui, e não no controller
 * `payments` é append-only (trigger + REVOKE): a linha nasce pronta ou não nasce. Se o
 * webhook gravasse primeiro e a conciliação preenchesse `subscription_id` depois, o segundo
 * passo seria um UPDATE — exatamente o que a tabela proíbe, e por bom motivo (uma liquidação
 * que muda de valor depois de apurada muda lucro de período fechado sem rastro). Resolver o
 * vínculo ANTES do único insert mantém as duas propriedades ao mesmo tempo.
 *
 * ponytail: a durabilidade entre "assinatura verificada" e "linha gravada" é a do Redis
 * (AOF, Sprint 0) + os 5 retries + DLQ. Upgrade se algum dia isso doer: outbox transacional
 * no mesmo banco. Hoje o gateway reentrega eventos não confirmados, o que já cobre o caso.
 *
 * ## Idempotência
 * Não há `select` antes do `insert`. A garantia é a UNIQUE `(gateway, gateway_event_id)` +
 * `onConflictDoNothing`: reentrega do gateway, retry do BullMQ e duas instâncias
 * processando em paralelo convergem para uma linha, sem janela de corrida.
 *
 * ## Estorno / chargeback
 * Linha NOVA de sinal contrário (`amount_cents` negativo), nunca alteração da original.
 * `sum(amount_cents)` devolve o líquido correto sem nenhum CASE.
 *
 * ## Órfão
 * Evento cuja `external_subscription_id` não existe aqui (metadata errado, cobrança fora do
 * produto, teste do gateway) **não é descartado**: grava com `subscription_id`/`user_id`
 * nulos e aparece na fila de exceção do painel (`GET .../finance/payments/exceptions`).
 *
 * ## `raw_payload`
 * Vai para a coluna jsonb sob RLS e **nunca** para o log. Nenhum campo deste worker loga o
 * payload; o que sobe ao log é id de evento, tipo e status.
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { desc, eq, or, sql } from 'drizzle-orm';
import { type Job } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';

import { payments, subscriptions } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { QUEUE } from '../jobs/jobs.config';
import { WorkerFactory } from '../jobs/worker.factory';
import type { GatewayEvent, GatewayName } from './payment/payment-gateway.types';

/** Estado da liquidação gravado em `payments.status`. */
export const PaymentStatus = {
  SETTLED: 'SETTLED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export interface PaymentReconciliationJob {
  readonly gateway: GatewayName;
  readonly event: GatewayEvent;
  /** Payload bruto do provedor, já verificado. Nunca é logado. */
  readonly rawPayload: unknown;
  readonly correlationId: string;
}

/**
 * Mapeia o evento normalizado para o efeito financeiro. `SUBSCRIPTION_CANCELED` devolve
 * `null`: cancelamento é mudança de contrato, não movimento de dinheiro — gravar uma linha
 * de R$0 poluiria a contagem de inadimplência sem informar nada.
 */
export function settlementOf(
  event: GatewayEvent,
): { status: PaymentStatus; amountCents: number } | null {
  const declared = event.amountCents ?? event.priceCents ?? 0;
  const magnitude = Math.abs(declared);
  switch (event.type) {
    case 'CHECKOUT_CONFIRMED':
      return { status: PaymentStatus.SETTLED, amountCents: magnitude };
    // Tentativa que não liquidou: o fato importa (é a inadimplência do período), o valor
    // não entrou. Zero aqui é a verdade, não uma lacuna.
    case 'PAYMENT_FAILED':
      return { status: PaymentStatus.FAILED, amountCents: 0 };
    case 'REFUNDED':
      return { status: PaymentStatus.REFUNDED, amountCents: -magnitude };
    case 'SUBSCRIPTION_CANCELED':
      return null;
    default:
      return null;
  }
}

@Injectable()
export class PaymentReconciliationWorker implements OnModuleInit {
  constructor(
    private readonly workers: WorkerFactory,
    private readonly db: TenantDatabase,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PaymentReconciliationWorker.name);
  }

  onModuleInit(): void {
    this.workers.create<PaymentReconciliationJob>(QUEUE.paymentReconciliation, (job) =>
      this.process(job),
    );
  }

  async process(job: Job<PaymentReconciliationJob>): Promise<void> {
    const { gateway, event, rawPayload, correlationId } = job.data;
    const settlement = settlementOf(event);
    if (!settlement) {
      this.logger.info(
        { event: 'payment_event_not_financial', type: event.type, correlationId },
        'evento do gateway sem movimento financeiro — nada a conciliar',
      );
      return;
    }

    // Taxa desconhecida (provedor não informa) ⇒ líquido = bruto. Nunca inventamos taxa;
    // o painel distingue "taxa 0" de "taxa não informada" pela igualdade das duas colunas.
    const feeCents = Math.abs(event.feeCents ?? 0);
    const netAmountCents =
      settlement.amountCents >= 0
        ? settlement.amountCents - feeCents
        : settlement.amountCents + feeCents;

    const occurredAt = parseOccurredAt(event.occurredAt);

    await this.db.runAsSystem(async (tx) => {
      // Vínculo resolvido ANTES do insert — a linha nasce conciliada (ver cabeçalho).
      // Sem assinatura correspondente os dois ficam nulos: é a fila de exceção.
      //
      // Duas chaves, nesta ordem, e a segunda não é redundância:
      //  1. `external_subscription_id` — o vínculo forte, vale para toda renovação.
      //  2. `user_id` do evento — necessário para a PRIMEIRA cobrança. Quem grava o
      //     `external_subscription_id` na assinatura é o próprio evento de checkout, então
      //     na primeira liquidação a coluna ainda está nula e a busca (1) não acha nada.
      //     Sem este passo, toda conversão nasceria órfã na fila de exceção — foi
      //     exatamente o que o teste de integração pegou.
      const [linked] = await tx
        .select({ id: subscriptions.id, userId: subscriptions.userId })
        .from(subscriptions)
        .where(
          or(
            eq(subscriptions.externalSubscriptionId, event.externalSubscriptionId),
            eq(subscriptions.userId, event.userId),
          ),
        )
        // Assinatura que casou pelo id externo ganha da que casou só pelo titular; entre
        // as do titular, vale a mais recente. `nulls last` é explícito porque em `desc` o
        // PostgreSQL põe NULL primeiro por default — o oposto do que se quer aqui.
        .orderBy(
          sql`(${subscriptions.externalSubscriptionId} = ${event.externalSubscriptionId}) desc nulls last`,
          desc(subscriptions.createdAt),
        )
        .limit(1);

      await tx
        .insert(payments)
        .values({
          subscriptionId: linked?.id ?? null,
          userId: linked?.userId ?? null,
          gateway,
          gatewayEventId: event.eventId,
          status: settlement.status,
          amountCents: settlement.amountCents,
          netAmountCents,
          occurredAt,
          rawPayload: rawPayload ?? {},
        })
        // A idempotência. Reentrega/retry/paralelo convergem para uma linha.
        .onConflictDoNothing({ target: [payments.gateway, payments.gatewayEventId] });

      if (!linked) {
        this.logger.warn(
          { event: 'payment_orphan', gateway, status: settlement.status, correlationId },
          'liquidação sem assinatura correspondente — gravada na fila de exceção',
        );
      }
    });
  }
}

/** Data inválida vira "agora": perder a linha por causa do formato do provedor é pior. */
function parseOccurredAt(value: string | undefined): Date {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}
