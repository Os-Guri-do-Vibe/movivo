import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AnamnesisAnswersView,
  ExceptionDetail as ExceptionDetailData,
  ProtocolReview,
} from '@movivo/shared';

import type * as ControlCenterApi from '@/lib/control-center-api';

const api = vi.hoisted(() => ({
  getException: vi.fn(),
  getExceptionDecisions: vi.fn(),
  getExceptionProtocol: vi.fn(),
  getExceptionAnamnesis: vi.fn(),
  approveException: vi.fn(),
  rejectException: vi.fn(),
  requestProtocolAdjustment: vi.fn(),
  regenerateProtocol: vi.fn(),
}));
const push = vi.hoisted(() => vi.fn());
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  ...api,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { ExceptionDetail } from './exception-detail';

const ID = '11111111-1111-4111-8111-111111111111';

function detail(overrides: Partial<ExceptionDetailData['case']> = {}): ExceptionDetailData {
  return {
    case: {
      id: ID,
      kind: 'PROTOCOL_REVIEW',
      priority: 'NORMAL',
      status: 'OPEN',
      domain: 'TRAINING',
      summary:
        'Protocolo gerado pela IA aguardando revisão. política de autonomia v1: PUBLISH_TRAINING_PLAN = AUTO mudança no protocolo na fila do profissional: revisão opcional, liberada após a janela Proponho A na terça.',
      createdAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
      assignedStaffId: null,
      reviewUrgency: 'OPTIONAL',
      autoReleaseAt: new Date(Date.now() + 102 * 60_000 - 30_000).toISOString(),
      userId: '22222222-2222-4222-8222-222222222222',
      resolution: null,
      resolvedAt: null,
      canResolve: true,
      ...overrides,
    },
    student: {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Ana Souza',
      timezone: 'America/Sao_Paulo',
    },
    proposal: {
      id: '33333333-3333-4333-8333-333333333333',
      actionType: 'PUBLISH_TRAINING_PLAN',
      action: { type: 'PUBLISH_TRAINING_PLAN', planId: '55555555-5555-4555-8555-555555555555' },
      rationale: [
        'Proponho A na terça, B na quinta e C no sábado.',
        'Corridas leves na quarta e na sexta.',
        'A sessão C fica com esforço moderado.',
        'Avaliação postural por foto (leitura da IA, para auditoria): Cabeça e cervical: Cabeça discretamente à frente do tronco; Ombros: simétricos.',
        'Coordenador: Antes da validação, confirmar carga recente. Ver o acompanhamento do hipotireoidismo.',
      ],
      evidence: [],
      assumptions: ['Treina em academia completa.'],
      uncertainty: 'MEDIUM',
      expectedOutcome: 'Adesão acima de 80% em quatro semanas.',
      status: 'PENDING',
    },
    decision: {
      id: '44444444-4444-4444-8444-444444444444',
      verdict: 'ASK',
      reasons: [
        'política de autonomia v1: PUBLISH_TRAINING_PLAN = AUTO',
        'mudança no protocolo na fila do profissional: revisão opcional, liberada após a janela',
      ],
      decidedBy: 'POLICY_ENGINE',
    },
    safety: null,
    state: {
      goals: { declared: { primary: 'FAT_LOSS' }, strategy: { title: 'Perda de gordura' } },
      adherence: { rate: 0.8, done: 8, planned: 10 },
    },
  };
}

const protocol: Extract<ProtocolReview, { kind: 'TRAINING' }> = {
  kind: 'TRAINING',
  planId: '55555555-5555-4555-8555-555555555555',
  version: 1,
  status: 'DRAFT',
  editable: true,
  startsOn: '2026-11-06',
  strategy: null,
  structure: {
    summary: 'Três sessões de força.',
    modalityPriorities: [{ modality: 'STRENGTH', priority: 1 }],
    phases: [
      {
        name: 'Hipertrofia',
        focus: 'Técnica.',
        weeks: 5,
        endsWithDeload: false,
        mesocycle: 'HYPERTROPHY',
      },
    ],
    sessions: [
      {
        key: 'FORCA_A',
        title: 'Força A',
        purpose: 'Base.',
        priority: 'KEY',
        weeklyFrequency: 1,
        estimatedMinutes: 50,
        estimatedRpe: 7,
        content: {
          modality: 'STRENGTH',
          focus: 'Corpo inteiro',
          exercises: [
            {
              exerciseId: 'agachamento',
              name: 'Agachamento',
              sets: 3,
              reps: { min: 8, max: 10 },
              loadStrategy: 'RIR',
              rir: 2,
              restSeconds: 90,
            },
          ],
        },
      },
    ],
  },
  weekPreview: { weekStart: '2026-11-02', startsOn: '2026-11-02', sessions: [], dropped: [] },
  exerciseOptions: [{ id: 'agachamento', name: 'Agachamento', measurement: 'REPS' }],
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
  Object.values(api).forEach((fn) => fn.mockReset());
  push.mockReset();
  api.getException.mockResolvedValue(detail());
  api.getExceptionAnamnesis.mockResolvedValue({
    studentName: 'Ana Souza',
    submittedAt: null,
    flow: 'INITIAL',
    steps: [
      {
        step: 1,
        title: 'Cadastro',
        data: {
          name: 'Ana Souza',
          birthDate: '2000-01-01',
          biologicalSex: 'FEMALE',
          heightCm: 168,
          weightKg: 72.5,
        },
      },
      {
        step: 2,
        title: 'Objetivos',
        data: { goal: { primary: 'FAT_LOSS' } },
      },
      {
        step: 4,
        title: 'Sua semana',
        data: {
          windows: [
            { weekday: 'MON', slot: 'EVENING', maxMinutes: 45 },
            { weekday: 'WED', slot: 'EVENING', maxMinutes: 45 },
          ],
        },
      },
    ],
  } satisfies AnamnesisAnswersView);
  api.getExceptionDecisions.mockResolvedValue([
    {
      proposalId: '33333333-3333-4333-8333-333333333333',
      action: 'PUBLISH_TRAINING_PLAN',
      rationale: [],
      assumptions: [],
      uncertainty: 'MEDIUM',
      verdict: 'ASK',
      decidedBy: 'POLICY_ENGINE',
      reasons: [],
      command: null,
      createdAt: '2026-11-05T12:00:00.000Z',
    },
  ]);
  api.getExceptionProtocol.mockResolvedValue(protocol);
  api.approveException.mockResolvedValue({ id: ID, status: 'RESOLVED' });
  api.rejectException.mockResolvedValue({ id: ID, status: 'RESOLVED' });
  api.requestProtocolAdjustment.mockResolvedValue({
    id: ID,
    status: 'RESOLVED',
    outcome: 'ADJUSTMENT_REQUESTED',
  });
  api.regenerateProtocol.mockResolvedValue({
    id: ID,
    status: 'RESOLVED',
    outcome: 'REGENERATION_REQUESTED',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const decisionBar = () => screen.getByRole('region', { name: 'Decisão do protocolo' });
const dialogNamed = (name: string) => screen.getByRole('dialog', { name });

describe('Caso de protocolo — leitura', () => {
  it('resumo curto no topo, em linguagem humana, sem código no corpo', async () => {
    render(<ExceptionDetail id={ID} />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Protocolo para Revisão' }),
    ).toBeVisible();
    expect(screen.queryByText(/gerado pelos agentes/)).toBeNull();
    expect(await screen.findByText('72,5 kg')).toBeVisible();
    expect(screen.getByText('Emagrecimento')).toBeVisible();
    expect(screen.getByText('168 cm')).toBeVisible();
    expect(screen.getByText('Feminino')).toBeVisible();
    // Os mesmos campos da revisão da v1: mesociclo e o período do protocolo.
    expect(await screen.findByText('Hipertrofia')).toBeVisible();
    expect(screen.getByText('06/11/2026')).toBeVisible();
    expect(screen.getByText('11/12/2026')).toBeVisible();
    for (const label of ['Mesociclo:', 'Início do protocolo:', 'Fim do protocolo:']) {
      expect(screen.getByText(label)).toBeVisible();
    }
    expect(screen.queryByText(/Entrada na Fila|Estratégia de treino/)).toBeNull();
    expect(api.getExceptionAnamnesis).toHaveBeenCalledWith(ID, expect.anything());
    // A situação fica só na barra de decisão; o card do aluno é limpo.
    expect(
      within(decisionBar()).getByText('Revisão opcional · libera automaticamente em 1 h 42 min'),
    ).toBeInTheDocument();
    await screen.findByRole('region', { name: 'Plano de treino' });
    const body = document.body.textContent ?? '';
    expect(body).not.toMatch(/PUBLISH_TRAINING_PLAN|política de autonomia v1|aguardando revisão\./);
  });

  it('mantém aluno, auditoria recolhível e protocolo nesta ordem e abre a anamnese pelo olho', async () => {
    render(<ExceptionDetail id={ID} />);
    const profile = (
      await screen.findByRole('heading', { level: 1, name: 'Protocolo para Revisão' })
    ).closest('section');
    const audit = await screen.findByRole('complementary', { name: 'Detalhes e auditoria' });
    const protocol = await screen.findByRole('region', { name: 'Plano de treino' });
    expect(profile).not.toBeNull();
    expect(profile!.compareDocumentPosition(audit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(audit.compareDocumentPosition(protocol) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const auditToggle = within(audit).getByRole('button', { name: /Detalhes e auditoria/ });
    expect(auditToggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(audit).queryByRole('button', { name: /Por que este protocolo/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Ver anamnese' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Ana Souza');
  });

  it('o texto longo da IA vira painéis rotulados que abrem sob demanda', async () => {
    render(<ExceptionDetail id={ID} />);
    const panel = await screen.findByRole('complementary', { name: 'Detalhes e auditoria' });
    await userEvent.click(within(panel).getByRole('button', { name: /Detalhes e auditoria/ }));

    // "Por que este protocolo" abre por padrão, com as primeiras linhas e "Ver mais".
    const why = within(panel).getByRole('button', { name: /Por que este protocolo/ });
    expect(why).toHaveAttribute('aria-expanded', 'true');
    expect(
      within(panel).getByText('Proponho A na terça, B na quinta e C no sábado.'),
    ).toBeVisible();
    expect(within(panel).queryByText('A sessão C fica com esforço moderado.')).toBeNull();
    await userEvent.click(within(panel).getByRole('button', { name: 'Ver mais (1)' }));
    expect(within(panel).getByText('A sessão C fica com esforço moderado.')).toBeVisible();

    const coordinator = within(panel).getByRole('button', { name: /Parecer do coordenador/ });
    expect(coordinator).toHaveAttribute('aria-expanded', 'false');
    expect(coordinator).toHaveTextContent('2 pontos a conferir');
    await userEvent.click(coordinator);
    const opinion = within(panel).getByRole('region', { name: /Parecer do coordenador/ });
    expect(
      within(opinion)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'Antes da validação, confirmar carga recente.',
      'Ver o acompanhamento do hipotireoidismo.',
    ]);

    await userEvent.click(within(panel).getByRole('button', { name: /Avaliação postural/ }));
    const posture = within(panel).getByRole('region', { name: /Avaliação postural/ });
    expect(within(posture).getByText('Cabeça e cervical')).toBeVisible();
    expect(within(posture).getByText('simétricos')).toBeVisible();

    await userEvent.click(within(panel).getByRole('button', { name: /Por que veio para a fila/ }));
    const reasons = within(panel).getByRole('region', { name: /Por que veio para a fila/ });
    expect(reasons).toHaveTextContent(
      'Política de autonomia (versão 1): publicar o protocolo de treino é automático.',
    );
    // O código técnico só aparece aqui, pequeno e separado.
    expect(within(reasons).getByText('PUBLISH_TRAINING_PLAN = AUTO').tagName).toBe('CODE');

    await userEvent.click(within(panel).getByRole('button', { name: /Trilha de decisões/ }));
    expect(within(panel).getByText('Publicar o protocolo de treino')).toBeVisible();
    expect(within(panel).getByText(/enviada à Fila para revisão pelas políticas/)).toBeVisible();
  });

  it('obrigatória fica identificada na barra de decisão', async () => {
    api.getException.mockResolvedValue(detail({ reviewUrgency: 'MANDATORY', autoReleaseAt: null }));
    render(<ExceptionDetail id={ID} />);
    await screen.findByRole('region', { name: 'Plano de treino' });
    expect(
      within(decisionBar()).getByText('Revisão obrigatória · sem envio automático'),
    ).toBeInTheDocument();
  });
});

describe('Caso de protocolo — decisão', () => {
  it('aprovar e liberar, com nota opcional', async () => {
    render(<ExceptionDetail id={ID} />);
    await screen.findByRole('region', { name: 'Plano de treino' });
    await userEvent.click(within(decisionBar()).getByRole('button', { name: 'Aprovar e liberar' }));
    const dialog = dialogNamed('Aprovar e liberar ao aluno?');
    await userEvent.type(within(dialog).getByLabelText(/Nota/), 'Revisado.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aprovar e liberar' }));
    await waitFor(() => expect(api.approveException).toHaveBeenCalledWith(ID, 'Revisado.'));
  });

  it('recusar exige o motivo', async () => {
    render(<ExceptionDetail id={ID} />);
    await screen.findByRole('region', { name: 'Plano de treino' });
    await userEvent.click(within(decisionBar()).getByRole('button', { name: 'Recusar' }));
    const dialog = dialogNamed('Recusar o protocolo?');
    const confirm = within(dialog).getByRole('button', { name: 'Recusar' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Motivo da recusa'), 'Volume alto.');
    await userEvent.click(confirm);
    await waitFor(() => expect(api.rejectException).toHaveBeenCalledWith(ID, 'Volume alto.'));
  });

  it('pedir ajuste aos agentes leva a orientação e volta para a Fila', async () => {
    render(<ExceptionDetail id={ID} />);
    await screen.findByRole('region', { name: 'Plano de treino' });
    await userEvent.click(within(decisionBar()).getByRole('button', { name: 'Pedir ajuste' }));
    const dialog = dialogNamed('Pedir ajuste aos agentes?');
    await userEvent.type(
      within(dialog).getByLabelText('Orientação para os agentes'),
      'Trocar a corrida de sábado por bike.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pedir ajuste' }));
    await waitFor(() =>
      expect(api.requestProtocolAdjustment).toHaveBeenCalledWith(
        ID,
        'Trocar a corrida de sábado por bike.',
      ),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard/fila'));
  });

  it('🔄 regera o protocolo inteiro do zero, com confirmação', async () => {
    render(<ExceptionDetail id={ID} />);
    await screen.findByRole('region', { name: 'Plano de treino' });
    await userEvent.click(within(decisionBar()).getByRole('button', { name: 'Regerar protocolo' }));
    const dialog = dialogNamed('Regerar o protocolo de treino do zero?');
    expect(dialog).toHaveTextContent(/use o Editar do plano ou o Pedir ajuste/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Regerar do zero' }));
    await waitFor(() => expect(api.regenerateProtocol).toHaveBeenCalledWith(ID));
    expect(api.requestProtocolAdjustment).not.toHaveBeenCalled();
  });

  it('durante a edição a barra de decisão sai e o voltar pede confirmação se houver mudança', async () => {
    render(<ExceptionDetail id={ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar' }));
    expect(screen.queryByRole('region', { name: 'Decisão do protocolo' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /^Força A/ }));
    const sets = screen.getByLabelText('Séries de Agachamento');
    await userEvent.clear(sets);
    await userEvent.type(sets, '4');
    await userEvent.click(screen.getByRole('link', { name: 'Voltar para a Fila do Profissional' }));
    const dialog = dialogNamed('Sair sem salvar?');
    expect(push).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sair sem salvar' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard/fila'));
  });

  it('sem permissão: só leitura (sem barra de decisão nem Editar)', async () => {
    api.getException.mockResolvedValue(detail({ canResolve: false }));
    render(<ExceptionDetail id={ID} />);
    await screen.findByRole('region', { name: 'Plano de treino' });
    expect(screen.queryByRole('region', { name: 'Decisão do protocolo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
  });
});
