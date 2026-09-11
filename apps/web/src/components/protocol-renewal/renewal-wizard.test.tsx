import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type * as ProtocolRenewalApi from '@/lib/protocol-renewal-api';
import type { RenewalSessionView } from '@/lib/protocol-renewal-api';
import { ProtocolRenewalApiError } from '@/lib/protocol-renewal-api';
import { RenewalWizard } from './renewal-wizard';

const { patchRenewalStep, submitRenewal } = vi.hoisted(() => ({
  patchRenewalStep: vi.fn(async () => ({ currentStep: 2 })),
  submitRenewal: vi.fn(async () => ({ status: 'SUBMITTED' as const })),
}));

vi.mock('@/lib/protocol-renewal-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ProtocolRenewalApi>()),
  patchRenewalStep,
  submitRenewal,
}));

const TOKEN = 'tok-123';

const FRESH: RenewalSessionView = {
  status: 'IN_PROGRESS',
  currentStep: 1,
  firstName: 'Maria',
  hasTargetEvent: false,
  block1: null,
  block2: null,
  block3Completed: false,
  block4: null,
  block5: null,
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
};

/** Retomada com blocos 1/2/4/5 já salvos numa visita anterior (nunca o 3 — dado de saúde). */
const RESUMED_AT_BLOCK5: RenewalSessionView = {
  ...FRESH,
  currentStep: 5,
  block1: {
    completionRate: 'SEMPRE',
    actualFrequency: 'TODOS_OS_DIAS_PLANEJADOS',
    loadProgression: 'EVOLUI_NA_MAIORIA',
    perceivedEffort: 'SOBRAVA_BASTANTE',
  },
  block2: {
    fatigueLevel: 'BAIXO_RECUPERADO',
    sleepQuality: 'BOA',
    stressLevel: 'BAIXO',
    muscleSoreness: 'NORMAL',
  },
  block4: { currentWeightKg: 78, goalProgress: 'DENTRO_DO_ESPERADO', satisfaction: 8 },
  block5: {
    changes: ['NONE'],
    dislikedExercise: { has: false, description: '' },
    barriers: [],
    goalChange: { changed: false },
  },
};

describe('RenewalWizard — introdução', () => {
  it('sessão nova (currentStep 1) mostra a intro com o primeiro nome', () => {
    render(<RenewalWizard token={TOKEN} initial={FRESH} />);
    expect(
      screen.getByRole('heading', { name: /Olá, Maria! Vamos preparar seu próximo protocolo\./ }),
    ).toBeInTheDocument();
  });

  it('sem firstName cai no genérico "você"', () => {
    render(<RenewalWizard token={TOKEN} initial={{ ...FRESH, firstName: null }} />);
    expect(screen.getByRole('heading', { name: /Olá, você!/ })).toBeInTheDocument();
  });

  it('retomada (currentStep > 1) pula a intro direto pro bloco salvo', () => {
    render(<RenewalWizard token={TOKEN} initial={RESUMED_AT_BLOCK5} />);
    expect(screen.queryByText(/Vamos preparar seu próximo protocolo/)).not.toBeInTheDocument();
    expect(screen.getByText('Algo mudou desde o início deste ciclo?')).toBeInTheDocument();
  });

  it('"Começar" sai da intro e entra no bloco 1', async () => {
    const user = userEvent.setup();
    render(<RenewalWizard token={TOKEN} initial={FRESH} />);
    await user.click(screen.getByRole('button', { name: 'Começar' }));
    expect(
      screen.getByText(
        'Nas últimas semanas, você conseguiu completar as séries e repetições planejadas?',
      ),
    ).toBeInTheDocument();
  });
});

describe('RenewalWizard — bloco 1: salva e avança, ou mostra erro', () => {
  async function answerBlock1() {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Começar' }));
    await user.click(screen.getByRole('radio', { name: 'Sempre' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('radio', { name: 'Todos os dias planejados' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(
      screen.getByRole('radio', { name: 'Consegui evoluir na maioria dos exercícios' }),
    );
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('radio', { name: 'Sobrava bastante, fácil' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
  }

  it('sucesso: chama patchRenewalStep com o token/bloco 1 e avança pro bloco 2', async () => {
    patchRenewalStep.mockResolvedValueOnce({ currentStep: 2 });
    render(<RenewalWizard token={TOKEN} initial={FRESH} />);
    await answerBlock1();
    expect(patchRenewalStep).toHaveBeenCalledWith(TOKEN, 1, {
      completionRate: 'SEMPRE',
      actualFrequency: 'TODOS_OS_DIAS_PLANEJADOS',
      loadProgression: 'EVOLUI_NA_MAIORIA',
      perceivedEffort: 'SOBRAVA_BASTANTE',
    });
    expect(
      await screen.findByText('Como está seu nível de fadiga acumulada nas últimas semanas?'),
    ).toBeInTheDocument();
  });

  it('erro de rede: mostra alerta genérico e não avança de bloco', async () => {
    patchRenewalStep.mockRejectedValueOnce(new Error('network down'));
    render(<RenewalWizard token={TOKEN} initial={FRESH} />);
    await answerBlock1();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não conseguimos salvar suas respostas. Confira os campos e tente de novo.',
    );
    expect(
      screen.getByText(
        'De forma geral, como estava seu esforço ao final da maioria das séries de trabalho?',
      ),
    ).toBeInTheDocument();
  });
});

describe('RenewalWizard — bloco 2: salva e avança pro bloco 3', () => {
  it('sucesso: chama patchRenewalStep com o bloco 2 hidratado do servidor', async () => {
    const user = userEvent.setup();
    render(<RenewalWizard token={TOKEN} initial={{ ...RESUMED_AT_BLOCK5, currentStep: 2 }} />);
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(patchRenewalStep).toHaveBeenCalledWith(TOKEN, 2, {
      fatigueLevel: 'BAIXO_RECUPERADO',
      sleepQuality: 'BOA',
      stressLevel: 'BAIXO',
      muscleSoreness: 'NORMAL',
    });
    expect(
      await screen.findByText(
        'Você sentiu alguma dor, desconforto ou limitação NOVA durante os treinos deste ciclo — algo que não tinha antes?',
      ),
    ).toBeInTheDocument();
  });

  it('erro de rede: mostra alerta e permanece no bloco 2', async () => {
    const user = userEvent.setup();
    patchRenewalStep.mockRejectedValueOnce(new Error('boom'));
    render(<RenewalWizard token={TOKEN} initial={{ ...RESUMED_AT_BLOCK5, currentStep: 2 }} />);
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('RenewalWizard — bloco 4: salva e avança pro bloco 5', () => {
  it('sucesso: salva o bloco 4 (peso convertido pra número) e avança pro bloco 5', async () => {
    const user = userEvent.setup();
    render(<RenewalWizard token={TOKEN} initial={{ ...RESUMED_AT_BLOCK5, currentStep: 4 }} />);
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(patchRenewalStep).toHaveBeenCalledWith(TOKEN, 4, {
      currentWeightKg: 78,
      goalProgress: 'DENTRO_DO_ESPERADO',
      satisfaction: 8,
    });
    expect(await screen.findByText('Algo mudou desde o início deste ciclo?')).toBeInTheDocument();
  });
});

describe('RenewalWizard — retomada em bloco intermediário: "Voltar" navega pro bloco anterior salvo', () => {
  it('Voltar no bloco 2 leva pro bloco 1, na última pergunta já respondida', async () => {
    const user = userEvent.setup();
    render(<RenewalWizard token={TOKEN} initial={{ ...RESUMED_AT_BLOCK5, currentStep: 2 }} />);
    expect(
      screen.getByText('Como está seu nível de fadiga acumulada nas últimas semanas?'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(
      screen.getByText(
        'De forma geral, como estava seu esforço ao final da maioria das séries de trabalho?',
      ),
    ).toBeInTheDocument();
  });
});

describe('RenewalWizard — bloco 5: envio final e tratamento de erro', () => {
  /** Dados de `RESUMED_AT_BLOCK5.block5` já completos: só avança pelas 4 perguntas até o envio. */
  async function answerAndSubmitBlock5() {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: 'Enviar formulário' }));
  }

  it('sucesso: salva o bloco 5, envia e mostra a tela de sucesso', async () => {
    render(<RenewalWizard token={TOKEN} initial={RESUMED_AT_BLOCK5} />);
    await answerAndSubmitBlock5();
    expect(
      await screen.findByRole('heading', { name: /Recebemos suas respostas, Maria!/ }),
    ).toBeInTheDocument();
    expect(patchRenewalStep).toHaveBeenCalledWith(
      TOKEN,
      5,
      expect.objectContaining({ changes: ['NONE'] }),
    );
    expect(submitRenewal).toHaveBeenCalledWith(TOKEN);
  });

  it('sessão expirada (410): mostra mensagem de recarregar a página', async () => {
    submitRenewal.mockRejectedValueOnce(new ProtocolRenewalApiError(410, []));
    render(<RenewalWizard token={TOKEN} initial={RESUMED_AT_BLOCK5} />);
    await answerAndSubmitBlock5();
    expect(await screen.findByRole('alert')).toHaveTextContent(/Sua sessão expirou/);
  });

  it('já enviado (409): mostra mensagem de recarregar a página', async () => {
    submitRenewal.mockRejectedValueOnce(new ProtocolRenewalApiError(409, []));
    render(<RenewalWizard token={TOKEN} initial={RESUMED_AT_BLOCK5} />);
    await answerAndSubmitBlock5();
    expect(await screen.findByRole('alert')).toHaveTextContent(/já tinha sido enviado/);
  });

  it('validação (400) com issue do backend: mostra a issue', async () => {
    submitRenewal.mockRejectedValueOnce(new ProtocolRenewalApiError(400, ['Informe a região.']));
    render(<RenewalWizard token={TOKEN} initial={RESUMED_AT_BLOCK5} />);
    await answerAndSubmitBlock5();
    expect(await screen.findByRole('alert')).toHaveTextContent('Informe a região.');
  });

  it('validação (400) sem issues: cai na mensagem genérica', async () => {
    submitRenewal.mockRejectedValueOnce(new ProtocolRenewalApiError(400, []));
    render(<RenewalWizard token={TOKEN} initial={RESUMED_AT_BLOCK5} />);
    await answerAndSubmitBlock5();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não conseguimos enviar suas respostas. Tente de novo em instantes.',
    );
  });

  it('outro status da API: cai na mensagem genérica', async () => {
    submitRenewal.mockRejectedValueOnce(new ProtocolRenewalApiError(500, []));
    render(<RenewalWizard token={TOKEN} initial={RESUMED_AT_BLOCK5} />);
    await answerAndSubmitBlock5();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não conseguimos enviar suas respostas. Tente de novo em instantes.',
    );
  });

  it('erro que não é ProtocolRenewalApiError: cai na mensagem genérica', async () => {
    submitRenewal.mockRejectedValueOnce(new Error('boom'));
    render(<RenewalWizard token={TOKEN} initial={RESUMED_AT_BLOCK5} />);
    await answerAndSubmitBlock5();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não conseguimos enviar suas respostas. Tente de novo em instantes.',
    );
  });
});

describe('RenewalWizard — pergunta 18 (data-alvo) quando hasTargetEvent', () => {
  it('inclui targetEvent no payload do bloco 5 quando hasTargetEvent é true', async () => {
    const user = userEvent.setup();
    const withTargetEvent: RenewalSessionView = {
      ...RESUMED_AT_BLOCK5,
      hasTargetEvent: true,
      block5: {
        ...(RESUMED_AT_BLOCK5.block5 as object),
        targetEvent: { status: 'STILL_ON' },
      },
    };
    render(<RenewalWizard token={TOKEN} initial={withTargetEvent} />);
    expect(screen.getByText('Algo mudou desde o início deste ciclo?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByText('Sua data-alvo/evento ainda está de pé?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Enviar formulário' }));
    expect(patchRenewalStep).toHaveBeenCalledWith(
      TOKEN,
      5,
      expect.objectContaining({ targetEvent: { status: 'STILL_ON', newDate: undefined } }),
    );
  });
});
