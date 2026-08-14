/**
 * Quick reply diário de treino (US-8.1 / TASK-8.1.3).
 *
 * Um scan por dia às 20h `America/Sao_Paulo` varre quem tem protocolo `ACTIVE`,
 * assinatura `ACTIVE` e consentimento de saúde vigente — a **mesma** elegibilidade do
 * `CheckinScheduler.scan()` — e, se hoje for dia de treino previsto pelo protocolo,
 * enfileira UMA mensagem com dois botões.
 *
 * ponytail: horário fixo às 20h para todo aluno, sem preferência individual. Derivar o
 * horário do padrão de conversa do aluno (o que a US sugere como refinamento) exigiria
 * agregar `conversations` por titular a cada scan para mover a mensagem em algumas horas.
 * Quando houver evidência de que o horário muda a taxa de resposta, trocar `SCAN_CRON`
 * por um delay por aluno — nada mais neste arquivo muda.
 *
 * **Sem reenvio no mesmo dia:** o `jobId` do outbound é `wa-workout-<userId>-<dia>`.
 * BullMQ descarta o duplicado, então um scan que rode duas vezes (retry, failover,
 * deploy no meio da janela) não gera segunda mensagem. Mesmo mecanismo do check-in.
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { CONSENT_TEXTS, protocolStructureSchema } from '@movivo/shared';

import { consents, protocols, subscriptions } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import type { WhatsappOutboundJob } from '../jobs/whatsapp-outbound.contract';
import { WorkerFactory } from '../jobs/worker.factory';
import { WORKOUT_QUICK_REPLY_TEXT, workoutButtons } from './workout-messages';
import { dayKey, sessionKeyFor } from './workout-schedule';

type WorkoutJob = { kind: 'SCAN' };

const SCAN_CRON = '0 20 * * *';

@Injectable()
export class WorkoutScheduler implements OnModuleInit {
  constructor(
    private readonly workers: WorkerFactory,
    private readonly queues: QueueManager,
    private readonly db: TenantDatabase,
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
        { pattern: SCAN_CRON, tz: 'America/Sao_Paulo' },
        { name: 'daily-workout-scan', data: { kind: 'SCAN' } satisfies WorkoutJob },
      );
  }

  async scan(now = new Date()): Promise<{ status: string; eligible: number; sent: number }> {
    const eligible = await this.db.runAsSystem((tx) =>
      tx
        .selectDistinct({
          userId: protocols.userId,
          content: protocols.content,
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

    const completedAt = dayKey(now);
    let sent = 0;
    for (const row of eligible) {
      const structure = protocolStructureSchema.safeParse(row.content);
      if (!structure.success) continue;
      const sessionKey = sessionKeyFor(now, structure.data);
      if (!sessionKey) continue; // hoje não é dia de treino previsto para este aluno

      const outbound: WhatsappOutboundJob = {
        userId: row.userId,
        type: 'WORKOUT_QUICK_REPLY',
        dedupeId: `workout-${completedAt}`,
        text: WORKOUT_QUICK_REPLY_TEXT,
        buttons: workoutButtons(completedAt, sessionKey),
      };
      await this.queues.enqueue(QUEUE.whatsappOutbound, 'workout-quick-reply', outbound, {
        jobId: `wa-workout-${row.userId}-${completedAt}`,
      });
      sent += 1;
    }
    this.logger.info(
      { event: 'workout_scan_completed', eligible: eligible.length, sent, completedAt },
      'scan diario de treino concluido',
    );
    return { status: 'SCANNED', eligible: eligible.length, sent };
  }
}
