import { GoneException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';

import { AppConfigService } from '../../core/config';
import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import type { WhatsappOutboundJob } from '../jobs/whatsapp-outbound.contract';
import { ShortLinkService } from '../short-link/short-link.service';
import { MAGIC_TTL_MS, WorkoutAccessService } from './workout-access.service';
import { firstNameOf, localParts } from './workout-eligibility';
import { greetingFor, resentWorkoutLinkMessage } from './workout-messages';

const RESEND_COOLDOWN_SECONDS = 10 * 60;

/**
 * Link de check-in aberto em guia anônima: o token é de uso único e o cookie some com a guia.
 * Quem tem o link só dispara um novo envio PARA O WHATSAPP DO DONO — o link novo nunca volta na
 * resposta, então um link vazado não dá acesso à conta.
 */
@Injectable()
export class WorkoutLinkResendService {
  constructor(
    private readonly access: WorkoutAccessService,
    private readonly shortLinks: ShortLinkService,
    private readonly queues: QueueManager,
    private readonly config: AppConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
  ) {}

  async resend(rawToken: string): Promise<'SENT' | 'THROTTLED'> {
    const owner = await this.access.findMagicOwner(rawToken);
    if (!owner) throw new GoneException('Link inválido.');

    const cooldownKey = this.keys.forUser(owner.userId, 'workout-link', 'resend');
    const acquired = await this.redis.set(cooldownKey, '1', 'EX', RESEND_COOLDOWN_SECONDS, 'NX');
    if (acquired !== 'OK') return 'THROTTLED';

    try {
      const magicLink = await this.access.createMagicLink(
        owner.userId,
        owner.workoutSessionId ?? undefined,
      );
      const code = await this.shortLinks.create(magicLink, new Date(Date.now() + MAGIC_TTL_MS));
      const link = `${this.config.whatsapp.publicSiteUrl}/check-in/${code}`;
      const dedupeId = `workout-link-resend-${randomUUID()}`;
      // Saudação pelo horário local do aluno; sem fuso conhecido, a neutra de sempre.
      const local = owner.timezone ? localParts(new Date(), owner.timezone) : null;
      const greeting = local ? greetingFor(local.time) : 'Oi';
      const outbound: WhatsappOutboundJob = {
        userId: owner.userId,
        type: 'WORKOUT_DAILY_LINK',
        dedupeId,
        text: resentWorkoutLinkMessage(firstNameOf(owner.name), link, greeting),
      };
      await this.queues.enqueue(QUEUE.whatsappOutbound, 'workout-daily-link', outbound, {
        jobId: `wa-${dedupeId}`,
      });
    } catch (err: unknown) {
      // Falhou antes de enfileirar: não prende o aluno no intervalo de espera.
      await this.redis.del(cooldownKey);
      throw err;
    }
    return 'SENT';
  }
}
