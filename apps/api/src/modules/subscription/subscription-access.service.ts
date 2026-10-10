/**
 * Acesso ao gerenciamento da assinatura SEM token na mão do aluno. Três portas, um só destino
 * (o portal do próprio titular, enviado só ao WhatsApp dele): pedido por texto no WhatsApp,
 * página pública por telefone e link vencido que se renova sozinho.
 *
 * Isolamento: a identidade vem do canal (remetente autenticado do WhatsApp) ou de um
 * casamento EXATO de telefone, e o link novo SEMPRE vai para o número cadastrado — nunca para
 * quem pediu. Por isso a resposta pública é idêntica exista ou não assinatura (não revela
 * quem é cliente) e um terceiro só consegue, no pior caso, mandar o aluno ler a própria mensagem.
 */
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { AccessLinkService } from '../../core/database/access-link.service';
import {
  SUBSCRIPTION_INBOUND_EVENT,
  type SubscriptionInboundEvent,
} from '../../core/event-bus/events';
import { DomainEventBus } from '../../core/event-bus/event-bus.service';
import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import type { WhatsappOutboundJob } from '../jobs/whatsapp-outbound.contract';
import { ShortLinkService } from '../short-link/short-link.service';
import {
  isSubscribeIntent,
  isSubscriptionManagementIntent,
  normalizeBrazilianPhone,
} from './subscription-access';
import { checkoutLinkMessage, subscriptionAccessMessage } from './subscription-messages';
import { SubscriptionRepository } from './subscription.repository';
import { SubscriptionService } from './subscription.service';

/** Pedidos de link por titular por hora (WhatsApp, página pública e renovação somados). */
const LINKS_PER_HOUR = 5;
const WINDOW_SECONDS = 3_600;
const TARGET_PATTERN = /\/(conta|assinar)\/([A-Za-z0-9_-]{43})(?:[/?#].*)?$/;

const sha = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class SubscriptionAccessService implements OnModuleInit, OnModuleDestroy {
  private unregister?: () => void;

  constructor(
    private readonly repo: SubscriptionRepository,
    private readonly subs: SubscriptionService,
    private readonly accessLinks: AccessLinkService,
    private readonly shortLinks: ShortLinkService,
    private readonly queues: QueueManager,
    private readonly events: DomainEventBus,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SubscriptionAccessService.name);
  }

  onModuleInit(): void {
    // O WhatsApp só conhece o evento: o pedido de cancelamento é interceptado antes da IA.
    this.unregister = this.events.register<SubscriptionInboundEvent, boolean>(
      SUBSCRIPTION_INBOUND_EVENT,
      ({ userId, text, messageKey }) => this.handleInbound(userId, text, messageKey),
    );
  }

  onModuleDestroy(): void {
    this.unregister?.();
  }

  /**
   * Porta 1 — mensagem do aluno no WhatsApp. `true` = tratada, a IA não deve responder.
   * Cancelar/gerenciar manda o portal; "quero assinar / voltar a assinar" manda o checkout.
   */
  async handleInbound(userId: string, text: string, messageKey: string): Promise<boolean> {
    const manage = isSubscriptionManagementIntent(text);
    const subscribe = !manage && isSubscribeIntent(text);
    if (!manage && !subscribe) return false;
    const sub = await this.repo.findByUserId(userId);
    if (!sub) return false;
    if (manage) {
      await this.sendPortalLink(userId, `inbound-${messageKey}`);
      return true;
    }
    // Quem já está pagando não precisa de checkout: a conversa segue com a IA.
    if (sub.status === 'ACTIVE' || sub.status === 'PAUSED') return false;
    await this.sendCheckoutLink(userId, `inbound-${messageKey}`);
    return true;
  }

  /** Porta 2 — página pública: o aluno digita o celular. Sempre silencioso para quem pede. */
  async requestPortalLinkByPhone(digits: string): Promise<void> {
    const phone = normalizeBrazilianPhone(digits);
    if (!phone) return;
    const userId = await this.repo.findSubscriberByPhone(phone);
    if (!userId) {
      this.logger.info({ event: 'access_link_unknown_phone' }, 'pedido de link sem titular');
      return;
    }
    await this.sendPortalLink(userId, `phone-${Date.now()}`);
  }

  /** Porta 3 — link curto vencido: reenvia um novo, do mesmo tipo, ao dono do link antigo. */
  async renewFromShortCode(code: string): Promise<void> {
    if (!/^[A-Za-z0-9]{24}$/.test(code)) return;
    const target = await this.shortLinks.resolveForRenewal(code);
    const match = target ? TARGET_PATTERN.exec(target) : null;
    if (!match) return;
    const [, kind, token] = match;
    const purpose = kind === 'assinar' ? 'CHECKOUT' : 'SUBSCRIPTION_PORTAL';
    const userId = await this.accessLinks.ownerOf(token as string, purpose);
    if (!userId) return;
    if (kind === 'assinar') await this.sendCheckoutLink(userId, `renew-${Date.now()}`);
    else await this.sendPortalLink(userId, `renew-${Date.now()}`);
  }

  private async sendPortalLink(userId: string, idempotencyKey: string): Promise<void> {
    if (!(await this.withinBudget(userId))) return;
    const url = await this.subs.createShortCancelLink(userId);
    await this.enqueue(userId, subscriptionAccessMessage(url), `sub-access-${sha(idempotencyKey)}`);
  }

  private async sendCheckoutLink(userId: string, idempotencyKey: string): Promise<void> {
    if (!(await this.withinBudget(userId))) return;
    const url = await this.subs.createShortCheckoutLink(userId);
    await this.enqueue(userId, checkoutLinkMessage(url), `sub-checkout-${sha(idempotencyKey)}`);
  }

  private async withinBudget(userId: string): Promise<boolean> {
    const key = this.keys.forUser(userId, 'subscription', 'access-link-budget');
    const used = await this.redis.incr(key);
    if (used === 1) await this.redis.expire(key, WINDOW_SECONDS);
    if (used > LINKS_PER_HOUR) {
      this.logger.warn({ event: 'access_link_rate_limited', userId }, 'limite de links atingido');
      return false;
    }
    return true;
  }

  private async enqueue(userId: string, text: string, dedupe: string): Promise<void> {
    const dedupeId = dedupe.slice(0, 56);
    await this.queues.enqueue(
      QUEUE.whatsappOutbound,
      'subscription-access-link',
      { userId, type: 'COACH_MESSAGE', text, dedupeId } satisfies WhatsappOutboundJob,
      { jobId: `wa-${dedupeId}` },
    );
  }
}
