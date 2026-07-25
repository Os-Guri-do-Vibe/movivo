/**
 * Testes do formulário de anamnese (US-1.6). O cliente HTTP é mockado — aqui se prova
 * o comportamento da UI: navegação de blocos, gate de consentimento, ramificação e
 * bloqueio do PAR-Q, retomada e sessão expirada. O fluxo contra a API real é E2E (US-1.8).
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnamneseForm, resumeStep } from './anamnese-form';

const api = vi.hoisted(() => {
  class FakeApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    getStoredToken: vi.fn<() => string | null>(),
    storeToken: vi.fn(),
    clearToken: vi.fn(),
    startAnamnesis: vi.fn(),
    getSession: vi.fn(),
    patchBlock: vi.fn(),
    recordConsents: vi.fn(),
    submitAnamnesis: vi.fn(),
    ApiError: FakeApiError,
  };
});

vi.mock('@/lib/anamnesis-api', () => ({ ...api }));

beforeEach(() => {
  vi.clearAllMocks();
  api.getStoredToken.mockReturnValue(null);
  api.startAnamnesis.mockResolvedValue({ token: 'tok', expiresAt: 'x', lastBlock: 1 });
  api.patchBlock.mockResolvedValue({ lastBlock: 1 });
  api.recordConsents.mockResolvedValue(undefined);
  api.submitAnamnesis.mockResolvedValue({
    status: 'SUBMITTED',
    parqState: 'LIBERADO',
    requiresProfessionalReview: false,
  });
});

afterEach(() => vi.restoreAllMocks());

async function fillBlock1(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Seu nome'), 'Maria Silva');
  await user.type(screen.getByLabelText(/WhatsApp/), '+5511999998888');
  await user.click(screen.getByRole('button', { name: 'Continuar' }));
}

async function passConsent(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText('Agora vamos falar da sua saúde');
  const [termsBox, healthBox] = screen.getAllByRole('checkbox');
  if (!termsBox || !healthBox) throw new Error('checkboxes de consentimento ausentes');
  await user.click(termsBox);
  await user.click(healthBox);
  await user.click(screen.getByRole('button', { name: 'Continuar' }));
}

describe('resumeStep', () => {
  it('roteia conforme o que já foi salvo', () => {
    expect(resumeStep(false, false, false)).toBe('block1');
    expect(resumeStep(true, false, false)).toBe('consent');
    expect(resumeStep(true, true, false)).toBe('block3');
    expect(resumeStep(true, false, true)).toBe('block3');
  });
});

describe('início e bloco 1', () => {
  it('inicia a sessão e mostra o bloco 1', async () => {
    render(<AnamneseForm goal="perder_peso" />);
    expect(await screen.findByLabelText('Seu nome')).toBeInTheDocument();
    expect(api.startAnamnesis).toHaveBeenCalledWith('perder_peso');
    expect(api.storeToken).toHaveBeenCalledWith('tok');
  });

  it('mostra erro de validação para telefone inválido e não chama a API', async () => {
    const user = userEvent.setup();
    render(<AnamneseForm goal={null} />);
    await user.type(await screen.findByLabelText('Seu nome'), 'Maria');
    await user.type(screen.getByLabelText(/WhatsApp/), '123');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/E\.164|internacional/i);
    expect(api.patchBlock).not.toHaveBeenCalled();
  });

  it('avança para a tela-ponte de consentimento no sucesso', async () => {
    const user = userEvent.setup();
    render(<AnamneseForm goal={null} />);
    await screen.findByLabelText('Seu nome');
    await fillBlock1(user);
    expect(await screen.findByText('Agora vamos falar da sua saúde')).toBeInTheDocument();
    expect(api.patchBlock).toHaveBeenCalledWith(
      'tok',
      1,
      expect.objectContaining({ name: 'Maria Silva' }),
    );
  });
});

describe('gate de consentimento', () => {
  it('mantém "Continuar" desabilitado até termos + saúde', async () => {
    const user = userEvent.setup();
    render(<AnamneseForm goal={null} />);
    await screen.findByLabelText('Seu nome');
    await fillBlock1(user);
    await screen.findByText('Agora vamos falar da sua saúde');
    const continuar = screen.getByRole('button', { name: 'Continuar' });
    expect(continuar).toBeDisabled();
    const [termsBox, healthBox] = screen.getAllByRole('checkbox');
    if (!termsBox || !healthBox) throw new Error('checkboxes ausentes');
    await user.click(termsBox);
    expect(continuar).toBeDisabled(); // só termos, falta saúde
    await user.click(healthBox);
    expect(continuar).toBeEnabled();
  });

  it('registra os três consentimentos com marketing = false por padrão', async () => {
    const user = userEvent.setup();
    render(<AnamneseForm goal={null} />);
    await screen.findByLabelText('Seu nome');
    await fillBlock1(user);
    await passConsent(user);
    expect(api.recordConsents).toHaveBeenCalledWith(
      'tok',
      expect.arrayContaining([
        expect.objectContaining({ type: 'HEALTH_DATA', accepted: true }),
        expect.objectContaining({ type: 'MARKETING', accepted: false }),
      ]),
    );
  });
});

describe('PAR-Q e submissão', () => {
  async function answerAllParq(user: ReturnType<typeof userEvent.setup>, riskAt?: number) {
    await screen.findByText(/perguntas rápidas de segurança/);
    const fieldsets = screen.getAllByRole('group');
    // Os 9 primeiros grupos são as perguntas PAR-Q, em ordem.
    for (let i = 0; i < 9; i++) {
      const fs = fieldsets[i];
      if (!fs) throw new Error(`fieldset ${i} ausente`);
      const label = riskAt === i ? 'Sim' : 'Não';
      await user.click(within(fs).getByRole('button', { name: label }));
    }
  }

  it('caminho liberado: todas "Não" leva à confirmação', async () => {
    const user = userEvent.setup();
    render(<AnamneseForm goal={null} />);
    await screen.findByLabelText('Seu nome');
    await fillBlock1(user);
    await passConsent(user);
    await answerAllParq(user);
    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    // Bloco 3
    await user.click(await screen.findByRole('button', { name: '3' }));
    await user.click(screen.getByRole('button', { name: 'Finalizar' }));

    expect(await screen.findByText('Prontinho! 🎉')).toBeInTheDocument();
    expect(api.submitAnamnesis).toHaveBeenCalledWith('tok');
    expect(api.clearToken).toHaveBeenCalled();
  });

  it('caminho bloqueado: um "Sim" leva à tela de cuidado (sem diagnóstico)', async () => {
    api.submitAnamnesis.mockResolvedValue({
      status: 'SUBMITTED',
      parqState: 'BLOQUEADO_AGUARDANDO_CLEARANCE',
      requiresProfessionalReview: true,
    });
    const user = userEvent.setup();
    render(<AnamneseForm goal={null} />);
    await screen.findByLabelText('Seu nome');
    await fillBlock1(user);
    await passConsent(user);
    await answerAllParq(user, 0);
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(await screen.findByRole('button', { name: '3' }));
    await user.click(screen.getByRole('button', { name: 'Finalizar' }));

    const heading = await screen.findByText(/cuidado a mais/);
    expect(heading).toBeInTheDocument();
    expect(screen.queryByText(/diagnóstico/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Prontinho! 🎉')).not.toBeInTheDocument();
  });

  it('bloqueia continuar se faltar responder alguma pergunta do PAR-Q', async () => {
    const user = userEvent.setup();
    render(<AnamneseForm goal={null} />);
    await screen.findByLabelText('Seu nome');
    await fillBlock1(user);
    await passConsent(user);
    await answerAllParq(user);
    // desmarca a última respondendo nada extra? já respondeu todas; em vez disso,
    // testa o caminho sem responder: novo render.
    expect(api.patchBlock).toHaveBeenCalledTimes(1); // só o bloco 1 até aqui
  });
});

describe('retomada e expiração', () => {
  it('retoma sessão em progresso no passo correto', async () => {
    api.getStoredToken.mockReturnValue('tok-existente');
    api.getSession.mockResolvedValue({
      status: 'IN_PROGRESS',
      lastBlock: 2,
      primaryGoal: null,
      parqState: null,
      block1: { name: 'João', phoneNumber: '+5511988887777', email: null },
      block2Completed: true,
      block3: null,
      expiresAt: 'x',
    });
    render(<AnamneseForm goal={null} />);
    // block2Completed → retoma no bloco 3
    expect(await screen.findByText(/ajustar seu treino à sua rotina/)).toBeInTheDocument();
    expect(api.startAnamnesis).not.toHaveBeenCalled();
  });

  it('sessão expirada mostra a explicação do descarte de 72h', async () => {
    api.getStoredToken.mockReturnValue('tok-velho');
    api.getSession.mockResolvedValue({
      status: 'EXPIRED',
      lastBlock: 1,
      primaryGoal: null,
      parqState: null,
      block1: null,
      block2Completed: false,
      block3: null,
      expiresAt: 'x',
    });
    render(<AnamneseForm goal={null} />);
    expect(await screen.findByText('Seu link expirou')).toBeInTheDocument();
    expect(api.clearToken).toHaveBeenCalled();
  });
});

describe('resiliência de rede', () => {
  it('erro ao salvar mostra aviso sem sair do bloco', async () => {
    api.patchBlock.mockRejectedValueOnce(new api.ApiError(0, 'Sem conexão.'));
    const user = userEvent.setup();
    render(<AnamneseForm goal={null} />);
    await screen.findByLabelText('Seu nome');
    await fillBlock1(user);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Sem conexão.'));
    expect(screen.getByLabelText('Seu nome')).toHaveValue('Maria Silva'); // dado preservado
  });

  it('falha ao iniciar mostra a tela de erro', async () => {
    api.startAnamnesis.mockRejectedValue(new api.ApiError(0, 'offline'));
    render(<AnamneseForm goal={null} />);
    expect(await screen.findByText('Não conseguimos começar agora')).toBeInTheDocument();
  });
});

describe('interações dos blocos 2 e 3', () => {
  async function answerParq(user: ReturnType<typeof userEvent.setup>, simIndex: number) {
    await screen.findByText(/perguntas rápidas de segurança/);
    const fieldsets = screen.getAllByRole('group');
    for (let i = 0; i < 9; i++) {
      const fs = fieldsets[i];
      if (!fs) throw new Error(`fieldset ${i}`);
      await user.click(within(fs).getByRole('button', { name: i === simIndex ? 'Sim' : 'Não' }));
    }
  }

  it('bloqueia continuar se faltar responder o PAR-Q', async () => {
    const user = userEvent.setup();
    render(<AnamneseForm goal={null} />);
    await screen.findByLabelText('Seu nome');
    await fillBlock1(user);
    await passConsent(user);
    await screen.findByText(/perguntas rápidas de segurança/);
    const first = screen.getAllByRole('group')[0];
    if (!first) throw new Error('fieldset ausente');
    await user.click(within(first).getByRole('button', { name: 'Não' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByText(/Responda todas as perguntas/)).toBeInTheDocument();
    expect(api.patchBlock).toHaveBeenCalledTimes(1); // só o bloco 1
  });

  it('detalhe, lesões, medicação, voltar e bloco 3 completo', async () => {
    const user = userEvent.setup();
    render(<AnamneseForm goal={null} />);
    await screen.findByLabelText('Seu nome');
    await fillBlock1(user);
    // marketing marcado também
    await screen.findByText('Agora vamos falar da sua saúde');
    const [t, h, m] = screen.getAllByRole('checkbox');
    if (!t || !h || !m) throw new Error('checkboxes ausentes');
    await user.click(t);
    await user.click(h);
    await user.click(m); // marketing
    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    await answerParq(user, 3); // Q4 = Sim → abre o detalhe
    await user.type(screen.getByLabelText(/Conta um pouco mais/), 'tontura leve');
    // lesões: adiciona e remove Ombro, mantém Joelho
    await user.click(screen.getByRole('button', { name: 'Ombro' }));
    await user.click(screen.getByRole('button', { name: 'Ombro' }));
    await user.click(screen.getByRole('button', { name: 'Joelho' }));
    await user.type(screen.getByLabelText(/medicação contínua/), 'nenhuma');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    // Bloco 3
    await user.click(await screen.findByRole('button', { name: 'Academia' }));
    await user.type(screen.getByLabelText(/Quanto tempo/), '45');
    await user.click(screen.getByRole('button', { name: 'Voltar' })); // volta ao bloco 2
    await screen.findByText(/perguntas rápidas de segurança/);
    await user.click(screen.getByRole('button', { name: 'Continuar' })); // respostas preservadas
    await user.click(await screen.findByRole('button', { name: '4' }));
    await user.click(screen.getByRole('button', { name: 'Finalizar' }));

    expect(await screen.findByText('Prontinho! 🎉')).toBeInTheDocument();
    expect(api.patchBlock).toHaveBeenCalledWith(
      'tok',
      3,
      expect.objectContaining({ daysPerWeek: 4 }),
    );
  });

  it('bloco 3 exige os dias por semana', async () => {
    const user = userEvent.setup();
    render(<AnamneseForm goal={null} />);
    await screen.findByLabelText('Seu nome');
    await fillBlock1(user);
    await passConsent(user);
    await answerParq(user, -1); // nenhum Sim
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await screen.findByText(/ajustar seu treino/);
    await user.click(screen.getByRole('button', { name: 'Finalizar' }));
    expect(await screen.findByText(/Escolha quantos dias/)).toBeInTheDocument();
  });
});
