/** Eventos da landing: nomes estáveis e nenhum envio sem analytics habilitado. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { capture, analytics } = vi.hoisted(() => ({ capture: vi.fn(), analytics: { on: true } }));

vi.mock('@/lib/env', () => ({
  get isAnalyticsEnabled() {
    return analytics.on;
  },
}));
vi.mock('posthog-js', () => ({ default: { capture } }));

import { LANDING_EVENTS, planSelectEvent, sectionViewEvent, trackLandingEvent } from './analytics';

beforeEach(() => {
  capture.mockClear();
  analytics.on = true;
});

describe('analytics da landing', () => {
  it('mantém os identificadores de evento do briefing', () => {
    expect(LANDING_EVENTS.heroStartTrial).toBe('hero_start_trial');
    expect(planSelectEvent('SEMIANNUAL')).toBe('pricing_select_semiannual');
    expect(sectionViewEvent('muscle_map')).toBe('section_view_muscle_map');
  });

  it('envia o evento com o plano quando o analytics está ativo', async () => {
    trackLandingEvent('pricing_start_trial', { plan: 'ANNUAL' });
    await vi.waitFor(() =>
      expect(capture).toHaveBeenCalledWith('pricing_start_trial', { plan: 'ANNUAL' }),
    );
  });

  it('sem analytics não carrega nem chama o PostHog', async () => {
    analytics.on = false;
    trackLandingEvent('hero_start_trial');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(capture).not.toHaveBeenCalled();
  });
});
