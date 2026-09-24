/**
 * Plano escolhido pelo visitante nesta visita à landing.
 *
 * Store mínimo (sem provider): o seletor de planos grava, os CTAs genéricos leem. Com
 * plano escolhido, "Começar 7 dias grátis" vai direto para a anamnese com ele; sem
 * escolha, rola até os planos. Nada é persistido — a fonte de verdade do plano continua
 * sendo o parâmetro `plano` que a anamnese já recebe.
 */
import { useSyncExternalStore } from 'react';

import type { SubscriptionPlanId } from '@movivo/shared';

type Listener = () => void;

let selected: SubscriptionPlanId | null = null;
const listeners = new Set<Listener>();

export function getSelectedPlan(): SubscriptionPlanId | null {
  return selected;
}

export function selectPlan(plan: SubscriptionPlanId | null): void {
  if (plan === selected) return;
  selected = plan;
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** No servidor não existe escolha: o HTML inicial sempre aponta para os planos. */
function getServerSnapshot(): null {
  return null;
}

export function useSelectedPlan(): SubscriptionPlanId | null {
  return useSyncExternalStore(subscribe, getSelectedPlan, getServerSnapshot);
}
