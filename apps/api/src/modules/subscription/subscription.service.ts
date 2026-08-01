/**
 * SubscriptionService (US-4.1) — planos por período + máquina de estados governada por eventos
 * do gateway (nunca pelo app arbitrariamente). Idempotência da ativação pela chave
 * `externalSubscriptionId`; transição inválida é rejeitada (`InvalidTransitionError`).
 *
 * NÃO fala com o gateway direto: usa o `PaymentGateway` confinado (US-4.1.2). Preços em
 * centavos inteiros. Tudo sob RLS via o repositório.
 */
import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { SubscriptionStatus } from '@movivo/shared';

import { AppConfigService } from '../../core/config';
import type { SubscriptionRow } from '../../core/database/schema';
import {
  type AccessLevel,
  canTransition,
  InvalidTransitionError,
  PLAN_CATALOG,
  resolveAccess,
  type SubscriptionPlan,
  TRIAL_DAYS,
} from './subscription-model';
import {
  type CheckoutSession,
  type GatewayEvent,
  type GatewayEventType,
  PAYMENT_GATEWAY,
  type PaymentGateway,
  type PaymentMethod,
} from './payment/payment-gateway.types';
import { SubscriptionRepository } from './subscription.repository';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Estado-alvo que cada evento do gateway impõe à assinatura (mapa puro). */
export function nextStatusForEvent(type: GatewayEventType): SubscriptionStatus {
  switch (type) {
    case 'CHECKOUT_CONFIRMED':
      return 'ACTIVE';
    case 'PAYMENT_FAILED':
      return 'PAST_DUE';
    case 'SUBSCRIPTION_CANCELED':
    case 'REFUNDED':
      return 'CANCELED';
  }
}

@Injectable()
export class SubscriptionService {
  constructor(
    private readonly repo: SubscriptionRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly config: AppConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SubscriptionService.name);
  }

  /**
   * Cria a sessão de checkout HOSPEDADA (US-4.2.1) com o plano pré-selecionado e devolve o link.
   * Nenhum dado de cartão toca o backend (PCI). Idempotente: reusa a assinatura do titular (uma
   * por usuário) e registra o aceite de termos; o `externalSubscriptionId` é fixado no webhook.
   */
  async createCheckout(
    userId: string,
    plan: SubscriptionPlan,
    method: PaymentMethod,
    termsVersion: string,
  ): Promise<CheckoutSession> {
    const sub = (await this.repo.findByUserId(userId)) ?? (await this.startTrial(userId, plan));
    const priceCents = PLAN_CATALOG[plan].priceCents;
    const site = this.config.whatsapp.publicSiteUrl;
    const session = await this.gateway.createCheckoutSession({
      userId,
      plan,
      priceCents,
      method,
      termsVersion,
      successUrl: `${site}/checkout/sucesso`,
      cancelUrl: `${site}/checkout/cancelado`,
    });
    // Registra intenção de plano + aceite de termos (idempotente — só patch, não duplica linha).
    await this.repo.patch(userId, sub.id, {
      plan,
      priceCents,
      termsVersion,
      termsAcceptedAt: new Date(),
    });
    return session;
  }

  /** Acesso derivado do estado da assinatura (US-4.2.3) — não do app. */
  async getAccess(userId: string): Promise<AccessLevel> {
    const sub = await this.repo.findByUserId(userId);
    return resolveAccess(sub, this.config.payment.pastDueGraceDays);
  }

  /** Cria a assinatura em TRIALING (7 dias sem cartão). Idempotente por titular. */
  async startTrial(userId: string, plan: SubscriptionPlan = 'MONTHLY'): Promise<SubscriptionRow> {
    const existing = await this.repo.findByUserId(userId);
    if (existing) return existing;
    return this.repo.insert({
      userId,
      plan,
      priceCents: PLAN_CATALOG[plan].priceCents,
      status: 'TRIALING',
      trialEndsAt: new Date(Date.now() + TRIAL_DAYS * DAY_MS),
    });
  }

  /** Lê a assinatura vigente do titular (consumido por US-4.2/4.6). */
  getForUser(userId: string): Promise<SubscriptionRow | null> {
    return this.repo.findByUserId(userId);
  }

  /**
   * Aplica um evento do gateway à máquina de estados. Idempotente (ativação repetida com o
   * mesmo `externalSubscriptionId` é no-op); transição inválida → `InvalidTransitionError`.
   * ponytail: read-then-write em txns separadas — a chave `externalSubscriptionId` + o check
   * de idempotência cobrem a reentrega dupla realista; lock por titular se a contenção crescer.
   */
  async applyGatewayEvent(event: GatewayEvent): Promise<{ status: string }> {
    const current = await this.repo.findByUserId(event.userId);
    if (!current) {
      this.logger.warn(
        { userId: event.userId, event: event.type },
        'evento sem assinatura — ignorado',
      );
      return { status: 'NO_SUBSCRIPTION' };
    }

    const target = nextStatusForEvent(event.type);

    // Idempotência da ativação: mesmo externalSubscriptionId já ativo → no-op.
    if (
      event.type === 'CHECKOUT_CONFIRMED' &&
      current.status === 'ACTIVE' &&
      current.externalSubscriptionId === event.externalSubscriptionId
    ) {
      return { status: 'IDEMPOTENT' };
    }
    if (current.status === target && event.type !== 'CHECKOUT_CONFIRMED') {
      return { status: 'IDEMPOTENT' };
    }

    if (!canTransition(current.status, target)) {
      throw new InvalidTransitionError(current.status, target);
    }

    await this.repo.patch(event.userId, current.id, this.patchFor(event, target));
    this.logger.info(
      { userId: event.userId, from: current.status, to: target, event: event.type },
      'transição de assinatura aplicada',
    );
    return { status: target };
  }

  /**
   * Registra o motivo declarado no win-back (US-4.4) em `cancelReason` — insumo de retenção.
   * Não muda o estado da assinatura (é só a objeção). ponytail: a captura da resposta livre do
   * usuário no WhatsApp (rotear o inbound → aqui) é o seam; aqui fica a persistência do motivo.
   */
  async recordWinbackReason(userId: string, reason: string): Promise<{ status: string }> {
    const sub = await this.repo.findByUserId(userId);
    if (!sub) return { status: 'NO_SUBSCRIPTION' };
    await this.repo.patch(userId, sub.id, { cancelReason: reason });
    this.logger.info({ event: 'winback_responded', userId }, 'winback_responded');
    return { status: 'RECORDED' };
  }

  /** Cancelamento self-service (US-4.5 usa o fluxo completo; aqui a transição + sync do gateway). */
  async cancel(userId: string, reason?: string): Promise<{ status: string }> {
    const current = await this.repo.findByUserId(userId);
    if (!current) return { status: 'NO_SUBSCRIPTION' };
    if (!canTransition(current.status, 'CANCELED')) {
      throw new InvalidTransitionError(current.status, 'CANCELED');
    }
    if (current.externalSubscriptionId) {
      await this.gateway.cancelSubscription(current.externalSubscriptionId);
    }
    await this.repo.patch(userId, current.id, {
      status: 'CANCELED',
      canceledAt: new Date(),
      cancelReason: reason ?? null,
    });
    return { status: 'CANCELED' };
  }

  /** Pausa self-service (offboarding-pausa, US-4.5): mantém histórico, suspende cobrança. */
  async pause(userId: string): Promise<{ status: string }> {
    const current = await this.repo.findByUserId(userId);
    if (!current) return { status: 'NO_SUBSCRIPTION' };
    if (!canTransition(current.status, 'PAUSED')) {
      throw new InvalidTransitionError(current.status, 'PAUSED');
    }
    await this.repo.patch(userId, current.id, { status: 'PAUSED' });
    return { status: 'PAUSED' };
  }

  /** Campos a gravar por evento. CHECKOUT_CONFIRMED atacha plano/preço/período/provedor. */
  private patchFor(event: GatewayEvent, target: SubscriptionStatus): Partial<SubscriptionRow> {
    if (event.type === 'CHECKOUT_CONFIRMED') {
      const plan = event.plan ?? 'MONTHLY';
      const now = new Date();
      return {
        status: 'ACTIVE',
        plan,
        priceCents: event.priceCents ?? PLAN_CATALOG[plan].priceCents,
        externalSubscriptionId: event.externalSubscriptionId,
        // MOCK (dev) não é um provedor fiscal real → deixa nulo; real grava STRIPE/ASAAS.
        paymentProvider: this.gateway.name === 'MOCK' ? null : this.gateway.name,
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + PLAN_CATALOG[plan].periodDays * DAY_MS),
      };
    }
    if (target === 'CANCELED') {
      return {
        status: 'CANCELED',
        canceledAt: new Date(),
        cancelReason: event.type === 'REFUNDED' ? 'refund' : null,
      };
    }
    return { status: target };
  }
}
