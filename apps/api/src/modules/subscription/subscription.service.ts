/**
 * SubscriptionService (US-4.1) — planos por período + máquina de estados governada por eventos
 * do gateway (nunca pelo app arbitrariamente). Idempotência da ativação pela chave
 * `externalSubscriptionId`; transição inválida é rejeitada (`InvalidTransitionError`).
 *
 * NÃO fala com o gateway direto: usa o `PaymentGateway` confinado (US-4.1.2). Preços em
 * centavos inteiros. Tudo sob RLS via o repositório.
 */
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import {
  SUBSCRIPTION_PLANS,
  type BiologicalSex,
  type CheckoutPaymentResult,
  type CheckoutSummary,
  type CreateCheckoutBody,
  type SubscriptionStatus,
  type SubscriptionView,
} from '@movivo/shared';

import { AppConfigService } from '../../core/config';
import type { SubscriptionRow } from '../../core/database/schema';
import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';
import {
  type AccessLevel,
  canTransition,
  contractIdsOf,
  InvalidTransitionError,
  isRecurringContract,
  paidThroughFor,
  PLAN_CATALOG,
  referencesContract,
  resolveAccess,
  SUBSCRIPTION_TERMS_VERSION,
  type SubscriptionPlan,
  TRIAL_DAYS,
} from './subscription-model';
import {
  type ExternalContractRefs,
  type GatewayEvent,
  type GatewayEventType,
  PAYMENT_GATEWAY,
  type PaymentGateway,
} from './payment/payment-gateway.types';
import { CheckoutTokenService } from './checkout-token.service';
import { SubscriptionRepository } from './subscription.repository';

const DAY_MS = 24 * 60 * 60 * 1000;
const PAYMENT_LOCK_TTL_MS = 30_000;
const RELEASE_LOCK = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

/** Estado-alvo que cada evento do gateway impõe à assinatura (mapa puro). */
export function nextStatusForEvent(type: GatewayEventType): SubscriptionStatus {
  switch (type) {
    case 'CHECKOUT_CONFIRMED':
    case 'AUTHORIZATION_ACTIVE':
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
    private readonly checkoutTokens: CheckoutTokenService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
  ) {
    this.logger.setContext(SubscriptionService.name);
  }

  /** Gera/regenera o link individual sem criar cobrança durante o trial. */
  async createCheckoutLink(userId: string): Promise<string> {
    const sub = await this.repo.findByUserId(userId);
    if (!sub) throw new Error('assinatura ausente para gerar checkout');
    const { token } = this.checkoutTokens.issue(userId);
    const site = this.config.whatsapp.publicSiteUrl;
    return `${site}/assinar/${token}`;
  }

  async getCheckoutSummary(userId: string, expiresAt: number): Promise<CheckoutSummary | null> {
    const sub = await this.repo.findByUserId(userId);
    if (!sub) return null;
    const plan = SUBSCRIPTION_PLANS.find((candidate) => candidate.id === sub.plan);
    if (!plan) return null;
    return {
      plan: plan.id,
      label: plan.label,
      monthlyCents: sub.monthlyPriceCents ?? plan.monthlyCents,
      totalCents: sub.totalPriceCents ?? sub.priceCents,
      months: sub.commitmentMonths ?? plan.months,
      maxInstallments: plan.months,
      status: sub.status,
      expiresAt: new Date(expiresAt).toISOString(),
      methods: ['CARD', 'PIX', 'PIX_AUTOMATIC'],
    };
  }

  /** Inicia uma operação no Asaas. Plano e preço vêm exclusivamente do contrato persistido. */
  async startCheckoutPayment(
    userId: string,
    body: CreateCheckoutBody,
    remoteIp: string,
  ): Promise<CheckoutPaymentResult> {
    const lockKey = this.keys.forUser(userId, 'payment', 'start-lock');
    const lockToken = randomUUID();
    const acquired = await this.redis.set(lockKey, lockToken, 'PX', PAYMENT_LOCK_TTL_MS, 'NX');
    if (acquired !== 'OK') {
      throw new ConflictException('já existe um pagamento sendo iniciado para este contrato');
    }
    try {
      // Releitura depois do lock: uma retentativa vê os IDs persistidos pela primeira chamada.
      const sub = await this.repo.findByUserId(userId);
      if (!sub) throw new Error('assinatura ausente para iniciar pagamento');
      if (sub.status === 'ACTIVE' || sub.status === 'CANCELED' || sub.status === 'PAUSED') {
        throw new ConflictException('assinatura não aceita um novo pagamento neste estado');
      }
      const spec = PLAN_CATALOG[sub.plan];
      const installments = body.method === 'CARD' ? body.installments : undefined;
      if (
        installments !== undefined &&
        (installments > (sub.commitmentMonths ?? spec.months) ||
          (sub.plan === 'MONTHLY' && installments !== 1))
      ) {
        throw new Error('quantidade de parcelas incompatível com o plano');
      }
      const regenerate = body.method !== 'CARD' && body.regenerate === true;
      // Retentativa do MESMO contrato pendente reaproveita a referência (idempotência no
      // Asaas). Qualquer outro caso com contrato anterior — Pix regenerado, troca de método,
      // nova compra depois de expirar — abre contrato novo com tentativa nova.
      const retrying =
        sub.status === 'PENDING_PAYMENT' && sub.paymentMethod === body.method && !regenerate;
      const previous = !retrying && contractIdsOf(sub).length > 0 ? sub : null;
      const paymentAttempt = sub.paymentAttempt + (previous || regenerate ? 1 : 0);
      if (previous) await this.supersede(previous, paymentAttempt);
      const months = sub.commitmentMonths ?? spec.months;
      const result = await this.gateway.startPayment({
        subscriptionId: sub.id,
        userId,
        plan: sub.plan,
        monthlyCents: sub.monthlyPriceCents ?? spec.monthlyCents,
        totalCents: sub.totalPriceCents ?? sub.priceCents,
        months,
        method: body.method,
        payer: body.payer,
        card: body.method === 'CARD' ? body.card : undefined,
        installments,
        remoteIp,
        termsVersion: SUBSCRIPTION_TERMS_VERSION,
        idempotencyKey: `${sub.id}:${paymentAttempt}`,
      });
      await this.repo.patch(userId, sub.id, {
        status: 'PENDING_PAYMENT',
        paymentProvider: this.gateway.name === 'MOCK' ? null : this.gateway.name,
        paymentMethod: body.method,
        installmentCount: installments ?? (body.method === 'PIX_AUTOMATIC' ? months : 1),
        authorizedPaymentCount: body.method === 'PIX_AUTOMATIC' ? months : null,
        paymentAttempt,
        externalCustomerId: result.externalCustomerId,
        externalSubscriptionId: result.externalSubscriptionId,
        externalPaymentId: result.externalPaymentId,
        externalInstallmentId: result.externalInstallmentId,
        externalAuthorizationId: result.externalAuthorizationId,
        termsVersion: SUBSCRIPTION_TERMS_VERSION,
        termsAcceptedAt: new Date(),
        nextBillingAt: parseOptionalDate(result.nextBillingAt),
      });
      return {
        status: result.status,
        method: body.method,
        qrCode: result.qrCode,
        nextBillingAt: result.nextBillingAt,
        message:
          result.status === 'PENDING'
            ? 'Aguardando confirmação do Asaas. O acesso será ativado pelo backend.'
            : undefined,
      };
    } finally {
      await this.redis.eval(RELEASE_LOCK, 1, lockKey, lockToken);
    }
  }

  /**
   * Slot da persona do titular (Sprint 11), para as mensagens da sequência de conversão
   * saírem assinadas pela persona certa. Repassa a leitura sob RLS do repositório.
   */
  async personaSlotFor(userId: string): Promise<BiologicalSex | null> {
    return this.repo.findBiologicalSex(userId);
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
    const trialStartedAt = new Date();
    return this.repo.insert({
      userId,
      plan,
      priceCents: PLAN_CATALOG[plan].priceCents,
      monthlyPriceCents: PLAN_CATALOG[plan].monthlyCents,
      totalPriceCents: PLAN_CATALOG[plan].priceCents,
      commitmentMonths: PLAN_CATALOG[plan].months,
      status: 'TRIALING',
      trialStartedAt,
      trialEndsAt: new Date(trialStartedAt.getTime() + TRIAL_DAYS * DAY_MS),
    });
  }

  /** Expira o trial somente depois do instante persistido; segura contra job adiantado/repetido. */
  async expireTrial(userId: string, now: Date = new Date()): Promise<{ status: string }> {
    const current = await this.repo.findByUserId(userId);
    if (!current) return { status: 'NO_SUBSCRIPTION' };
    if (current.status === 'EXPIRED') return { status: 'IDEMPOTENT' };
    if (current.status !== 'TRIALING') return { status: `SKIP_${current.status}` };
    if (!current.trialEndsAt || current.trialEndsAt.getTime() > now.getTime()) {
      return { status: 'TRIAL_NOT_ENDED' };
    }
    await this.repo.patch(
      userId,
      current.id,
      { status: 'EXPIRED' },
      { actor: 'SYSTEM', reason: 'TRIAL_ENDED' },
    );
    return { status: 'EXPIRED' };
  }

  /** Lê a assinatura vigente do titular (consumido por US-4.2/4.6). */
  getForUser(userId: string): Promise<SubscriptionRow | null> {
    return this.repo.findByUserId(userId);
  }

  /**
   * Estado do portal (US-4.6) — plano, status, acesso e próxima cobrança. Sem PII/id do
   * gateway/dado de cartão. `null` quando o titular não tem assinatura (controller → 404).
   */
  async getView(userId: string): Promise<SubscriptionView | null> {
    const sub = await this.repo.findByUserId(userId);
    if (!sub) return null;
    return {
      plan: sub.plan,
      status: sub.status,
      access: resolveAccess(sub, this.config.payment.pastDueGraceDays),
      currentPeriodEnd: sub.currentPeriodEnd ? sub.currentPeriodEnd.toISOString() : null,
    };
  }

  /**
   * Aplica um evento do gateway à máquina de estados. Idempotente (ativação repetida com o
   * mesmo `externalSubscriptionId` é no-op); transição inválida → `InvalidTransitionError`.
   * ponytail: read-then-write em txns separadas — a chave `externalSubscriptionId` + o check
   * de idempotência cobrem a reentrega dupla realista; lock por titular se a contenção crescer.
   */
  async applyGatewayEvent(event: GatewayEvent): Promise<{ status: string; userId?: string }> {
    const current = event.userId
      ? await this.repo.findByUserId(event.userId)
      : await this.repo.findForGatewayEvent(event);
    if (!current) {
      this.logger.warn({ event: event.type }, 'evento sem assinatura — ignorado');
      return { status: 'NO_SUBSCRIPTION' };
    }

    // Um FAILED antigo não pode derrubar uma confirmação mais nova. A conciliação financeira
    // continua sendo enfileirada pelo webhook, mas o acesso preserva o estado mais recente.
    if (
      event.type === 'PAYMENT_FAILED' &&
      event.occurredAt &&
      new Date(event.occurredAt).getTime() < current.updatedAt.getTime()
    ) {
      this.logger.warn(
        { userId: current.userId, event: event.type },
        'evento de falha anterior ao estado vigente — acesso preservado',
      );
      return { status: 'STALE_EVENT', userId: current.userId };
    }

    // Falha, cancelamento ou estorno de um contrato já substituído (Pix regenerado, troca de
    // método) não pode derrubar o contrato vigente. Dinheiro que entrou (confirmação) passa:
    // quem pagou o QR antigo pagou de verdade.
    const negative = event.type !== 'CHECKOUT_CONFIRMED' && event.type !== 'AUTHORIZATION_ACTIVE';
    if (negative && !referencesContract(event, current)) {
      this.logger.warn(
        { userId: current.userId, event: event.type },
        'evento de contrato substituído — acesso preservado',
      );
      return { status: 'STALE_CONTRACT', userId: current.userId };
    }

    // Primeira cobrança que não liquidou (Pix vencido, QR do Pix Automático expirado, análise
    // de risco): não há período pago a preservar, então nada de PAST_DUE com carência — o
    // estado fica pendente e o webhook manda um novo link.
    if (event.type === 'PAYMENT_FAILED' && current.status === 'PENDING_PAYMENT') {
      this.logger.info(
        { userId: current.userId, event: event.type },
        'primeira cobrança não liquidada — segue pendente, sem carência',
      );
      return { status: 'PENDING_PAYMENT', userId: current.userId };
    }

    if (
      event.type === 'CHECKOUT_CONFIRMED' &&
      event.plan !== undefined &&
      event.plan !== current.plan
    ) {
      this.logger.warn(
        { userId: event.userId, expectedPlan: current.plan, receivedPlan: event.plan },
        'checkout confirmado com plano divergente — ignorado',
      );
      return { status: 'PLAN_MISMATCH', userId: current.userId };
    }

    // Renovação de contrato recorrente: cada cobrança paga cobre um mês a partir do
    // vencimento. Pela competência, e não pela chegada, a confirmação atrasada de um mês
    // antigo (ex.: `PAYMENT_RECEIVED` do cartão, D+30) nunca estende o período de novo.
    if (
      event.type === 'CHECKOUT_CONFIRMED' &&
      current.status === 'ACTIVE' &&
      isRecurringContract(current) &&
      referencesContract(event, current)
    ) {
      const paidThrough = paidThroughFor(current, event.dueDate);
      if (current.currentPeriodEnd && paidThrough <= current.currentPeriodEnd) {
        return { status: 'IDEMPOTENT', userId: current.userId };
      }
      await this.repo.patch(
        current.userId,
        current.id,
        {
          // ACTIVE → ACTIVE: o repositório registra o marco `RENEWED`.
          status: 'ACTIVE',
          currentPeriodStart: event.dueDate ? new Date(event.dueDate) : new Date(),
          currentPeriodEnd: paidThrough,
          externalPaymentId: event.externalPaymentId,
        },
        { actor: 'SYSTEM', reason: event.type },
      );
      this.logger.info({ userId: current.userId, event: event.type }, 'período renovado');
      return { status: 'RENEWED', userId: current.userId };
    }

    const target = nextStatusForEvent(event.type);

    // Idempotência da ativação: mesmo externalSubscriptionId já ativo → no-op.
    if (
      event.type === 'CHECKOUT_CONFIRMED' &&
      current.status === 'ACTIVE' &&
      current.externalSubscriptionId === event.externalSubscriptionId
    ) {
      return { status: 'IDEMPOTENT', userId: current.userId };
    }
    if (current.status === target && event.type !== 'CHECKOUT_CONFIRMED') {
      return { status: 'IDEMPOTENT', userId: current.userId };
    }

    if (!canTransition(current.status, target)) {
      throw new InvalidTransitionError(current.status, target);
    }

    const userId = current.userId;
    const resolvedEvent = { ...event, userId };
    await this.repo.patch(userId, current.id, this.patchFor(resolvedEvent, target, current), {
      actor: 'SYSTEM',
      reason: event.type,
    });
    this.logger.info(
      { userId, from: current.status, to: target, event: event.type },
      'transição de assinatura aplicada',
    );
    return { status: target, userId };
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
    // Parcelado no cartão e Pix à vista já pagos não têm cobrança futura a interromper: o
    // cancelamento só encerra a relação, e o acesso segue até o fim do período pago.
    if (mayStillCharge(current) && contractIdsOf(current).length > 0) {
      await this.gateway.cancelContract(contractRefsOf(current));
    }
    await this.repo.patch(
      userId,
      current.id,
      { status: 'CANCELED', canceledAt: new Date(), cancelReason: reason ?? null },
      // Self-service: quem originou a transição é o próprio titular (US-8.3).
      { actor: 'USER', reason: reason ?? null },
    );
    this.logger.info({ event: 'subscription_cancelled', userId }, 'subscription_cancelled');
    return { status: 'CANCELED' };
  }

  /**
   * ACTIVE → EXPIRED quando o período pago acabou sem renovação (varredura de fim de
   * período). Cobrança única expira no fim exato; contrato recorrente ganha a janela de
   * graça para o webhook da cobrança do mês chegar. Relê a linha: seguro contra varredura
   * repetida ou renovação que chegou entre a busca e a execução.
   */
  async expirePeriod(userId: string, now: Date = new Date()): Promise<{ status: string }> {
    const current = await this.repo.findByUserId(userId);
    if (!current) return { status: 'NO_SUBSCRIPTION' };
    if (current.status !== 'ACTIVE') return { status: `SKIP_${current.status}` };
    if (!current.currentPeriodEnd) return { status: 'NO_PERIOD' };
    const margin = isRecurringContract(current) ? this.config.payment.pastDueGraceDays * DAY_MS : 0;
    if (current.currentPeriodEnd.getTime() + margin > now.getTime()) {
      return { status: 'PERIOD_NOT_ENDED' };
    }
    await this.repo.patch(
      userId,
      current.id,
      { status: 'EXPIRED' },
      { actor: 'SYSTEM', reason: 'PERIOD_ENDED' },
    );
    this.logger.info({ event: 'subscription_period_expired', userId }, 'período pago encerrado');
    return { status: 'EXPIRED' };
  }

  /**
   * Troca de contrato: desvincula os IDs antigos ANTES de cancelar no Asaas. O cancelamento
   * dispara webhooks (`SUBSCRIPTION_DELETED`, `PIX_AUTOMATIC_..._CANCELLED`) que, lidos
   * contra a linha ainda com os IDs antigos, derrubariam o contrato novo.
   */
  private async supersede(sub: SubscriptionRow, paymentAttempt: number): Promise<void> {
    await this.repo.patch(sub.userId, sub.id, {
      externalSubscriptionId: null,
      externalPaymentId: null,
      externalInstallmentId: null,
      externalAuthorizationId: null,
      paymentAttempt,
    });
    if (!mayStillCharge(sub)) return;
    try {
      await this.gateway.cancelContract(contractRefsOf(sub));
    } catch (error) {
      if (sub.status === 'EXPIRED') {
        // Contrato já encerrado: falhar aqui só impediria a recompra.
        this.logger.warn(
          { userId: sub.userId, err: error instanceof Error ? error.message : String(error) },
          'cancelamento do contrato expirado falhou — seguindo com a nova compra',
        );
        return;
      }
      // O contrato antigo segue aberto no Asaas: restaura o vínculo para a próxima tentativa
      // cancelá-lo antes de abrir outro (nunca duas cobranças abertas ao mesmo tempo).
      await this.repo.patch(sub.userId, sub.id, {
        externalSubscriptionId: sub.externalSubscriptionId,
        externalPaymentId: sub.externalPaymentId,
        externalInstallmentId: sub.externalInstallmentId,
        externalAuthorizationId: sub.externalAuthorizationId,
        paymentAttempt: sub.paymentAttempt,
      });
      throw error;
    }
  }

  /** Pausa self-service (offboarding-pausa, US-4.5): mantém histórico, suspende cobrança. */
  async pause(userId: string): Promise<{ status: string }> {
    const current = await this.repo.findByUserId(userId);
    if (!current) return { status: 'NO_SUBSCRIPTION' };
    if (!canTransition(current.status, 'PAUSED')) {
      throw new InvalidTransitionError(current.status, 'PAUSED');
    }
    if (
      this.gateway.name !== 'MOCK' &&
      (current.externalSubscriptionId ||
        current.externalPaymentId ||
        current.externalInstallmentId ||
        current.externalAuthorizationId)
    ) {
      throw new ConflictException(
        'pausa indisponível para este contrato; use o cancelamento para impedir novas cobranças',
      );
    }
    await this.repo.patch(userId, current.id, { status: 'PAUSED' }, { actor: 'USER' });
    this.logger.info({ event: 'subscription_paused', userId }, 'subscription_paused');
    return { status: 'PAUSED' };
  }

  /** Retomada self-service (US-4.5): PAUSED→ACTIVE (transição já válida em `canTransition`). */
  async resume(userId: string): Promise<{ status: string }> {
    const current = await this.repo.findByUserId(userId);
    if (!current) return { status: 'NO_SUBSCRIPTION' };
    if (!canTransition(current.status, 'ACTIVE')) {
      throw new InvalidTransitionError(current.status, 'ACTIVE');
    }
    await this.repo.patch(userId, current.id, { status: 'ACTIVE' }, { actor: 'USER' });
    this.logger.info({ event: 'subscription_resumed', userId }, 'subscription_resumed');
    return { status: 'ACTIVE' };
  }

  /** Campos a gravar por evento. CHECKOUT_CONFIRMED atacha plano/preço/período/provedor. */
  private patchFor(
    event: GatewayEvent & { userId: string },
    target: SubscriptionStatus,
    current: SubscriptionRow,
  ): Partial<SubscriptionRow> {
    if (event.type === 'CHECKOUT_CONFIRMED' || event.type === 'AUTHORIZATION_ACTIVE') {
      const plan = event.plan ?? current.plan;
      const catalog = PLAN_CATALOG[plan];
      const now = new Date();
      // Reativação do MESMO contrato de cobrança única (ex.: PAST_DUE → ACTIVE) não ganha um
      // período novo: o aluno pagou o período uma vez só.
      const keepsPeriod =
        !isRecurringContract(current) &&
        current.currentPeriodEnd !== null &&
        referencesContract(event, current);
      return {
        status: 'ACTIVE',
        plan,
        // O contrato já aceito é imutável: uma futura edição do catálogo não reprecifica
        // assinatura existente durante o webhook assíncrono.
        priceCents: current.priceCents,
        monthlyPriceCents: current.monthlyPriceCents ?? catalog.monthlyCents,
        totalPriceCents: current.totalPriceCents ?? current.priceCents,
        commitmentMonths: current.commitmentMonths ?? catalog.months,
        externalSubscriptionId: event.externalSubscriptionId,
        externalCustomerId: event.externalCustomerId ?? null,
        externalPaymentId: event.externalPaymentId,
        externalInstallmentId: event.externalInstallmentId,
        externalAuthorizationId: event.externalAuthorizationId,
        externalCheckoutSessionId: event.externalCheckoutSessionId,
        externalPriceId: event.externalPriceId,
        termsVersion: event.termsVersion,
        termsAcceptedAt: event.termsVersion ? now : undefined,
        // MOCK (dev) não é um provedor fiscal real → deixa nulo; real grava ASAAS.
        paymentProvider: this.gateway.name === 'MOCK' ? null : this.gateway.name,
        ...(keepsPeriod
          ? {}
          : {
              currentPeriodStart: now,
              currentPeriodEnd: paidThroughFor({ ...current, plan }, event.dueDate, now),
            }),
      };
    }
    if (target === 'CANCELED') {
      const now = new Date();
      return {
        status: 'CANCELED',
        canceledAt: now,
        cancelReason: event.type === 'REFUNDED' ? 'refund' : null,
        // Estorno devolve o dinheiro, então encerra o período pago junto. Cancelamento do
        // contrato (autorização revogada, assinatura removida) mantém o que já foi pago.
        ...(event.type === 'REFUNDED' ? { currentPeriodEnd: now } : {}),
      };
    }
    return { status: target };
  }
}

/**
 * O Asaas ainda pode cobrar este contrato? Cobrança pendente sempre; contrato recorrente
 * (assinatura mensal no cartão, Pix Automático) enquanto existir; sem forma de pagamento
 * persistida (linha anterior à coluna) assume que sim, por segurança.
 */
function mayStillCharge(sub: SubscriptionRow): boolean {
  return sub.status === 'PENDING_PAYMENT' || sub.paymentMethod === null || isRecurringContract(sub);
}

/**
 * Referência a cancelar no Asaas pela forma de pagamento. Depois da ativação,
 * `externalSubscriptionId` também guarda o id do parcelamento/cobrança (chave única da
 * ativação): mandá-lo para `DELETE /subscriptions` daria 404 e travaria o cancelamento.
 */
function contractRefsOf(sub: SubscriptionRow): ExternalContractRefs {
  switch (sub.paymentMethod) {
    case 'PIX_AUTOMATIC':
      return { authorizationId: sub.externalAuthorizationId };
    case 'PIX':
      return { paymentId: sub.externalPaymentId };
    case 'CARD':
      return sub.plan === 'MONTHLY'
        ? { subscriptionId: sub.externalSubscriptionId }
        : { installmentId: sub.externalInstallmentId };
    default:
      return {
        subscriptionId: sub.externalSubscriptionId,
        paymentId: sub.externalPaymentId,
        installmentId: sub.externalInstallmentId,
        authorizationId: sub.externalAuthorizationId,
      };
  }
}

function parseOptionalDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
