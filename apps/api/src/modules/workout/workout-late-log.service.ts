/**
 * `WorkoutLateLogService` — registro tardio: o aluno treinou e não conseguiu registrar na hora.
 *
 * O diário só aceita "Iniciar" no dia atual (o cronômetro mede o treino de agora). Quem treinou
 * ontem e abriu o link depois ficava sem como registrar, e o dia virava "sem registro". Aqui o
 * aluno pede ao Coach (ou toca em "Registrar" num dia recente) e ganha o treino daquele dia
 * aberto para preenchimento, SEM cronômetro, dentro de `LATE_LOG_WINDOW_DAYS` dias.
 *
 * ## O calendário concorda com o histórico
 * Se o aluno fez uma sessão diferente da prevista para o dia (ou treinou num dia de descanso),
 * o planejador leva essa sessão para a data em que ela foi feita e libera o dia em que estava
 * (o mesmo movimento de `TRAIN_ON`, só que para trás). Se a semana já não comporta esse
 * movimento (a sessão já foi feita, por exemplo), o treino é registrado mesmo assim: o que o
 * aluno viveu vale mais que o plano.
 */
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import { workoutSessions } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import {
  addDays,
  effectiveSessionForDate,
  LATE_LOG_WINDOW_DAYS,
  type PlanSuccess,
  planScheduleChange,
} from './schedule-planner';
import { WorkoutJournalService } from './workout-journal.service';
import { WorkoutScheduleService } from './workout-schedule.service';

export interface LateLogOption {
  key: string;
  focus: string;
}

export type LateLogResult =
  | {
      status: 'READY';
      workoutId: string;
      date: string;
      sessionKey: string;
      /** Foco da sessão ("Costas e Bíceps"). */
      focus: string;
    }
  | { status: 'OUT_OF_WINDOW' }
  | { status: 'ALREADY_LOGGED'; focus: string }
  /** O dia não tinha treino previsto: o aluno precisa dizer qual fez. */
  | { status: 'NEEDS_SESSION'; options: LateLogOption[] }
  | { status: 'UNKNOWN_SESSION'; options: LateLogOption[] }
  | { status: 'NO_PROTOCOL' };

@Injectable()
export class WorkoutLateLogService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly schedule: WorkoutScheduleService,
    private readonly journal: WorkoutJournalService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WorkoutLateLogService.name);
  }

  async begin(
    userId: string,
    input: { date: string; sessionKey?: string },
    now = new Date(),
  ): Promise<LateLogResult> {
    const ctx = await this.schedule.weekContext(userId, now, input.date);
    if (!ctx) return { status: 'NO_PROTOCOL' };

    const earliest = addDays(ctx.today, -LATE_LOG_WINDOW_DAYS);
    if (input.date >= ctx.today || input.date < earliest || input.date < ctx.firstProtocolDate) {
      return { status: 'OUT_OF_WINDOW' };
    }
    const options = ctx.structure.sessions.map((session) => ({
      key: session.dayLabel,
      focus: session.focus,
    }));

    const [existing] = await this.db.runAsSystem((tx) =>
      tx
        .select({
          id: workoutSessions.id,
          status: workoutSessions.status,
          sessionKey: workoutSessions.sessionKey,
          prescription: workoutSessions.prescription,
        })
        .from(workoutSessions)
        .where(
          and(eq(workoutSessions.userId, userId), eq(workoutSessions.scheduledDate, input.date)),
        )
        .limit(1),
    );
    if (existing?.status === 'COMPLETED') {
      return { status: 'ALREADY_LOGGED', focus: existing.prescription.focus };
    }
    if (existing?.status === 'IN_PROGRESS') {
      return {
        status: 'READY',
        workoutId: existing.id,
        date: input.date,
        sessionKey: existing.sessionKey,
        focus: existing.prescription.focus,
      };
    }

    // No dia da ENTREGA do protocolo o planejador trava o slot (não é "falta" nem treino a
    // remarcar), mas o diário abre o treino previsto daquele dia: o registro tardio usa o
    // calendário efetivo, senão perguntaria "qual treino?" havendo treino previsto.
    const effectiveKey =
      input.date === ctx.firstProtocolDate
        ? (effectiveSessionForDate(input.date, ctx.structure, ctx.overrides)?.dayLabel ?? null)
        : (ctx.slots.find((slot) => slot.date === input.date)?.sessionKey ?? null);
    const chosen = input.sessionKey ?? effectiveKey;
    if (!chosen) return { status: 'NEEDS_SESSION', options };
    if (!options.some((option) => option.key === chosen)) {
      return { status: 'UNKNOWN_SESSION', options };
    }

    if (chosen !== effectiveKey) {
      const planned = planScheduleChange({
        today: ctx.today,
        earliestDate: earliest,
        slots: ctx.slots,
        quota: ctx.quota,
        sessionKeys: options.map((option) => option.key),
        request: { kind: 'TRAIN_ON', date: input.date, sessionKey: chosen },
      });
      const plan: PlanSuccess =
        planned.ok && !planned.noop
          ? planned
          : {
              ok: true,
              noop: false,
              changes: [{ date: input.date, from: effectiveKey, to: chosen }],
              dropped: [],
              slots: ctx.slots,
            };
      await this.schedule.apply(userId, ctx, plan, { kind: 'LATE_LOG', source: 'LATE_LOG' });
    }

    // O diário cria o treino do dia com a prescrição vigente NAQUELA data e o calendário já ajustado.
    const view = await this.journal.journal(userId, input.date, now);
    if (!view.workout) return { status: 'NO_PROTOCOL' };
    await this.journal.startLate(userId, view.workout.id, now);
    this.logger.info(
      { event: 'late_log_opened', userId, date: input.date },
      'registro tardio aberto',
    );
    return {
      status: 'READY',
      workoutId: view.workout.id,
      date: input.date,
      sessionKey: view.workout.prescription.dayLabel,
      focus: view.workout.prescription.focus,
    };
  }
}
