import { Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { CONSENT_TEXTS } from '@movivo/shared';

import { consents, protocols, subscriptions, users } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import type { WhatsappOutboundJob } from '../jobs/whatsapp-outbound.contract';
import { WorkerFactory } from '../jobs/worker.factory';
import { WorkoutAccessService } from './workout-access.service';
import { WorkoutJournalService } from './workout-journal.service';
import { dailyWorkoutMessage } from './workout-messages';

type WorkoutJob = { kind: 'SCAN' };
const SCAN_CRON = '* * * * *';

function localParts(now: Date, timezone: string): { date: string; time: string } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
      date: `${value.year}-${value.month}-${value.day}`,
      time: `${value.hour}:${value.minute}`,
    };
  } catch {
    return null;
  }
}

@Injectable()
export class WorkoutScheduler implements OnModuleInit {
  constructor(
    private readonly workers: WorkerFactory,
    private readonly queues: QueueManager,
    private readonly db: TenantDatabase,
    private readonly access: WorkoutAccessService,
    private readonly journal: WorkoutJournalService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WorkoutScheduler.name);
  }

  async onModuleInit(): Promise<void> {
    this.workers.create<WorkoutJob>(QUEUE.workoutDaily, async () => this.scan());
    await this.queues
      .get(QUEUE.workoutDaily)
      .upsertJobScheduler(
        'daily-workout-scan',
        { pattern: SCAN_CRON, tz: 'UTC' },
        { name: 'daily-workout-scan', data: { kind: 'SCAN' } satisfies WorkoutJob },
      );
  }

  async scan(now = new Date()): Promise<{ status: string; eligible: number; sent: number }> {
    const eligible = await this.db.runAsSystem((tx) =>
      tx
        .selectDistinct({
          userId: protocols.userId,
          name: users.name,
          timezone: users.timezone,
          reminderTime: users.workoutReminderTime,
          reminderEnabled: users.workoutReminderEnabled,
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
        .where(and(eq(protocols.status, 'ACTIVE'), eq(subscriptions.status, 'ACTIVE'))),
    );

    let sent = 0;
    for (const row of eligible) {
      if (!row.reminderEnabled) continue;
      const local = localParts(now, row.timezone);
      if (!local || local.time !== row.reminderTime) continue;
      const view = await this.journal.journal(row.userId, local.date, now);
      if (!view.workout) continue;
      const link = await this.access.createMagicLink(row.userId, view.workout.id);
      const outbound: WhatsappOutboundJob = {
        userId: row.userId,
        type: 'WORKOUT_DAILY_LINK',
        dedupeId: `workout-link-${local.date}`,
        text: dailyWorkoutMessage(row.name?.trim().split(/\s+/)[0] || 'atleta', link),
      };
      await this.queues.enqueue(QUEUE.whatsappOutbound, 'workout-daily-link', outbound, {
        jobId: `wa-workout-link-${row.userId}-${local.date}`,
      });
      sent += 1;
    }
    this.logger.info(
      { event: 'workout_scan_completed', eligible: eligible.length, sent },
      'scan de links diarios de treino concluido',
    );
    return { status: 'SCANNED', eligible: eligible.length, sent };
  }
}
