import { exampleParameters, methodologyDomainSpec } from '@movivo/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as StudioApi from '@/lib/methodology-studio-api';

const api = vi.hoisted(() => ({
  getVersions: vi.fn(),
  getDocument: vi.fn(),
  openDraft: vi.fn(),
  saveDraft: vi.fn(),
  testDraft: vi.fn(),
  getTestEstimate: vi.fn(),
  cancelTest: vi.fn(),
  publishDraft: vi.fn(),
  discardDraft: vi.fn(),
}));

vi.mock('@/lib/methodology-studio-api', async (importOriginal) => ({
  ...(await importOriginal<typeof StudioApi>()),
  ...api,
}));

import { MethodologyStudioError } from '@/lib/methodology-studio-api';

import { MethodologyStudioEditor } from './methodology-studio-editor';

const DRAFT_ID = '22222222-2222-4222-8222-222222222222';
const PUBLISHED_ID = '11111111-1111-4111-8111-111111111111';

function document(
  domain: 'RECOVERY' | 'STRENGTH',
  status: 'DRAFT' | 'TESTING' | 'PUBLISHED',
  minSleepHours = 6,
) {
  const parameters = exampleParameters(methodologyDomainSpec(domain));
  if (domain === 'RECOVERY') parameters.flags = { ...parameters.flags, minSleepHours };
  return {
    id: status === 'PUBLISHED' ? PUBLISHED_ID : DRAFT_ID,
    domain,
    version: status === 'PUBLISHED' ? 1 : 2,
    status,
    parameters,
    guidance: {},
    justifications: {},
    changeNote: 'Rascunho',
  };
}

const draftVersion = {
  id: DRAFT_ID,
  version: 2,
  status: 'DRAFT',
  changeNote: 'Rascunho',
  publishedAt: null,
  createdAt: '2026-10-27T12:00:00.000Z',
};
const publishedVersion = {
  id: PUBLISHED_ID,
  version: 1,
  status: 'PUBLISHED',
  changeNote: 'Primeira versão',
  publishedAt: '2026-10-20T12:00:00.000Z',
  createdAt: '2026-10-20T12:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getVersions.mockResolvedValue([draftVersion]);
  api.getDocument.mockResolvedValue({ document: document('RECOVERY', 'DRAFT'), diff: [] });
  api.getTestEstimate.mockResolvedValue({
    tasks: [{ taskId: 'recovery.analyze_week', cases: 2, estimatedBrl: 0.5 }],
    estimatedTotalBrl: 0.5,
    unknownTasks: 0,
    suggestedBudgetBrl: 2,
    model: 'deepseek-flash',
  });
});

/** O teste usa modelos reais: nada roda sem o clique de confirmação do gasto. */
async function confirmTest(trigger: HTMLElement) {
  await userEvent.click(trigger);
  await userEvent.click(await screen.findByRole('button', { name: /Testar \(limite/ }));
}

describe('estúdio de metodologia', () => {
  it('sem confirmar o gasto, o teste não chama modelo nenhum', async () => {
    render(<MethodologyStudioEditor domain="RECOVERY" canEdit />);
    await userEvent.click(await screen.findByRole('button', { name: /Testar com os agentes/ }));
    expect(await screen.findByText(/Custo estimado:/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Voltar e revisar' }));
    expect(api.testDraft).not.toHaveBeenCalled();
  });

  it('mostra cada campo com dica, faixa usual e o passo atual', async () => {
    render(<MethodologyStudioEditor domain="RECOVERY" canEdit />);

    expect(await screen.findByRole('heading', { name: 'Sono abaixo de' })).toBeInTheDocument();
    expect(screen.getByText(/Média de 3 noites abaixo disso/)).toBeInTheDocument();
    expect(screen.getAllByText('faixa usual 5–7 h').length).toBeGreaterThan(0);
    expect(screen.getByRole('spinbutton', { name: 'Sono abaixo de' })).toHaveValue(6);
    expect(
      within(screen.getByRole('list', { name: 'Etapas para publicar' })).getByText('Testar'),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: /Todas as metodologias/ })).toHaveAttribute(
      'href',
      '/dashboard/ia/metodologia',
    );
  });

  it('valor fora da faixa usual pede justificativa e bloqueia o teste', async () => {
    api.getDocument.mockResolvedValue({ document: document('RECOVERY', 'DRAFT', 8), diff: [] });
    render(<MethodologyStudioEditor domain="RECOVERY" canEdit />);

    expect(await screen.findByText(/Explique por que ele faz sentido/)).toBeInTheDocument();
    expect(
      screen.getByText('1 valor(es) fora da faixa usual precisam de justificativa.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/pendência\(s\) de justificativa/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Testar com os agentes/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ir para as justificativas' })).toBeEnabled();
  });

  it('editar um valor marca como não salvo e permite salvar', async () => {
    api.saveDraft.mockResolvedValue({ id: DRAFT_ID });
    render(<MethodologyStudioEditor domain="RECOVERY" canEdit />);
    const input = await screen.findByRole('spinbutton', { name: 'Sono abaixo de' });

    await userEvent.clear(input);
    await userEvent.type(input, '5');

    expect(screen.getAllByText('Alterações não salvas').length).toBeGreaterThan(0);
    expect(screen.getByText('Você tem alterações não salvas.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Salvar rascunho/ }));

    await waitFor(() =>
      expect(api.saveDraft).toHaveBeenCalledWith(
        DRAFT_ID,
        expect.objectContaining({
          parameters: expect.objectContaining({
            flags: expect.objectContaining({ minSleepHours: 5 }),
          }),
        }),
      ),
    );
    expect(await screen.findByText('Rascunho salvo.')).toBeInTheDocument();
  });

  it('testar leva à revisão e publicar exige confirmação', async () => {
    api.testDraft.mockResolvedValue({
      outcome: {
        passed: true,
        evaluations: [
          {
            taskId: 'recovery.analyze_week',
            passed: true,
            casesTotal: 4,
            casesPassed: 4,
            failures: [],
          },
        ],
        unjustified: [],
      },
      spentBrl: 0.42,
      stoppedReason: null,
    });
    api.publishDraft.mockResolvedValue({ id: DRAFT_ID });
    render(<MethodologyStudioEditor domain="RECOVERY" canEdit />);

    const testButton = await screen.findByRole('button', { name: /Testar com os agentes/ });
    // O recarregamento que acontece depois do teste já devolve o rascunho aprovado.
    api.getDocument.mockResolvedValue({ document: document('RECOVERY', 'TESTING'), diff: [] });
    await userEvent.click(testButton);
    // Antes de confirmar mostra o custo estimado e o limite, e nenhum modelo foi chamado ainda.
    expect(await screen.findByText(/cerca de R\$\s0,50/)).toBeVisible();
    expect(screen.getByText(/Limite de segurança:/)).toBeVisible();
    expect(screen.getByText(/deepseek-flash/)).toBeVisible();
    expect(api.testDraft).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Testar \(limite/ }));

    expect(await screen.findByText('Aprovada nos testes. Você já pode publicar.')).toBeVisible();
    expect(screen.getByText(/Gasto neste teste: R\$\s0,42/)).toBeVisible();
    expect(screen.getByText(/4 de 4 situações aprovadas/).closest('li')).toHaveTextContent(
      'Recuperação',
    );
    expect(api.testDraft).toHaveBeenCalledWith(DRAFT_ID, 2, expect.any(Function));

    api.getVersions.mockResolvedValue([publishedVersion]);
    api.getDocument.mockResolvedValue({ document: document('RECOVERY', 'PUBLISHED'), diff: [] });
    await userEvent.click(await screen.findByRole('button', { name: 'Publicar versão' }));
    expect(api.publishDraft).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Publicar agora' }));

    await waitFor(() => expect(api.publishDraft).toHaveBeenCalledWith(DRAFT_ID));
    expect(await screen.findByText(/Versão 2 publicada/)).toBeVisible();
  });

  it('mostra por que o teste não passou', async () => {
    api.testDraft.mockResolvedValue({
      outcome: {
        passed: false,
        evaluations: [
          {
            taskId: 'recovery.analyze_week',
            passed: false,
            casesTotal: 4,
            casesPassed: 1,
            failures: ['Pico de carga: não atendeu (não exagera nas leituras).'],
          },
        ],
        unjustified: [],
      },
      spentBrl: 0.1,
      stoppedReason:
        'O teste parou em «Recuperação: analisar a semana», que reprovou. Não rodei as outras tarefas para não gastar à toa (R$ 0,10 usados até aqui).',
    });
    render(<MethodologyStudioEditor domain="RECOVERY" canEdit />);

    await confirmTest(await screen.findByRole('button', { name: /Testar com os agentes/ }));

    expect(await screen.findByText('Ainda não pode publicar.')).toBeVisible();
    expect(screen.getByText(/O teste parou em «Recuperação: analisar a semana»/)).toBeVisible();
    expect(
      screen.getByText(/Pico de carga: não atendeu \(não exagera nas leituras\)/),
    ).toBeVisible();
    expect(screen.queryByText(/recovery\.analyze_week/)).not.toBeInTheDocument();
    expect(screen.getByText(/1 de 4 situações aprovadas/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Publicar versão' })).not.toBeInTheDocument();
  });

  it('descartar o rascunho pede confirmação e volta à versão em vigor', async () => {
    api.discardDraft.mockResolvedValue(undefined);
    render(<MethodologyStudioEditor domain="RECOVERY" canEdit />);

    await userEvent.click(await screen.findByRole('button', { name: 'Descartar' }));
    expect(api.discardDraft).not.toHaveBeenCalled();
    api.getVersions.mockResolvedValue([publishedVersion]);
    api.getDocument.mockResolvedValue({ document: document('RECOVERY', 'PUBLISHED'), diff: [] });
    await userEvent.click(screen.getByRole('button', { name: 'Sim, descartar' }));

    await waitFor(() => expect(api.discardDraft).toHaveBeenCalledWith(DRAFT_ID));
    expect(await screen.findByText(/Rascunho descartado/)).toBeVisible();
    expect(await screen.findByRole('button', { name: /Editar/ })).toBeEnabled();
  });

  it('versão em vigor: explica que nada muda até publicar e abre o rascunho', async () => {
    api.getVersions.mockResolvedValue([publishedVersion]);
    api.getDocument.mockResolvedValue({ document: document('RECOVERY', 'PUBLISHED'), diff: [] });
    api.openDraft.mockResolvedValue({ id: DRAFT_ID });
    render(<MethodologyStudioEditor domain="RECOVERY" canEdit />);

    expect(await screen.findByText(/Você está vendo a versão em vigor/)).toBeVisible();
    expect(screen.getByRole('spinbutton', { name: 'Sono abaixo de' })).toBeDisabled();
    api.getVersions.mockResolvedValue([draftVersion, publishedVersion]);
    api.getDocument.mockResolvedValue({ document: document('RECOVERY', 'DRAFT'), diff: [] });
    await userEvent.click(screen.getByRole('button', { name: /Editar/ }));

    await waitFor(() => expect(api.openDraft).toHaveBeenCalledWith('RECOVERY', undefined));
    expect(await screen.findByText(/Rascunho aberto/)).toBeVisible();
  });

  it('restaura uma versão anterior a partir do histórico', async () => {
    api.getVersions.mockResolvedValue([
      publishedVersion,
      { ...publishedVersion, id: 'old', version: 0, status: 'SUPERSEDED', changeNote: 'Antiga' },
    ]);
    api.getDocument.mockResolvedValue({ document: document('RECOVERY', 'PUBLISHED'), diff: [] });
    api.openDraft.mockResolvedValue({ id: DRAFT_ID });
    render(<MethodologyStudioEditor domain="RECOVERY" canEdit />);

    await userEvent.click(await screen.findByRole('button', { name: /Versões/ }));
    expect(screen.getByText('Antiga')).toBeVisible();
    const old = screen.getByText('Antiga').closest('li') as HTMLElement;
    await userEvent.click(within(old).getByRole('button', { name: /Restaurar/ }));

    await waitFor(() => expect(api.openDraft).toHaveBeenCalledWith('RECOVERY', 0));
  });

  it('sem versão publicada, oferece começar pelos exemplos', async () => {
    api.getVersions.mockResolvedValue([]);
    api.openDraft.mockResolvedValue({ id: DRAFT_ID });
    render(<MethodologyStudioEditor domain="RECOVERY" canEdit />);

    expect(await screen.findByText('Ainda não há versão publicada')).toBeVisible();
    api.getVersions.mockResolvedValue([draftVersion]);
    await userEvent.click(screen.getByRole('button', { name: /Começar a partir dos exemplos/ }));

    await waitFor(() => expect(api.openDraft).toHaveBeenCalled());
  });

  it('sem permissão de edição, só consulta: sem ações e campos travados', async () => {
    render(<MethodologyStudioEditor domain="RECOVERY" canEdit={false} />);

    await screen.findByRole('heading', { name: 'Sono abaixo de' });
    expect(screen.getByText(/Somente profissionais autorizados editam e publicam/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /Testar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Salvar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Revisar e publicar/ })).not.toBeInTheDocument();
  });

  it('mostra o erro do servidor com os campos afetados', async () => {
    api.saveDraft.mockRejectedValue(
      new MethodologyStudioError(400, 'Alguns valores não puderam ser salvos.', [
        {
          path: 'flags.minSleepHours',
          message: 'Sinais · Sono abaixo de: está acima do limite máximo de 12 h.',
        },
      ]),
    );
    render(<MethodologyStudioEditor domain="RECOVERY" canEdit />);
    const input = await screen.findByRole('spinbutton', { name: 'Sono abaixo de' });
    await userEvent.clear(input);
    await userEvent.type(input, '5');
    await userEvent.click(screen.getByRole('button', { name: /Salvar rascunho/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Alguns valores não puderam ser salvos. Sinais · Sono abaixo de: está acima do limite máximo de 12 h.',
    );
  });

  it('domínio com várias seções: navega entre elas e edita células de tabela', async () => {
    const strength = document('STRENGTH', 'DRAFT');
    api.getDocument.mockResolvedValue({ document: strength, diff: [] });
    render(<MethodologyStudioEditor domain="STRENGTH" canEdit />);

    expect(
      await screen.findByRole('heading', { name: 'Séries por grupo muscular por semana' }),
    ).toBeVisible();
    const minimum = screen.getByRole('spinbutton', { name: 'Iniciante, Séries/semana, mínimo' });
    await userEvent.clear(minimum);
    await userEvent.type(minimum, '7');
    expect(screen.getAllByText('Alterações não salvas').length).toBeGreaterThan(0);

    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Partes do documento' })).getByRole('button', {
        name: /Intensidade e repetições/,
      }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Repetições em reserva por fase' }),
    ).toBeVisible();
    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Partes do documento' })).getByRole('button', {
        name: 'Volume',
      }),
    );
    expect(
      screen.getByRole('spinbutton', { name: 'Iniciante, Séries/semana, mínimo' }),
    ).toHaveValue(7);
  });
});
