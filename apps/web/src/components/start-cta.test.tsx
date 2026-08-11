/**
 * Testes do CTA da landing (US-1.5, Sofia §9.1).
 *
 * A landing não coleta nada de anamnese: o CTA leva direto a `/anamnese`, sem query
 * param, e o clique dispara `form_started` no PostHog.
 *
 * `@/lib/env` e `posthog-js` são mockados: `isAnalyticsEnabled` liga o caminho de
 * captura, e o default do PostHog expõe um spy em `capture`.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const capture = vi.fn();

vi.mock('@/lib/env', () => ({ isAnalyticsEnabled: true }));
vi.mock('posthog-js', () => ({ default: { capture } }));

import { StartCta } from './start-cta';

beforeEach(() => {
  capture.mockClear();
});

describe('StartCta', () => {
  it('renderiza o CTA apontando para a anamnese, sem coletar objetivo', () => {
    render(<StartCta />);
    expect(screen.getByRole('link', { name: 'Começar agora' })).toHaveAttribute(
      'href',
      '/anamnese',
    );
    expect(screen.queryByRole('button', { name: 'Perder peso' })).not.toBeInTheDocument();
  });

  it('dispara form_started ao clicar no CTA', async () => {
    const user = userEvent.setup();
    render(<StartCta />);
    await user.click(screen.getByRole('link', { name: 'Começar agora' }));

    await waitFor(() => expect(capture).toHaveBeenCalledWith('form_started'));
  });
});
