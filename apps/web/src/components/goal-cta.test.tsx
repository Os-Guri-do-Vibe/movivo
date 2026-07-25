/**
 * Testes do pré-qualifying de objetivo + CTA da landing (US-1.5, Sofia §9.1).
 *
 * Aserimos comportamento e semântica: a seleção reflete em `aria-pressed`, vira o
 * query param `goal` do link de anamnese, e o clique no CTA dispara `form_started`
 * no PostHog com o `primary_goal` correto — reutilizando o singleton já mockado.
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

import { GoalCta } from './goal-cta';

beforeEach(() => {
  capture.mockClear();
});

describe('GoalCta', () => {
  it('renderiza os três objetivos e o CTA', () => {
    render(<GoalCta />);
    expect(screen.getByRole('button', { name: 'Perder peso' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ganhar massa' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Condicionamento' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Começar agora' })).toHaveAttribute(
      'href',
      '/anamnese',
    );
  });

  it('seleciona um objetivo: marca aria-pressed e injeta o goal no link', async () => {
    const user = userEvent.setup();
    render(<GoalCta />);
    const chip = screen.getByRole('button', { name: 'Ganhar massa' });

    expect(chip).toHaveAttribute('aria-pressed', 'false');
    await user.click(chip);

    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('link', { name: 'Começar agora' })).toHaveAttribute(
      'href',
      '/anamnese?goal=ganhar_massa',
    );
  });

  it('dispara form_started com o objetivo escolhido ao clicar no CTA', async () => {
    const user = userEvent.setup();
    render(<GoalCta />);
    await user.click(screen.getByRole('button', { name: 'Perder peso' }));
    await user.click(screen.getByRole('link', { name: 'Começar agora' }));

    await waitFor(() =>
      expect(capture).toHaveBeenCalledWith('form_started', { primary_goal: 'perder_peso' }),
    );
  });

  it('dispara form_started com nao_informado quando nenhum objetivo foi escolhido', async () => {
    const user = userEvent.setup();
    render(<GoalCta />);
    await user.click(screen.getByRole('link', { name: 'Começar agora' }));

    await waitFor(() =>
      expect(capture).toHaveBeenCalledWith('form_started', { primary_goal: 'nao_informado' }),
    );
  });
});
