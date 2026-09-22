/**
 * Testes do CTA da landing (US-1.5, Sofia §9.1).
 *
 * A landing não coleta nada de anamnese: CTA genérico leva aos planos e o CTA de plano
 * leva à anamnese com o identificador escolhido; ambos disparam `form_started`.
 *
 * `@/lib/env` e `posthog-js` são mockados: `isAnalyticsEnabled` liga o caminho de
 * captura, e o default do PostHog expõe um spy em `capture`.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { capture, analytics } = vi.hoisted(() => ({ capture: vi.fn(), analytics: { on: true } }));

vi.mock('@/lib/env', () => ({
  get isAnalyticsEnabled() {
    return analytics.on;
  },
}));
vi.mock('posthog-js', () => ({ default: { capture } }));

import { StartCta } from './start-cta';

beforeEach(() => {
  capture.mockClear();
  analytics.on = true;
});

describe('StartCta', () => {
  it('CTA genérico aponta para a escolha de planos, sem coletar objetivo', () => {
    render(<StartCta />);
    expect(screen.getByRole('link', { name: 'Começar agora' })).toHaveAttribute('href', '#planos');
    expect(screen.queryByRole('button', { name: 'Perder peso' })).not.toBeInTheDocument();
  });

  it('CTA de plano preserva a escolha na navegação', () => {
    render(<StartCta plan="ANNUAL" />);
    expect(screen.getByRole('link', { name: 'Começar agora' })).toHaveAttribute(
      'href',
      '/anamnese?plano=ANNUAL',
    );
  });

  it('dispara form_started ao clicar no CTA', async () => {
    const user = userEvent.setup();
    render(<StartCta />);
    await user.click(screen.getByRole('link', { name: 'Começar agora' }));

    await waitFor(() => expect(capture).toHaveBeenCalledWith('form_started'));
  });

  it('sem analytics habilitado, o clique nunca chama o PostHog', async () => {
    analytics.on = false;
    const user = userEvent.setup();
    render(<StartCta />);
    await user.click(screen.getByRole('link', { name: 'Começar agora' }));
    expect(capture).not.toHaveBeenCalled();
  });
});
