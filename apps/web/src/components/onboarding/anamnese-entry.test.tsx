/**
 * Entrada do onboarding: a URL fica só `/anamnese` e o token não passa pelo cliente.
 * CTA com plano abre cadastro novo; sem plano, o F5 retoma a sessão do cookie (BFF);
 * sessão inexistente ou expirada recomeça; falha de rede não descarta o progresso.
 */
import { render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AnamnesisApi from '@/lib/anamnesis-api';

const { getSession, startAnamnesis } = vi.hoisted(() => ({
  getSession: vi.fn(),
  startAnamnesis: vi.fn(),
}));

vi.mock('@/lib/anamnesis-api', async (importOriginal) => ({
  ...(await importOriginal<typeof AnamnesisApi>()),
  getSession,
  startAnamnesis,
}));
vi.mock('@/lib/first-touch', () => ({ captureFirstTouch: vi.fn() }));
vi.mock('./onboarding-wizard', () => ({
  OnboardingWizard: ({
    sessionRef,
    initial,
  }: {
    sessionRef: string;
    initial: { currentStep: number };
  }) => (
    <p>
      wizard {sessionRef} etapa {initial.currentStep}
    </p>
  ),
}));

import { AnamnesisApiError } from '@/lib/anamnesis-api';

import { AnamneseEntry } from './anamnese-entry';

function entry(ref: string, currentStep: number, status = 'IN_PROGRESS') {
  return { ref, session: { status, currentStep } };
}

beforeEach(() => {
  getSession.mockReset();
  startAnamnesis.mockReset();
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('AnamneseEntry', () => {
  it('CTA com plano: abre cadastro novo com o plano e deixa a URL só /anamnese', async () => {
    window.history.replaceState(null, '', '/anamnese?plano=ANNUAL');
    startAnamnesis.mockResolvedValue(entry('ref-nova', 1));

    render(<AnamneseEntry />);

    expect(await screen.findByText('wizard ref-nova etapa 1')).toBeInTheDocument();
    expect(startAnamnesis).toHaveBeenCalledWith('ANNUAL');
    expect(getSession).not.toHaveBeenCalled();
    expect(window.location.pathname + window.location.search).toBe('/anamnese');
  });

  it('Strict Mode não abre dois cadastros (cookie e aba ficariam em sessões diferentes)', async () => {
    window.history.replaceState(null, '', '/anamnese?plano=QUARTERLY');
    startAnamnesis.mockResolvedValue(entry('ref-nova', 1));

    render(
      <StrictMode>
        <AnamneseEntry />
      </StrictMode>,
    );

    expect(await screen.findByText('wizard ref-nova etapa 1')).toBeInTheDocument();
    expect(startAnamnesis).toHaveBeenCalledTimes(1);
  });

  it('F5 sem plano: retoma a sessão do cookie na etapa salva, sem abrir outra', async () => {
    window.history.replaceState(null, '', '/anamnese');
    getSession.mockResolvedValue(entry('ref-salva', 2));

    render(<AnamneseEntry />);

    expect(await screen.findByText('wizard ref-salva etapa 2')).toBeInTheDocument();
    expect(startAnamnesis).not.toHaveBeenCalled();
  });

  it('sem cadastro em andamento (404) começa um novo', async () => {
    window.history.replaceState(null, '', '/anamnese');
    getSession.mockRejectedValue(new AnamnesisApiError(404, []));
    startAnamnesis.mockResolvedValue(entry('ref-nova', 1));

    render(<AnamneseEntry />);

    expect(await screen.findByText('wizard ref-nova etapa 1')).toBeInTheDocument();
    expect(startAnamnesis).toHaveBeenCalledWith('MONTHLY');
  });

  it('sessão expirada também recomeça', async () => {
    window.history.replaceState(null, '', '/anamnese');
    getSession.mockResolvedValue(entry('ref-velha', 2, 'EXPIRED'));
    startAnamnesis.mockResolvedValue(entry('ref-nova', 1));

    render(<AnamneseEntry />);

    expect(await screen.findByText('wizard ref-nova etapa 1')).toBeInTheDocument();
  });

  it('falha de rede na retomada mostra o erro e não abre outro cadastro', async () => {
    window.history.replaceState(null, '', '/anamnese');
    getSession.mockRejectedValue(new TypeError('Failed to fetch'));

    render(<AnamneseEntry />);

    expect(
      await screen.findByRole('heading', { name: 'Não conseguimos começar agora' }),
    ).toBeInTheDocument();
    expect(startAnamnesis).not.toHaveBeenCalled();
  });
});
