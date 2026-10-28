import { GoneException, Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';

import { AppConfigService } from '../../core/config';
import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import type { WhatsappOutboundJob } from '../jobs/whatsapp-outbound.contract';
import { ShortLinkService } from '../short-link/short-link.service';
import { dailyLinkMessage, greetingFor } from './messages';
import { MAGIC_TTL_MS, TrainingAccessService } from './training-access.service';

const RESEND_WINDOW_SECONDS = 600;

/** Link mágico do dia (curto) e envio por WhatsApp. */
@Injectable()
export class TrainingLinkService {
  constructor(
    private readonly access: TrainingAccessService,
    private readonly shortLinks: ShortLinkService,
    private readonly queues: QueueManager,
    private readonly config: AppConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
  ) {}

  /** URL curta (`/hoje/<código>`) que redireciona para o link mágico completo. */
  async shortUrl(
    userId: string,
    options: { date?: string; next?: '/hoje' | '/alimentacao' | '/evolucao' | '/check-in' } = {},
  ): Promise<string> {
    const magic = await this.access.createMagicLink(userId, undefined, {
      ...options,
      path: '/hoje/acessar',
    });
    const code = await this.shortLinks.create(magic, new Date(Date.now() + MAGIC_TTL_MS));
    return `${this.config.whatsapp.publicSiteUrl}/hoje/${code}`;
  }

  async sendDaily(input: {
    userId: string;
    firstName: string;
    titles: readonly string[];
    date: string;
    localTime: string;
  }): Promise<void> {
    const link = await this.shortUrl(input.userId);
    const outbound: WhatsappOutboundJob = {
      userId: input.userId,
      type: 'WORKOUT_DAILY_LINK',
      dedupeId: `training-link-${input.date}`,
      text: dailyLinkMessage(input.firstName, input.titles, link, greetingFor(input.localTime)),
    };
    await this.queues.enqueue(QUEUE.whatsappOutbound, 'training-daily-link', outbound, {
      jobId: `wa-training-link-${input.userId}-${input.date}`,
    });
  }

  /**
   * Reenvia um link novo ao WhatsApp do DONO de um link já gasto (ex.: aberto em guia anônima).
   * O link novo nunca volta na resposta; no máximo um a cada 10 minutos.
   */
  async resend(rawToken: string): Promise<'SENT' | 'THROTTLED'> {
    const owner = await this.access.findMagicOwner(rawToken);
    if (!owner) throw new GoneException('Link desconhecido ou revogado.');
    const key = this.keys.forUser(owner.userId, 'training-link', 'resend');
    if ((await this.redis.set(key, '1', 'EX', RESEND_WINDOW_SECONDS, 'NX')) === null) {
      return 'THROTTLED';
    }
    const link = await this.shortUrl(owner.userId);
    const outbound: WhatsappOutboundJob = {
      userId: owner.userId,
      type: 'WORKOUT_DAILY_LINK',
      dedupeId: `training-link-resend-${Date.now()}`,
      text: `Aqui está o seu novo link: ${link}`,
    };
    await this.queues.enqueue(QUEUE.whatsappOutbound, 'training-link-resend', outbound);
    return 'SENT';
  }
}
