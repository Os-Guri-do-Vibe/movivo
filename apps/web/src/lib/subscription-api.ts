/** Cliente HTTP do checkout transparente e do portal de assinatura. */
import type { CheckoutPaymentResult, CheckoutSummary, CreateCheckoutBody } from '@movivo/shared';

import { publicEnv } from './env';

const BASE = publicEnv.apiUrl;

/** Centavos inteiros → BRL (nativo, sem dependência). */
export function formatBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

export type ManageAction = 'cancel' | 'pause' | 'resume';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { ...init, cache: 'no-store' });
  if (!response.ok) throw new Error(`request_failed_${response.status}`);
  return (await response.json()) as T;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function getCheckoutSummary(token: string): Promise<CheckoutSummary> {
  return request<CheckoutSummary>(`/subscription/checkout/${encodeURIComponent(token)}`);
}

export function startCheckoutPayment(
  token: string,
  body: CreateCheckoutBody,
): Promise<CheckoutPaymentResult> {
  return post<CheckoutPaymentResult>(
    `/subscription/checkout/${encodeURIComponent(token)}/payment`,
    body,
  );
}

/** Cancela / pausa / retoma a assinatura self-service (US-4.5). */
export function manageSubscription(
  token: string,
  action: ManageAction,
): Promise<{ status: string }> {
  return post<{ status: string }>(`/subscription/${encodeURIComponent(token)}/${action}`);
}
