/**
 * `WorkoutRefreshOfferService` — o treino de hoje mudou depois do link das 04:00.
 *
 * Cenário (Giovana): às 04:00 ela recebeu o link; às 11:00 a troca de exercício que pediu foi
 * aprovada; ela ainda não treinou. O treino de hoje (cópia da prescrição feita na abertura do
 * link) é atualizado NO LUGAR, para nenhum link mostrar o exercício antigo, e o Coach pergunta se
 * ela quer um link novo. Se ela responder "sim", o novo sai na hora e o anterior deixa de valer
 * (`WorkoutLinkDispatcherService`, motivo `REFRESH`). Quem já começou o treino não recebe a
 * pergunta: a atualização vale a partir do próximo treino.
 *
 * Chamado por quem publica uma nova versão do protocolo (troca de exercício automática ou
 * aprovada pelo CREF, emenda do profissional). Sempre best-effort: nunca derruba a publicação.
 * A resposta do aluno é tratada por `ScheduleFlowService` (estado em Redis até o fim do dia).
 */
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { users } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import type { WhatsappOutboundJob } from '../jobs/whatsapp-outbound.contract';
import { firstNameOf, localParts } from './workout-eligibility';
import { WorkoutJournalService } from './workout-journal.service';
import { greetingFor, refreshOfferMessage } from './workout-messages';

/** A oferta espera a resposta até o fim do dia (o treino é de hoje). */
export const REFRESH_OFFER_TTL_SECONDS = 20 * 3_600;
/**
 * Espera antes de enviar a pergunta: a entrega do protocolo atualizado (PDF + resumo) sai por
 * outro job, e a pergunta tem de chegar DEPOIS dela para a conversa fazer sentido.
 */
export const REFRESH_OFFER_DELAY_MS = 90_000;
const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

export interface RefreshOffer {
  /** Dia civil do treino a atualizar. */
  date: string;
}

export function refreshOfferKey(keys: RedisKeyBuilder, userId: string): string {
  return keys.forUser(userId, 'workout-refresh', 'offer');
}

export type RefreshOfferResult = 'OFFERED' | 'UPDATED_SILENTLY' | 'NOT_NEEDED';

@Injectable()
export class WorkoutRefreshOfferService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly journal: WorkoutJournalService,
    private readonly queues: QueueManager,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WorkoutRefreshOfferService.name);
  }

  /**
   * Atualiza o treino de hoje e, se o aluno já recebeu o link do dia e não começou a treinar,
   * enfileira a pergunta. Nunca lança.
   */
  async onProtocolChanged(
    userId: string,
    reason: 'SUBSTITUTION' | 'ADJUSTMENT',
    now = new Date(),
  ): Promise<RefreshOfferResult> {
    try {
      const [student] = await this.db.runAsSystem((tx) =>
        tx
          .select({ name: users.name, timezone: users.timezone })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1),
      );
      if (!student) return 'NOT_NEEDED';
      const local =
        localParts(now, student.timezone || DEFAULT_TIMEZONE) ?? localParts(now, DEFAULT_TIMEZONE);
      if (!local) return 'NOT_NEEDED';

      const refreshed = await this.journal.refreshPlannedSession(userId, local.date, now);
      if (refreshed !== 'CHANGED') return 'NOT_NEEDED';

      // Sem link enviado hoje (ainda não deu 04:00, ou o aluno nunca recebeu), não há link velho
      // para trocar: a próxima abertura já mostra o treino atualizado.
      const linkSent = await this.redis.exists(
        this.keys.forUser(userId, 'workout-daily', 'decided', local.date),
      );
      if (linkSent !== 1) return 'UPDATED_SILENTLY';

      const view = await this.journal.journal(userId, local.date, now);
      if (!view.workout || view.workout.status !== 'PLANNED') return 'UPDATED_SILENTLY';

      const offer: RefreshOffer = { date: local.date };
      await this.redis.set(
        refreshOfferKey(this.keys, userId),
        JSON.stringify(offer),
        'EX',
        REFRESH_OFFER_TTL_SECONDS,
      );
      const outbound: WhatsappOutboundJob = {
        userId,
        type: 'COACH_MESSAGE',
        dedupeId: `workout-refresh-offer-${local.date}-${view.workout.id}`,
        text: refreshOfferMessage(
          firstNameOf(student.name),
          view.workout.prescription.focus,
          greetingFor(local.time),
          reason,
        ),
      };
      await this.queues.enqueue(QUEUE.whatsappOutbound, 'workout-refresh-offer', outbound, {
        jobId: `wa-workout-refresh-offer-${userId}-${local.date}-${view.workout.id}`,
        delay: REFRESH_OFFER_DELAY_MS,
      });
      return 'OFFERED';
    } catch (err: unknown) {
      this.logger.warn(
        { event: 'workout_refresh_offer_failed', userId, err },
        'não foi possível atualizar o treino de hoje / oferecer o link novo; a publicação segue',
      );
      return 'NOT_NEEDED';
    }
  }
}
