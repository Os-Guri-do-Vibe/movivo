/**
 * Cuidado do ciclo menstrual: lembretes e recomendações de autocuidado ao longo do ciclo, para
 * quem autorizou o acompanhamento (`AUTORIZO CICLO`).
 *
 *   datas registradas → previsão por calendário (código) → marco do dia (janela fértil estimada,
 *   fase em que a TPM é mais comum, menstruação chegando, menstruação que parece atrasada) →
 *   a especialista em saúde da mulher escreve, na voz da persona → WhatsApp.
 *
 * Um lembrete por marco e por ciclo (marca no Redis) e, como todo contato que a MOVIVO inicia,
 * no máximo um por dia (porteiro compartilhado): se o dia já foi usado, o lembrete sai no dia
 * seguinte, enquanto a janela do marco estiver aberta. Sem a autorização do ciclo ou sem
 * consentimento de saúde não há leitura do ciclo e nada é enviado.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { personaOf } from '@movivo/shared';

import { AgentRunner, AgentTaskError } from '../../core/agents/agent-runner';
import { scheduledSessions } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';
import { ConversationStore } from '../conversation/conversation-store';
import { PublishedMethodologyReader } from '../methodology/published-methodology.reader';
import { todayIn } from '../planning/plan-generation.service';
import {
  cycleForecast,
  dueCycleCareEvents,
  type CycleCareEvent,
  type CycleView,
} from '../student-state/menstrual-cycle';
import { OutreachService } from '../student-state/outreach.service';
import { StudentStateReader } from '../student-state/student-state.reader';
import { AgentMessenger } from './agent-messenger';
import { cycleCareTask, FERTILE_WINDOW_DISCLAIMER } from './cycle-care-tasks';

/** Um ciclo dura até 45 dias: a marca do marco precisa sobreviver a ele. */
const MARKER_TTL_SECONDS = 60 * 86_400;

export type CycleCareResult =
  | { status: 'SENT'; event: CycleCareEvent }
  | { status: 'NOTHING_TO_DO' }
  | { status: 'SKIPPED'; reason: 'NO_CYCLE' | 'OTHER_CONTACT_TODAY' | 'NO_MESSAGE' };

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

@Injectable()
export class CycleCareService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly runner: AgentRunner,
    private readonly state: StudentStateReader,
    private readonly methodology: PublishedMethodologyReader,
    private readonly store: ConversationStore,
    private readonly messenger: AgentMessenger,
    private readonly outreach: OutreachService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CycleCareService.name);
  }

  async run(userId: string, now: Date = new Date()): Promise<CycleCareResult> {
    const { firstName, timezone } = await this.store.loadUser(userId);
    const today = todayIn(timezone, now);
    // A fatia `cycle` só vem com consentimento de saúde E autorização do ciclo vigentes.
    const read = await this.state.read(userId, ['cycle', 'identity'], now);
    const view = (read.slices.cycle ?? null) as CycleView | null;
    if (!view) return { status: 'SKIPPED', reason: 'NO_CYCLE' };

    let event: CycleCareEvent | null = null;
    for (const due of dueCycleCareEvents(view, today)) {
      if ((await this.redis.exists(this.marker(userId, due, view.lastStart))) === 0) {
        event = due;
        break;
      }
    }
    if (!event) return { status: 'NOTHING_TO_DO' };
    if (!(await this.outreach.tryAcquireToday(userId, today))) {
      return { status: 'SKIPPED', reason: 'OTHER_CONTACT_TODAY' };
    }

    const forecast = cycleForecast(view, today);
    const sex = (read.slices.identity as { biologicalSex?: string | null } | undefined)
      ?.biologicalSex;
    let messages: string[];
    try {
      const run = await this.runner.run(
        cycleCareTask,
        {
          event,
          firstName,
          cycleDay: Math.max(1, Math.min(120, view.cycleDay)),
          typicalLength: view.typicalLength,
          cyclesLogged: Math.max(1, view.cyclesLogged),
          expectedPeriodOn: ddmm(forecast.nextStart),
          daysUntilPeriod: forecast.daysUntilNext,
          fertileWindow:
            event === 'FERTILE_WINDOW'
              ? { from: ddmm(forecast.fertileFrom), to: ddmm(forecast.fertileTo) }
              : null,
          trainingToday: await this.trainsToday(userId, today),
        },
        {
          userId,
          sources: {
            methodology: (domains) => this.methodology.render(domains),
            state: (slices) => this.state.read(userId, slices, now),
          },
          persona: personaOf(sex),
        },
      );
      messages = [...run.output.messages];
    } catch (error) {
      if (!(error instanceof AgentTaskError)) throw error;
      // Sem texto válido não se manda nada: o dia fica livre e o marco tenta de novo amanhã.
      await this.outreach.release(userId, today);
      this.logger.warn({ userId, event, taskId: error.taskId }, 'lembrete do ciclo sem texto');
      return { status: 'SKIPPED', reason: 'NO_MESSAGE' };
    }
    if (event === 'FERTILE_WINDOW') messages.push(FERTILE_WINDOW_DISCLAIMER);

    await this.messenger.send(userId, messages, `cycle_${event}_${view.lastStart}`);
    await this.redis.set(this.marker(userId, event, view.lastStart), '1', 'EX', MARKER_TTL_SECONDS);
    await this.outreach.record(userId, 'CYCLE_CARE', { strategy: event });
    this.logger.info(
      { userId, event: 'cycle_care_sent', kind: event },
      'lembrete do ciclo enviado',
    );
    return { status: 'SENT', event };
  }

  private marker(userId: string, event: CycleCareEvent, lastStart: string): string {
    return this.keys.forUser(userId, 'cycle-care', event, lastStart);
  }

  private async trainsToday(userId: string, today: string): Promise<boolean> {
    const rows = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({ id: scheduledSessions.id })
        .from(scheduledSessions)
        .where(
          and(
            eq(scheduledSessions.userId, userId),
            eq(scheduledSessions.scheduledOn, today),
            eq(scheduledSessions.status, 'PLANNED'),
          ),
        )
        .limit(1),
    );
    return rows.length > 0;
  }
}
