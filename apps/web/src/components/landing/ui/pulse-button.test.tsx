/**
 * CTAs da landing: preservam o fluxo existente (sem plano → planos; com plano →
 * `/anamnese?plano=ID`) e só disparam `form_started` quando o clique vai à anamnese.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AnalyticsModule from '@/lib/landing/analytics';

const { track } = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('@/lib/landing/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof AnalyticsModule>()),
  trackLandingEvent: track,
}));

import { selectPlan } from '@/lib/landing/plan-selection';

import { PulseLink, TrialCta } from './pulse-button';

beforeEach(() => track.mockClear());
afterEach(() => selectPlan(null));

describe('TrialCta', () => {
  it('sem plano escolhido, leva à escolha de planos', async () => {
    const user = userEvent.setup();
    render(<TrialCta event="hero_start_trial">Começar 7 dias grátis</TrialCta>);
    const link = screen.getByRole('link', { name: /Começar 7 dias grátis/ });
    expect(link).toHaveAttribute('href', '#planos');
    expect(link).toHaveAttribute('data-analytics-event', 'hero_start_trial');
    await user.click(link);
    expect(track).toHaveBeenCalledWith('hero_start_trial', undefined);
    expect(track).not.toHaveBeenCalledWith('form_started', expect.anything());
  });

  it('com plano fixo, preserva o plano até a anamnese e marca o início do funil', async () => {
    const user = userEvent.setup();
    const onTrack = vi.fn();
    render(
      <TrialCta event="pricing_start_trial" plan="ANNUAL" onTrack={onTrack}>
        Começar
      </TrialCta>,
    );
    const link = screen.getByRole('link', { name: /Começar/ });
    expect(link).toHaveAttribute('href', '/anamnese?plano=ANNUAL');
    await user.click(link);
    expect(onTrack).toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith('pricing_start_trial', { plan: 'ANNUAL' });
    expect(track).toHaveBeenCalledWith('form_started', { plan: 'ANNUAL' });
  });

  it('CTAs genéricos passam a usar o plano escolhido na visita', () => {
    render(<TrialCta event="sticky_mobile_start_trial">Começar</TrialCta>);
    expect(screen.getByRole('link')).toHaveAttribute('href', '#planos');
    act(() => selectPlan('QUARTERLY'));
    expect(screen.getByRole('link')).toHaveAttribute('href', '/anamnese?plano=QUARTERLY');
  });

  it('inclui o complemento para leitor de tela no nome acessível', () => {
    render(
      <TrialCta event="final_start_trial" srSuffix=": começar 7 dias grátis">
        Start moving
      </TrialCta>,
    );
    expect(screen.getByRole('link', { name: 'Start moving: começar 7 dias grátis' })).toBeVisible();
  });
});

describe('PulseLink', () => {
  it('rastreia o clique numa âncora', async () => {
    const user = userEvent.setup();
    render(
      <PulseLink href="#manifesto" event="hero_learn_more" variant="secondary" arrow={false}>
        Conheça a MOVIVO
      </PulseLink>,
    );
    await user.click(screen.getByRole('link', { name: 'Conheça a MOVIVO' }));
    expect(track).toHaveBeenCalledWith('hero_learn_more');
  });
});
