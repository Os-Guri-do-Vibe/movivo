import { Injectable } from '@nestjs/common';

import { AppConfigService } from '../../core/config';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import type { WhatsappOutboundJob } from '../jobs/whatsapp-outbound.contract';
import { ShortLinkService } from '../short-link/short-link.service';
import { dailyLinkMessage, greetingFor } from './messages';
import { MAGIC_TTL_MS, TrainingAccessService } from './training-access.service';

/** Link mágico do dia (curto) e envio por WhatsApp. */
@Injectable()
export class TrainingLinkService {
  constructor(
    private readonly access: TrainingAccessService,
    private readonly shortLinks: ShortLinkService,
    private readonly queues: QueueManager,
    private readonly config: AppConfigService,
  ) {}

  /** URL curta (`/hoje/<código>`) que redireciona para o link mágico completo. */
  async shortUrl(userId: string, options: { date?: string } = {}): Promise<string> {
    const magic = await this.access.createMagicLink(userId, undefined, options);
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
}
