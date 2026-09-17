/**
 * `CheckinScheduler` — dispara o check-in semanal.
 *
 * Achado 2026-09-13 (pedido do fundador): domingo 18h no fuso LOCAL de cada aluno, em vez
 * do antigo cron fixo de segunda 08h no fuso único do servidor (`America/Sao_Paulo`) —
 * mesmo desenho de `WorkoutScheduler.scan()`: scan a cada minuto em UTC, compara contra um
 * horário fixo já convertido para o fuso do aluno (`users.timezone`). O jitter artificial
 * de até 2h (`delayWithinTwoHours`) deixou de existir — o disparo já nasce espalhado, cada
 * aluno no seu próprio horário exato.
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { CONSENT_TEXTS } from '@movivo/shared';

import { consents, protocols, subscriptions, users } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkerFactory } from '../jobs/worker.factory';
import { CheckinService } from './checkin.service';

type CheckinJob = { kind: 'SCAN' } | { kind: 'NUDGE'; userId: string; windowStartedAt: string };

const SCAN_CRON = '* * * * *';
const FIXED_CHECKIN_TIME = '18:00';
const SUNDAY = 'Sun';
const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

function localParts(
  now: Date,
  timezone: string,
): { date: string; time: string; weekday: string } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    }).formatToParts(now);
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
      date: `${value.year}-${value.month}-${value.day}`,
      time: `${value.hour}:${value.minute}`,
      weekday: value.weekday ?? '',
    };
  } catch {
    return null;
  }
}

@Injectable()
export class CheckinScheduler implements OnModuleInit {
  constructor(
    private readonly workers: WorkerFactory,
    private readonly queues: QueueManager,
    private readonly db: TenantDatabase,
    private readonly checkinsService: CheckinService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CheckinScheduler.name);
  }

  async onModuleInit(): Promise<void> {
    this.workers.create<CheckinJob>(QUEUE.checkinWeekly, async (job) => {
      if (job.data.kind === 'SCAN') return this.scan();
      return this.sendNudge(job.data.userId, new Date(job.data.windowStartedAt));
    });

    await this.queues
      .get(QUEUE.checkinWeekly)
      .upsertJobScheduler(
        'weekly-checkin-scan',
        { pattern: SCAN_CRON, tz: 'UTC' },
        { name: 'weekly-checkin-scan', data: { kind: 'SCAN' } satisfies CheckinJob },
      );
  }

  async scan(now = new Date()): Promise<{ status: string; eligible: number; sent: number }> {
    const eligible = await this.db.runAsSystem((tx) =>
      tx
        .selectDistinct({
          userId: protocols.userId,
          name: users.name,
          timezone: users.timezone,
          protocolId: protocols.id,
          createdAt: protocols.createdAt,
          totalWeeks: protocols.totalWeeks,
        })
        .from(protocols)
        .innerJoin(users, eq(users.id, protocols.userId))
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
        .where(
          and(
            eq(protocols.status, 'ACTIVE'),
            inArray(subscriptions.status, ['ACTIVE', 'TRIALING']),
          ),
        ),
    );

    let sent = 0;
    for (const row of eligible) {
      const local = localParts(now, row.timezone);
      if (!local || local.weekday !== SUNDAY || local.time !== FIXED_CHECKIN_TIME) continue;
      const weekNumber = this.checkinsService.weekNumber(row.createdAt, row.totalWeeks);
      const firstName = row.name?.trim().split(/\s+/)[0] ?? null;
      const result = await this.checkinsService.createAndSend(
        row.userId,
        row.protocolId,
        weekNumber,
        firstName,
      );
      if (result === 'SENT') sent += 1;
      await this.enqueueNudgeIfDue(row.userId);
    }
    this.logger.info(
      { event: 'checkin_scan_completed', eligible: eligible.length, sent },
      'scan semanal concluído',
    );
    return { status: 'SCANNED', eligible: eligible.length, sent };
  }

  /** @internal Público apenas para teste determinístico da janela de reengajamento. */
  async enqueueNudgeIfDue(userId: string): Promise<void> {
    const cutoff = new Date(Date.now() - TWO_WEEKS_MS);
    const windowStartedAt = await this.checkinsService.lastSentOrRespondedAt(userId);
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

  /**
   * Reengajamento (14 dias sem resposta): reenvia o MESMO check-in `PENDING` da semana
   * corrente com um token novo (`CheckinService.createAndSend` já cuida da rotação), como
   * mensagem simples — sem botão, já que o fluxo inteiro virou link (achado 2026-09-13).
   */
  private async sendNudge(
    userId: string,
    _windowStartedAt: Date,
  ): Promise<'SENT' | 'EXISTS' | 'NO_CONSENT' | 'NO_ACTIVE_PROTOCOL'> {
    const [eligible] = await this.db.runAsSystem((tx) =>
      tx
        .select({
          userId: protocols.userId,
          name: users.name,
          protocolId: protocols.id,
          createdAt: protocols.createdAt,
          totalWeeks: protocols.totalWeeks,
        })
        .from(protocols)
        .innerJoin(users, eq(users.id, protocols.userId))
        .innerJoin(subscriptions, eq(subscriptions.userId, protocols.userId))
        .where(
          and(
            eq(protocols.userId, userId),
            eq(protocols.status, 'ACTIVE'),
            inArray(subscriptions.status, ['ACTIVE', 'TRIALING']),
          ),
        )
        .limit(1),
    );
    if (!eligible) return 'NO_ACTIVE_PROTOCOL';
    const weekNumber = this.checkinsService.weekNumber(eligible.createdAt, eligible.totalWeeks);
    const firstName = eligible.name?.trim().split(/\s+/)[0] ?? null;
    return this.checkinsService.createAndSend(
      userId,
      eligible.protocolId,
      weekNumber,
      firstName,
      'NUDGE',
    );
  }
}
