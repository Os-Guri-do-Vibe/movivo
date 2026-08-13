/**
 * Suíte de segurança de pagamento (US-4.7) — GATE BLOQUEANTE. Consolida os invariantes de
 * qualidade do fluxo de DINHEIRO num arquivo nomeado. Aqui um bug não é resposta ruim: é fraude,
 * cobrança indevida ou receita fantasma.
 *
 * ⚠️ Mocks-first (sem gateway real no CI): a segurança é DETERMINÍSTICA. O que a garante é a
 * assinatura HMAC do `MockGateway` (mesma interface do real), o PCI-boundary do CONTRATO de API
 * (schemas Zod) e as regras de guardrail — não uma conta de gateway. Gateway real (`real-gateways.ts`)
 * é bloqueador de LANÇAMENTO, não de dev.
 *
 * NÃO duplica o que já é verde: a máquina de estados e o `resolveAccess` estão em
 * `subscription-model.spec.ts`; a HMAC válida/tolerância em `mock-gateway.spec.ts`; a idempotência
 * de ativação (event_id SET NX + uniqueIndex) e o isolamento por titular (RLS/IDOR) em
 * `payment-webhook.int-spec.ts` / `subscription.int-spec.ts`. Esta suíte cobre os BURACOS.
 */
import { subscriptionViewSchema, createCheckoutSchema, SUBSCRIPTION_PLANS } from '@movivo/shared';
import { describe, expect, it, vi } from 'vitest';

import { LANGUAGE_RULES } from '../protocol/validation/validation-rules';
import { MockGateway } from './payment/mock-gateway';
import { PLAN_CATALOG, type SubscriptionPlan } from './subscription-model';
import {
  conversionMessage,
  dunningMessage,
  type ConversionTouchpoint,
} from './subscription-messages';

const logger = { info: vi.fn(), warn: vi.fn(), setContext: vi.fn() } as never;

describe('4.7.1 — webhook de pagamento: vetor plantado (T-15) NUNCA ativa', () => {
  const gateway = new MockGateway(logger);
  const ts = Math.floor(Date.now() / 1000).toString();
  const body = Buffer.from(
    JSON.stringify({ type: 'CHECKOUT_CONFIRMED', eventId: 'evt_1', userId: 'u1' }),
  );

  it('assinatura forjada → parseWebhookEvent devolve null (nunca vira ativação)', () => {
    // T-15: o atacante forja um CHECKOUT_CONFIRMED para ativar uma assinatura falsa.
    expect(gateway.parseWebhookEvent(body, 'deadbeef', ts)).toBeNull();
    expect(gateway.parseWebhookEvent(body, undefined, ts)).toBeNull();
  });

  it('corpo adulterado após assinar → null (a assinatura é sobre o corpo bruto)', () => {
    const sig = gateway.sign(body, ts);
    const tampered = Buffer.from(body.toString().replace('u1', 'attacker'));
    expect(gateway.parseWebhookEvent(tampered, sig, ts)).toBeNull();
    // sanidade: o corpo íntegro com a assinatura correta PARSEIA (senão o teste seria vácuo).
    expect(gateway.parseWebhookEvent(body, sig, ts)).not.toBeNull();
  });
});

describe('4.7.3 — PCI-boundary: nenhum dado de cartão/gateway no contrato de API', () => {
  const FORBIDDEN = ['card', 'cartao', 'cvv', 'number', 'pan', 'gateway', 'externalsubscriptionid'];

  it('a view do portal só expõe plano/estado/acesso/período (sem cartão, sem id externo)', () => {
    expect(Object.keys(subscriptionViewSchema.shape).sort()).toEqual(
      ['access', 'currentPeriodEnd', 'plan', 'status'].sort(),
    );
    for (const key of Object.keys(subscriptionViewSchema.shape)) {
      expect(FORBIDDEN).not.toContain(key.toLowerCase());
    }
  });

  it('o body do checkout aceita só plan+method — cartão nunca chega ao backend', () => {
    expect(Object.keys(createCheckoutSchema.shape).sort()).toEqual(['method', 'plan']);
    // Campo de cartão injetado é rejeitado/ignorado pelo schema estrito (nunca persistido).
    const parsed = createCheckoutSchema.safeParse({
      plan: 'MONTHLY',
      method: 'CARD',
      cardNumber: '4111111111111111',
      cvv: '123',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty('cardNumber');
      expect(parsed.data).not.toHaveProperty('cvv');
    }
  });
});

describe('4.7.4 — unit economics sobre o PLAN_CATALOG (determinístico)', () => {
  it('todo preço é centavo inteiro positivo (dinheiro nunca em float)', () => {
    for (const [id, spec] of Object.entries(PLAN_CATALOG)) {
      expect(Number.isInteger(spec.priceCents), `${id} priceCents inteiro`).toBe(true);
      expect(spec.priceCents).toBeGreaterThan(0);
      expect(spec.periodDays).toBeGreaterThan(0);
    }
  });

  it('downgrade para Mensal preserva payback: Mensal é o MAIOR preço por mês', () => {
    const perMonth = (p: SubscriptionPlan) =>
      PLAN_CATALOG[p].priceCents / (PLAN_CATALOG[p].periodDays / 30);
    const monthly = perMonth('MONTHLY');
    for (const p of Object.keys(PLAN_CATALOG) as SubscriptionPlan[]) {
      // Planos mais longos dão desconto por mês; Mensal nunca pode sair mais barato/mês,
      // senão o downgrade destruiria o payback (meses p/ recuperar CAC ao ARPU mensal).
      expect(monthly).toBeGreaterThanOrEqual(perMonth(p));
    }
  });

  it('o catálogo do domínio casa com a fonte única de `@movivo/shared` (preço do checkout = exibido)', () => {
    for (const plan of SUBSCRIPTION_PLANS) {
      expect(PLAN_CATALOG[plan.id].priceCents).toBe(plan.priceCents);
      expect(PLAN_CATALOG[plan.id].periodDays).toBe(plan.periodDays);
    }
  });
});

describe('4.7.4 — copy dentro dos guardrails (Sofia §13, sem termos proibidos)', () => {
  const url = 'https://mock.checkout/x';
  const touchpoints: ConversionTouchpoint[] = ['day7', 'day10', 'day13', 'day14', 'winback'];
  const texts = [...touchpoints.map((t) => conversionMessage(t, url, 'MOVI')), dunningMessage(url)];

  it.each(texts.map((t, i) => [i, t] as const))(
    'copy #%i não dispara regra de linguagem',
    (_i, text) => {
      for (const rule of LANGUAGE_RULES) {
        expect(rule.pattern.test(text), `${rule.id} em: ${text.slice(0, 40)}`).toBe(false);
      }
    },
  );
});
