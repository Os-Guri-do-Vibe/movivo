'use client';

import * as React from 'react';

import { SUBSCRIPTION_PLANS, type PaymentMethodId, type SubscriptionPlanId } from '@movivo/shared';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { isAnalyticsEnabled } from '@/lib/env';
import { formatBRL, startCheckout } from '@/lib/subscription-api';

/**
 * Seleção de plano + meio de pagamento (US-4.6). Client component: pré-seleciona pelo
 * `?plano=`, dispara `checkout_started` e redireciona ao checkout HOSPEDADO. Nenhum campo
 * de cartão aqui (PCI). Sem dark pattern: a garantia de cancelamento fica sempre visível
 * (renderizada no server, fora deste componente).
 */
const METHODS: { id: PaymentMethodId; label: string }[] = [
  { id: 'CARD', label: 'Cartão de crédito' },
  { id: 'PIX', label: 'PIX' },
];

function track(event: string, props?: Record<string, unknown>): void {
  if (!isAnalyticsEnabled) return;
  void import('posthog-js').then(({ default: posthog }) => posthog.capture(event, props));
}

export function PlanSelector({
  token,
  initialPlan,
}: {
  token: string;
  initialPlan: SubscriptionPlanId;
}) {
  const [plan, setPlan] = React.useState<SubscriptionPlanId>(initialPlan);
  const [method, setMethod] = React.useState<PaymentMethodId>('CARD');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(false);

  async function handleCheckout() {
    setLoading(true);
    setError(false);
    track('checkout_started', { plan, method });
    try {
      const { checkoutUrl } = await startCheckout(token, plan, method);
      window.location.href = checkoutUrl;
    } catch {
      setError(true);
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-3">
        <legend className="text-h3 font-semibold">Escolha seu plano</legend>
        <div className="flex flex-col gap-2">
          {SUBSCRIPTION_PLANS.map((p) => {
            const selected = plan === p.id;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setPlan(p.id)}
                className={cn(
                  'flex min-h-11 items-center justify-between gap-4 rounded-lg border px-5 py-3 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  selected
                    ? 'border-primary bg-accent'
                    : 'border-input bg-background hover:bg-accent',
                )}
              >
                <span className="flex items-center gap-2 text-body font-medium">
                  {p.label}
                  {p.recommended ? (
                    <span className="rounded-full bg-primary px-2 py-0.5 font-mono text-label text-primary-foreground">
                      recomendado
                    </span>
                  ) : null}
                </span>
                <span className="text-body font-semibold">{formatBRL(p.priceCents)}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-h3 font-semibold">Como você prefere pagar?</legend>
        <div className="flex flex-col gap-2 sm:flex-row">
          {METHODS.map((m) => {
            const selected = method === m.id;
            return (
              <button
                key={m.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setMethod(m.id)}
                className={cn(
                  'inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border px-5 py-2 text-body font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  selected
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <Button size="lg" className="w-full sm:w-auto" onClick={handleCheckout} disabled={loading}>
        {loading ? 'Abrindo pagamento…' : 'Ir para o pagamento'}
      </Button>

      {error ? (
        <p role="alert" className="text-label text-destructive">
          Não conseguimos abrir o pagamento agora. Tente novamente em instantes.
        </p>
      ) : null}

      <p className="text-label text-muted-foreground">
        O pagamento é processado em ambiente seguro do nosso parceiro. Nenhum dado do seu cartão
        passa pela MOVIVO.
      </p>
    </div>
  );
}
