/**
 * Cliente HTTP da assinatura (US-4.6) — consome o `SubscriptionController` (US-4.1/4.5).
 *
 * O token do portal É o `userId` (UUID): vai no PATH (nunca query string, Sato §8.1),
 * mesmo padrão IDOR-safe da US-2.6. NENHUM dado de cartão passa por aqui — o checkout é
 * hospedado pelo gateway (PCI); só recebemos a `checkoutUrl` para redirecionar.
 */
import type { CheckoutSessionView, PaymentMethodId, SubscriptionPlanId } from '@movivo/shared';

import { publicEnv } from './env';

const BASE = publicEnv.apiUrl;

/** Centavos inteiros → BRL (nativo, sem dependência). */
export function formatBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

export type ManageAction = 'cancel' | 'pause' | 'resume';

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`request_failed_${res.status}`);
  return (await res.json().catch(() => ({}))) as T;
}

/** Cria o checkout hospedado e devolve a URL do gateway para redirecionar. */
export function startCheckout(
  token: string,
  plan: SubscriptionPlanId,
  method: PaymentMethodId,
): Promise<CheckoutSessionView> {
  return post<CheckoutSessionView>(`/subscription/${token}/checkout`, { plan, method });
}

/** Cancela / pausa / retoma a assinatura self-service (US-4.5). */
export function manageSubscription(
  token: string,
  action: ManageAction,
): Promise<{ status: string }> {
  return post<{ status: string }>(`/subscription/${token}/${action}`);
}
