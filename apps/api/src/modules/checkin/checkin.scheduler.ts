import { Injectable, type OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { CONSENT_TEXTS } from '@movivo/shared';

import { HealthConsentService } from '../../core/database/health-consent.service';
import {
  checkins,
  consents,
  protocols,
  reengagementNudges,
  subscriptions,
} from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import type { WhatsappOutboundJob } from '../jobs/whatsapp-outbound.contract';
import { WorkerFactory } from '../jobs/worker.factory';
import { CheckinService } from './checkin.service';

type CheckinJob =
  | { kind: 'SCAN' }
  | { kind: 'SEND'; userId: string; protocolId: string; weekNumber: number }
  | { kind: 'NUDGE'; userId: string; windowStartedAt: string };

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

@Injectable()
export class CheckinScheduler implements OnModuleInit {
  constructor(
    private readonly workers: WorkerFactory,
    private readonly queues: QueueManager,
    private readonly db: TenantDatabase,
    private readonly healthConsent: HealthConsentService,
    private readonly checkinsService: CheckinService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CheckinScheduler.name);
  }

  async onModuleInit(): Promise<void> {
    this.workers.create<CheckinJob>(QUEUE.checkinWeekly, async (job) => {
      if (job.data.kind === 'SCAN') return this.scan();
      if (job.data.kind === 'SEND') {
        return this.checkinsService.createAndSend(
          job.data.userId,
          job.data.protocolId,
          job.data.weekNumber,
        );
      }
      return this.sendNudge(job.data.userId, new Date(job.data.windowStartedAt));
    });

    await this.queues
      .get(QUEUE.checkinWeekly)
      .upsertJobScheduler(
        'weekly-checkin-scan',
        { pattern: '0 8 * * 1', tz: 'America/Sao_Paulo' },
        { name: 'weekly-checkin-scan', data: { kind: 'SCAN' } satisfies CheckinJob },
      );
  }

  async scan(): Promise<{ status: string; eligible: number }> {
    const eligible = await this.db.runAsSystem((tx) =>
      tx
        .selectDistinct({
          userId: protocols.userId,
          protocolId: protocols.id,
          createdAt: protocols.createdAt,
          totalWeeks: protocols.totalWeeks,
        })
        .from(protocols)
        .innerJoin(subscriptions, eq(subscriptions.userId, protocols.userId))
        .innerJoin(
          consents,
          and(
            eq(consents.userId, protocols.userId),
            eq(consents.consentType, 'HEALTH_DATA'),
            eq(consents.version, CONSENT_TEXTS.HEALTH_DATA.version),
            eq(consents.accepted, true),
            isNull(consents.revokedAt),
          ),
        )
        .where(and(eq(protocols.status, 'ACTIVE'), eq(subscriptions.status, 'ACTIVE'))),
    );

    for (const row of eligible) {
      const weekNumber = this.checkinsService.weekNumber(row.createdAt, row.totalWeeks);
      const delay = this.delayWithinTwoHours(row.userId, weekNumber);
      await this.queues.enqueue(
        QUEUE.checkinWeekly,
        'weekly-checkin-send',
        {
          kind: 'SEND',
          userId: row.userId,
          protocolId: row.protocolId,
          weekNumber,
        } satisfies CheckinJob,
        { jobId: `checkin-send-${row.userId}-${row.protocolId}-${weekNumber}`, delay },
      );
      await this.enqueueNudgeIfDue(row.userId);
    }
    this.logger.info(
      { event: 'checkin_scan_completed', eligible: eligible.length },
      'scan semanal concluido',
    );
    return { status: 'SCANNED', eligible: eligible.length };
  }

  /** @internal Publico apenas para teste deterministico da janela de reengajamento. */
  async enqueueNudgeIfDue(userId: string): Promise<void> {
    if (!(await this.healthConsent.hasActiveForUser(userId))) return;
    const cutoff = new Date(Date.now() - TWO_WEEKS_MS);
    const [last] = await this.db.runAsSystem((tx) =>
      tx
        .select({ sentAt: checkins.sentAt, respondedAt: checkins.respondedAt })
        .from(checkins)
        .where(eq(checkins.userId, userId))
        .orderBy(desc(checkins.sentAt))
        .limit(1),
    );
    const windowStartedAt = last?.respondedAt ?? last?.sentAt;
    if (!windowStartedAt || windowStartedAt > cutoff) return;
    await this.queues.enqueue(
      QUEUE.checkinWeekly,
      'checkin-reengagement',
      {
        kind: 'NUDGE',
        userId,
        windowStartedAt: windowStartedAt.toISOString(),
      } satisfies CheckinJob,
      { jobId: `checkin-nudge-${userId}-${windowStartedAt.getTime()}` },
    );
  }

  private async sendNudge(
    userId: string,
    windowStartedAt: Date,
  ): Promise<'SENT' | 'EXISTS' | 'NO_CONSENT'> {
    if (!(await this.healthConsent.hasActiveForUser(userId))) return 'NO_CONSENT';
    const created = await this.db.runAsSystem(async (tx) => {
      const [row] = await tx
        .insert(reengagementNudges)
        .values({ userId, windowStartedAt })
        .onConflictDoNothing()
        .returning({ id: reengagementNudges.id });
      return row;
    });
    if (!created) return 'EXISTS';
    const outbound: WhatsappOutboundJob = {
      userId,
      type: 'REENGAGEMENT',
      dedupeId: created.id,
      text: 'Seu movimento pode recomecar no seu ritmo. Quer fazer um check-in agora? O profissional CREF da MOVIVO acompanha as respostas.',
      buttons: [{ id: 'checkin:anticipated', title: 'Fazer check-in' }],
    };
    await this.queues.enqueue(QUEUE.whatsappOutbound, 'checkin-reengagement', outbound, {
      jobId: `wa-nudge-${created.id}`,
    });
    await this.db.runAsSystem((tx) =>
      tx
        .update(reengagementNudges)
        .set({ sentAt: new Date() })
        .where(eq(reengagementNudges.id, created.id)),
    );
    this.logger.info({ event: 'reengagement_sent', userId }, 'reengajamento enfileirado');
    return 'SENT';
  }

  private delayWithinTwoHours(userId: string, weekNumber: number): number {
    const digest = createHash('sha256').update(`${userId}:${weekNumber}`).digest();
    return digest.readUInt32BE(0) % (2 * 60 * 60 * 1000);
  }
}
