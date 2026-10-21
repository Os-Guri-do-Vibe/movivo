/**
 * `WorkoutLinkDispatcherService` — o único lugar que cria o link do check-in diário FORA da
 * varredura das 04:00 (`WorkoutScheduler`).
 *
 * Três situações passam por aqui, todas reação a uma ação do aluno (por isso não aumentam o
 * volume de mensagens proativas do canal):
 *  - `ON_DEMAND`: o aluno pediu para treinar num dia livre e o Coach reorganizou a semana;
 *  - `REFRESH`: a prescrição de hoje mudou depois do link das 04:00 (troca de exercício
 *    aprovada) e o aluno aceitou receber o link novo;
 *  - `RESEND`: o aluno pediu o link de novo.
 *
 * Em todas: cria (ou recria) a sessão do dia com a prescrição vigente, REVOGA os links ainda não
 * usados e gera um novo, com a saudação do horário LOCAL do aluno. Marca o dia como decidido
 * (a varredura das 04:00 não reenvia) — a mesma marca que `WorkoutScheduler` usa.
 *
 * `prepare` devolve o balão pronto para o chamador anexar à resposta do Coach (a mensagem sai
 * na ordem certa, depois do texto); `send` enfileira direto, para quem não tem resposta própria.
 */
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { AppConfigService } from '../../core/config';
import { users } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import type { WhatsappOutboundJob } from '../jobs/whatsapp-outbound.contract';
import { ShortLinkService } from '../short-link/short-link.service';
import { MAGIC_TTL_MS, WorkoutAccessService } from './workout-access.service';
import { firstNameOf, localParts, previousDay, shortWeekdayName } from './workout-eligibility';
import { WorkoutJournalService } from './workout-journal.service';
import {
  greetingFor,
  lateLogLinkMessage,
  onDemandWorkoutMessage,
  refreshedWorkoutMessage,
  resentTodayWorkoutMessage,
} from './workout-messages';

export type LinkReason = 'ON_DEMAND' | 'REFRESH' | 'RESEND';

export type PreparedLink =
  | {
      status: 'READY';
      /** Balão pronto, com a saudação do horário local. */
      text: string;
      workoutId: string;
      /** Foco da sessão ("Costas e Bíceps"), o nome que o aluno reconhece. */
      focus: string;
      sessionKey: string;
      workoutStatus: 'PLANNED' | 'IN_PROGRESS';
    }
  | { status: 'NO_WORKOUT_TODAY' }
  | { status: 'ALREADY_DONE'; focus: string }
  /** Só em `REFRESH`: o aluno já começou o treino, a atualização vale a partir do próximo. */
  | { status: 'ALREADY_STARTED' }
  | { status: 'NO_PROTOCOL' }
  /** Reenvio repetido em poucos segundos: o link acabou de sair. */
  | { status: 'THROTTLED' };

const DEFAULT_TIMEZONE = 'America/Sao_Paulo';
/** A decisão do dia vale 48h (mesmo TTL da marca do `WorkoutScheduler`). */
const DECIDED_MARKER_TTL_SECONDS = 48 * 3_600;
/** Intervalo mínimo entre dois reenvios a pedido: o suficiente para barrar toques repetidos. */
const RESEND_COOLDOWN_SECONDS = 60;

@Injectable()
export class WorkoutLinkDispatcherService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly journal: WorkoutJournalService,
    private readonly access: WorkoutAccessService,
    private readonly shortLinks: ShortLinkService,
    private readonly queues: QueueManager,
    private readonly config: AppConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WorkoutLinkDispatcherService.name);
  }

  async prepare(userId: string, reason: LinkReason, now = new Date()): Promise<PreparedLink> {
    const [student] = await this.db.runAsSystem((tx) =>
      tx
        .select({ name: users.name, timezone: users.timezone })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1),
    );
    if (!student) return { status: 'NO_PROTOCOL' };
    const local =
      localParts(now, student.timezone || DEFAULT_TIMEZONE) ?? localParts(now, DEFAULT_TIMEZONE);
    if (!local) return { status: 'NO_PROTOCOL' };

    let view;
    try {
      // O treino de hoje guarda uma cópia da prescrição: antes de gerar o link, garante que ela
      // reflita o protocolo vigente (troca de exercício aprovada depois da abertura do link).
      await this.journal.refreshPlannedSession(userId, local.date, now);
      view = await this.journal.journal(userId, local.date, now);
    } catch (err: unknown) {
      if (err instanceof NotFoundException) return { status: 'NO_PROTOCOL' };
      throw err;
    }
    const workout = view.workout;
    if (!workout) return { status: 'NO_WORKOUT_TODAY' };
    if (workout.status === 'COMPLETED') {
      return { status: 'ALREADY_DONE', focus: workout.prescription.focus };
    }

    if (reason === 'REFRESH' && workout.status === 'IN_PROGRESS') {
      return { status: 'ALREADY_STARTED' };
    }

    if (reason === 'RESEND') {
      const acquired = await this.redis.set(
        this.keys.forUser(userId, 'workout-link', 'chat-resend'),
        '1',
        'EX',
        RESEND_COOLDOWN_SECONDS,
        'NX',
      );
      if (acquired !== 'OK') return { status: 'THROTTLED' };
    }

    // Revoga ANTES de criar: o link novo nunca é atingido pela revogação.
    await this.access.revokePendingMagicLinks(userId);
    const magicLink = await this.access.createMagicLink(userId, workout.id);
    const code = await this.shortLinks.create(magicLink, new Date(Date.now() + MAGIC_TTL_MS));
    const link = `${this.config.whatsapp.publicSiteUrl}/check-in/${code}`;

    const firstName = firstNameOf(student.name);
    const focus = workout.prescription.focus;
    const greeting = greetingFor(local.time);
    const build =
      reason === 'REFRESH'
        ? refreshedWorkoutMessage
        : reason === 'RESEND'
          ? resentTodayWorkoutMessage
          : onDemandWorkoutMessage;

    await this.redis.set(
      this.keys.forUser(userId, 'workout-daily', 'decided', local.date),
      '1',
      'EX',
      DECIDED_MARKER_TTL_SECONDS,
    );
    this.logger.info(
      { event: 'workout_link_prepared', userId, reason },
      'link do check-in diário gerado fora da varredura das 04:00',
    );
    return {
      status: 'READY',
      text: build(firstName, focus, link, greeting),
      workoutId: workout.id,
      focus,
      sessionKey: workout.prescription.dayLabel,
      workoutStatus: workout.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'PLANNED',
    };
  }

  /**
   * Link do REGISTRO TARDIO: abre o diário no dia do treino que o aluno quer registrar. Não
   * revoga os outros links — o link de hoje, que ele talvez ainda nem tenha usado, continua
   * valendo. Devolve `null` se o aluno não existe.
   */
  async prepareLateLog(
    userId: string,
    late: { workoutId: string; date: string; focus: string },
    now = new Date(),
  ): Promise<{ text: string } | null> {
    const [student] = await this.db.runAsSystem((tx) =>
      tx
        .select({ name: users.name, timezone: users.timezone })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1),
    );
    if (!student) return null;
    const local =
      localParts(now, student.timezone || DEFAULT_TIMEZONE) ?? localParts(now, DEFAULT_TIMEZONE);
    if (!local) return null;

    const magicLink = await this.access.createMagicLink(userId, late.workoutId, {
      date: late.date,
    });
    const code = await this.shortLinks.create(magicLink, new Date(Date.now() + MAGIC_TTL_MS));
    const link = `${this.config.whatsapp.publicSiteUrl}/check-in/${code}`;
    const yesterday = previousDay(local.date);
    const when =
      late.date === yesterday
        ? 'ontem'
        : late.date === previousDay(yesterday)
          ? 'anteontem'
          : shortWeekdayName(late.date);
    return {
      text: lateLogLinkMessage(
        firstNameOf(student.name),
        when,
        late.focus,
        link,
        greetingFor(local.time),
      ),
    };
  }

  /** Gera e enfileira o balão (para quem não monta uma resposta própria do Coach). */
  async send(userId: string, reason: LinkReason, now = new Date()): Promise<PreparedLink> {
    const prepared = await this.prepare(userId, reason, now);
    if (prepared.status !== 'READY') return prepared;
    const dedupeId = `workout-link-${reason.toLowerCase()}-${randomUUID()}`;
    const outbound: WhatsappOutboundJob = {
      userId,
      type: 'WORKOUT_DAILY_LINK',
      dedupeId,
      text: prepared.text,
    };
    await this.queues.enqueue(QUEUE.whatsappOutbound, 'workout-daily-link', outbound, {
      jobId: `wa-${dedupeId}`,
    });
    return prepared;
  }
}
