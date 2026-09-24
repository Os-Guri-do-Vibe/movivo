/**
 * `SubscriptionPeriodScheduler` — encerra o período pago que terminou sem renovação.
 *
 * Mesmo desenho de `ProtocolRenewalScheduler`: cron (`SCAN`) que varre `subscriptions` ACTIVE
 * com `current_period_end` vencido e delega a decisão a `SubscriptionService.expirePeriod`.
 * Sem isto, parcelado no cartão e Pix à vista (que não renovam) ficariam ACTIVE para sempre —
 * com acesso liberado e sem poder comprar de novo, porque o checkout recusa ACTIVE.
 *
 * Horário, não diário: o fim do período é um instante, e a varredura diária daria até 24h de
 * acesso além do pago. Contrato recorrente só expira depois da janela de graça (a decisão
 * mora no serviço), então um webhook de renovação atrasado não derruba quem está em dia.
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkerFactory } from '../jobs/worker.factory';
import { SubscriptionRepository } from './subscription.repository';
import { SubscriptionService } from './subscription.service';

type PeriodScanJob = { kind: 'SCAN' };

/** Teto por varredura — a próxima hora pega o restante (a base inteira cabe folgada). */
const SCAN_BATCH = 500;

@Injectable()
export class SubscriptionPeriodScheduler implements OnModuleInit {
  constructor(
    private readonly workers: WorkerFactory,
    private readonly queues: QueueManager,
    private readonly repo: SubscriptionRepository,
    private readonly subs: SubscriptionService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SubscriptionPeriodScheduler.name);
  }

  async onModuleInit(): Promise<void> {
    this.workers.create<PeriodScanJob>(QUEUE.subscriptionPeriodScan, () => this.scan());

    await this.queues
      .get(QUEUE.subscriptionPeriodScan)
      .upsertJobScheduler(
        'subscription-period-scan',
        { pattern: '5 * * * *', tz: 'America/Sao_Paulo' },
        { name: 'subscription-period-scan', data: { kind: 'SCAN' } satisfies PeriodScanJob },
      );
  }

  async scan(now: Date = new Date()): Promise<{ status: string; expired: number }> {
    const candidates = await this.repo.findActiveWithEndedPeriod(now, SCAN_BATCH);
    let expired = 0;
    let failed = 0;
    for (const userId of candidates) {
      try {
        const result = await this.subs.expirePeriod(userId, now);
        if (result.status === 'EXPIRED') expired += 1;
      } catch (error) {
        // Um titular com problema não segura os demais; o retry da fila refaz a varredura,
        // e `expirePeriod` é idempotente para quem já foi encerrado.
        failed += 1;
        this.logger.warn(
          { userId, err: error instanceof Error ? error.message : String(error) },
          'falha ao encerrar período pago',
        );
      }
    }
    this.logger.info(
      { event: 'subscription_period_scan', candidates: candidates.length, expired, failed },
      'varredura de fim de período concluída',
    );
    if (failed > 0) throw new Error(`varredura de fim de período: ${failed} falha(s)`);
    return { status: 'SCANNED', expired };
  }
}
