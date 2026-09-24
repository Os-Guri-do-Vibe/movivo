/**
 * Eventos da landing — utilitário central sobre o PostHog já inicializado em
 * `instrumentation-client.ts`.
 *
 * Mesmas garantias do resto do app: sem key válida nada é importado nem enviado, o
 * SDK é carregado sob demanda (fora do caminho crítico) e nenhuma propriedade carrega
 * dado pessoal — só o identificador do evento e, quando existe, o plano escolhido.
 */
import type { SubscriptionPlanId } from '@movivo/shared';

import { isAnalyticsEnabled } from '@/lib/env';

export const LANDING_EVENTS = {
  heroStartTrial: 'hero_start_trial',
  heroLearnMore: 'hero_learn_more',
  navStartTrial: 'nav_start_trial',
  howItWorksStart: 'how_it_works_start',
  pricingStartTrial: 'pricing_start_trial',
  stickyMobileStartTrial: 'sticky_mobile_start_trial',
  finalStartTrial: 'final_start_trial',
  footerStartTrial: 'footer_start_trial',
} as const;

export type LandingCtaEvent = (typeof LANDING_EVENTS)[keyof typeof LANDING_EVENTS];

export const LANDING_SECTIONS = [
  'hero',
  'pulse',
  'whatsapp',
  'how_it_works',
  'human',
  'muscle_map',
  'adaptive',
  'day',
  'club',
  'pricing',
] as const;

export type LandingSection = (typeof LANDING_SECTIONS)[number];

export type PlanSelectEvent = `pricing_select_${Lowercase<SubscriptionPlanId>}`;
export type SectionViewEvent = `section_view_${LandingSection}`;

export type LandingEvent =
  | LandingCtaEvent
  | PlanSelectEvent
  | SectionViewEvent
  /** Evento de funil pré-existente (US-1.5): o visitante saiu da landing rumo à anamnese. */
  | 'form_started';

export function planSelectEvent(plan: SubscriptionPlanId): PlanSelectEvent {
  return `pricing_select_${plan.toLowerCase() as Lowercase<SubscriptionPlanId>}`;
}

export function sectionViewEvent(section: LandingSection): SectionViewEvent {
  return `section_view_${section}`;
}

export function trackLandingEvent(
  event: LandingEvent,
  properties?: { plan?: SubscriptionPlanId },
): void {
  if (!isAnalyticsEnabled) return;
  void import('posthog-js')
    .then(({ default: posthog }) => {
      posthog.capture(event, properties);
    })
    // Analytics nunca derruba a página nem a navegação.
    .catch(() => undefined);
}
