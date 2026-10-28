import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AnamnesisApi from '@/lib/anamnesis-api';
import type { SessionView } from '@/lib/anamnesis-api';

const resumeComplementary = vi.fn();

vi.mock('@/lib/anamnesis-api', async () => ({
  ...(await vi.importActual<typeof AnamnesisApi>('@/lib/anamnesis-api')),
  resumeComplementary: (...args: unknown[]) => resumeComplementary(...args),
}));

import { ComplementaryEntry } from './complementary-entry';

const TOKEN = 'a'.repeat(64);
const SESSION: SessionView = {
  status: 'IN_PROGRESS',
  flow: 'COMPLEMENTARY',
  currentStep: 2,
  completedSteps: [],
  phoneVerified: true,
  primaryGoal: null,
  consents: [],
  consentsPending: false,
  blocks: {},
  outcome: null,
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
};

beforeEach(() => {
  resumeComplementary.mockReset();
  window.history.replaceState(null, '', '/anamnese/complementar');
});

describe('ComplementaryEntry', () => {
  it('entrega o token do fragmento ao BFF, limpa a barra de endereço e abre o formulário', async () => {
    resumeComplementary.mockResolvedValue({ ref: 'ref', session: SESSION });
    window.history.replaceState(null, '', `/anamnese/complementar#token=${TOKEN}`);
    render(<ComplementaryEntry />);
    expect(await screen.findByText('Qual é o seu objetivo?')).toBeInTheDocument();
    expect(resumeComplementary).toHaveBeenCalledWith(TOKEN);
    expect(window.location.hash).toBe('');
  });

  it('sem token no fragmento, pede para abrir o link do WhatsApp e não chama a API', async () => {
    render(<ComplementaryEntry />);
    expect(await screen.findByText('Este link não está completo')).toBeInTheDocument();
    expect(resumeComplementary).not.toHaveBeenCalled();
  });

  it('token em formato inválido nem chega à API', async () => {
    window.history.replaceState(null, '', '/anamnese/complementar#token=abc');
    render(<ComplementaryEntry />);
    expect(await screen.findByText('Este link não está completo')).toBeInTheDocument();
    expect(resumeComplementary).not.toHaveBeenCalled();
  });

  it('link expirado mostra como pedir outro', async () => {
    resumeComplementary.mockRejectedValue(new Error('410'));
    window.history.replaceState(null, '', `/anamnese/complementar#token=${TOKEN}`);
    render(<ComplementaryEntry />);
    await waitFor(() =>
      expect(screen.getByText('Não conseguimos abrir seu formulário')).toBeInTheDocument(),
    );
  });
});
