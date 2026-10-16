import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { AppConfigService } from '../../core/config';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';
import { FollowupService } from '../followup/followup.service';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import type { WhatsappOutboundJob } from '../jobs/whatsapp-outbound.contract';
import { WorkerFactory } from '../jobs/worker.factory';
import { ShortLinkService } from '../short-link/short-link.service';
import { AttendanceAlertService } from './attendance-alert.service';
import { MissedWorkoutAskPolicy } from './missed-workout-ask.policy';
import { MAGIC_TTL_MS, WorkoutAccessService } from './workout-access.service';
import {
  type EligibleStudent,
  firstNameOf,
  loadEligibleStudents,
  localParts,
} from './workout-eligibility';
import { WorkoutJournalService } from './workout-journal.service';
import { dailyWorkoutMessage, greetingFor } from './workout-messages';

/** `force`: execução manual pelo painel "Sistema → Scripts" — ignora a janela das 04:00. */
type WorkoutJob = { kind: 'SCAN'; force?: boolean };
const SCAN_CRON = '* * * * *';

/**
 * Achado 2026-09-10 (pedido do fundador): o link diário deixou de ter horário configurável
 * por aluno (a feature de chat que deixava pedir "me manda às 16h" foi removida, junto com a
 * intenção `AJUSTE_LEMBRETE_TREINO` — ver `AIResponseWorker`). Todo mundo recebe no mesmo
 * horário, 04:00 no fuso LOCAL de cada aluno (`users.timezone`, que continua necessário —
 * "04:00 fixo" nunca significou 04:00 UTC). `users.workoutReminderTime` fica órfã a partir
 * daqui: ninguém mais escreve nela, e o scan não lê mais essa coluna.
 *
 * Achado 2026-10-13 (decisão do fundador): o link NÃO é opcional. É o instrumento de
 * acompanhamento da MOVIVO (exercícios, carga, PSE, dor, feedback) e a resposta "treinou ou
 * não". A opção de o aluno deixar de recebê-lo (`workoutReminderEnabled`) foi removida de
 * ponta a ponta: schema, endpoint de preferências e coluna do banco.
 */
const FIXED_WORKOUT_REMINDER_TIME = '04:00';

/** A decisão do dia (link com ou sem a pergunta) é lembrada: vale a primeira, mesmo num "forçar". */
const DECIDED_MARKER_TTL_SECONDS = 48 * 3_600;

@Injectable()
export class WorkoutScheduler implements OnModuleInit {
  constructor(
    private readonly workers: WorkerFactory,
    private readonly queues: QueueManager,
    private readonly db: TenantDatabase,
    private readonly access: WorkoutAccessService,
    private readonly journal: WorkoutJournalService,
    private readonly shortLinks: ShortLinkService,
    private readonly config: AppConfigService,
    private readonly followups: FollowupService,
    private readonly askPolicy: MissedWorkoutAskPolicy,
    private readonly attendanceAlerts: AttendanceAlertService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WorkoutScheduler.name);
  }

  async onModuleInit(): Promise<void> {
    this.workers.create<WorkoutJob>(QUEUE.workoutDaily, async (job) =>
      this.scan(new Date(), { force: job.data.force === true }),
    );
    await this.queues
      .get(QUEUE.workoutDaily)
      .upsertJobScheduler(
        'daily-workout-scan',
        { pattern: SCAN_CRON, tz: 'UTC' },
        { name: 'daily-workout-scan', data: { kind: 'SCAN' } satisfies WorkoutJob },
      );
  }

  /**
   * `force` pula só o portão de horário (04:00 local). A idempotência segue valendo: o
   * `dedupeId`/`jobId` do envio levam a data local, e a decisão do dia (com ou sem a pergunta
   * sobre o treino sem registro) fica registrada, então quem já foi atendido hoje não recebe de
   * novo nem muda de decisão.
   */
  async scan(
    now = new Date(),
    options: { force?: boolean } = {},
  ): Promise<{ status: string; eligible: number; sent: number; asked: number; alerted: number }> {
    if (now.getUTCMinutes() === 0) await this.sweepFollowups(now);
    const eligible = await loadEligibleStudents(this.db);

    let sent = 0;
    let asked = 0;
    let alerted = 0;
    let failed = 0;
    for (const row of eligible) {
      const local = localParts(now, row.timezone);
      if (!local) continue;
      if (!options.force && local.time !== FIXED_WORKOUT_REMINDER_TIME) continue;
      // Alerta de frequência para o profissional CREF: independe de hoje haver treino.
      if (await this.checkAttendance(row.userId, local.date, now)) alerted += 1;
      try {
        const outcome = await this.sendDailyLink(row, local.date, now, local.time);
        if (outcome.sent) sent += 1;
        if (outcome.asked) asked += 1;
      } catch (err: unknown) {
        // Um aluno com problema não pode impedir o link dos demais.
        failed += 1;
        this.logger.warn(
          { event: 'workout_scan_user_failed', userId: row.userId, err },
          'falha ao enviar o link do dia; segue com os demais e tenta de novo no retry',
        );
      }
    }
    this.logger.info(
      { event: 'workout_scan_completed', eligible: eligible.length, sent, asked, alerted, failed },
      'scan de links diarios de treino concluido',
    );
    // O retry do BullMQ reexecuta a varredura: quem já foi atendido é pulado pela marca do dia.
    if (failed > 0) throw new Error(`${failed} aluno(s) sem o link do dia nesta varredura`);
    return { status: 'SCANNED', eligible: eligible.length, sent, asked, alerted };
  }

  /**
   * UMA mensagem por aluno por dia: o link do treino, com a pergunta sobre o último treino sem
   * registro quando as guardas de `decideAsk` permitem. A pergunta nunca bloqueia o link:
   * qualquer erro ao decidi-la, ou uma reserva que já não pode ser enviada, resulta no link
   * simples. Dia sem treino previsto hoje não gera mensagem nenhuma (nem pergunta).
   */
  private async sendDailyLink(
    row: EligibleStudent,
    date: string,
    now: Date,
    localTime: string,
  ): Promise<{ sent: boolean; asked: boolean }> {
    const decidedKey = this.keys.forUser(row.userId, 'workout-daily', 'decided', date);
    if ((await this.redis.exists(decidedKey)) === 1) return { sent: false, asked: false };

    const view = await this.journal.journal(row.userId, date, now);
    if (!view.workout) return { sent: false, asked: false };

    const magicLink = await this.access.createMagicLink(row.userId, view.workout.id);
    const code = await this.shortLinks.create(magicLink, new Date(Date.now() + MAGIC_TTL_MS));
    const link = `${this.config.whatsapp.publicSiteUrl}/check-in/${code}`;
    const firstName = firstNameOf(row.name);
    // O aluno reconhece o FOCO ("Costas e Bíceps"); `dayLabel` é rótulo interno ("Dia A").
    const focusToday = view.workout.prescription.focus;
    const greeting = greetingFor(localTime);
    const plainText = dailyWorkoutMessage(firstName, focusToday, link, undefined, greeting);

    let text = plainText;
    let followupId: string | undefined;
    const decision = await this.askPolicy
      .decide(row.userId, date, row.timezone, now)
      .catch((err: unknown) => {
        this.logger.warn(
          { event: 'workout_missed_ask_decision_failed', userId: row.userId, err },
          'decisão da pergunta falhou; o link segue sem ela',
        );
        return null;
      });
    if (decision?.kind === 'ASK') {
      const { subject } = decision;
      const reservation = await this.followups.reserve(
        row.userId,
        {
          kind: 'MISSED_WORKOUT',
          subjectDate: subject.subjectDate,
          sessionKey: subject.sessionKey,
          workoutSessionId: subject.workoutSessionId,
          protocolId: subject.protocolId,
          topicLabel: subject.focus,
        },
        now,
      );
      // `PENDING_SEND` também no retry de uma execução que caiu entre a reserva e o envio.
      if (reservation.status === 'PENDING_SEND') {
        followupId = reservation.id;
        text = dailyWorkoutMessage(
          firstName,
          focusToday,
          link,
          {
            focus: subject.focus,
            when: subject.when,
            seed: subject.subjectDate,
          },
          greeting,
        );
      }
    }

    const outbound: WhatsappOutboundJob = {
      userId: row.userId,
      type: 'WORKOUT_DAILY_LINK',
      dedupeId: `workout-link-${date}`,
      text,
      ...(followupId ? { followupId, fallbackText: plainText } : {}),
    };
    await this.queues.enqueue(QUEUE.whatsappOutbound, 'workout-daily-link', outbound, {
      jobId: `wa-workout-link-${row.userId}-${date}`,
    });
    await this.redis.set(decidedKey, '1', 'EX', DECIDED_MARKER_TTL_SECONDS);
    return { sent: true, asked: Boolean(followupId) };
  }

  /**
   * Abre o alerta de frequência para o profissional CREF quando cabe. Nunca interrompe o envio
   * dos links: um erro aqui só é registrado, e a varredura do dia seguinte tenta de novo.
   */
  private async checkAttendance(userId: string, date: string, now: Date): Promise<boolean> {
    try {
      return (await this.attendanceAlerts.check(userId, date, now)) !== null;
    } catch (err: unknown) {
      this.logger.warn(
        { event: 'attendance_alert_failed', userId, err },
        'não foi possível avaliar a frequência do aluno; o link segue normalmente',
      );
      return false;
    }
  }

  /** Materializa a expiração das pendências para métrica; nunca atrapalha o envio dos links. */
  private async sweepFollowups(now: Date): Promise<void> {
    try {
      await this.followups.sweep(now);
    } catch (err: unknown) {
      this.logger.warn(
        { event: 'followup_sweep_failed', err },
        'varredura de pendências de conversa falhou',
      );
    }
  }
}
