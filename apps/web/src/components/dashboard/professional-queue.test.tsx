import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExceptionDetail, ExceptionListItem } from '@movivo/shared';

import type * as ControlCenterApi from '@/lib/control-center-api';

const { getExceptions, getException, getExceptionAnamnesis, regenerateProtocol, resolveException } =
  vi.hoisted(() => ({
    getExceptions: vi.fn(),
    getException: vi.fn(),
    getExceptionAnamnesis: vi.fn(),
    regenerateProtocol: vi.fn(),
    resolveException: vi.fn(),
  }));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getExceptions,
  getException,
  getExceptionAnamnesis,
  regenerateProtocol,
  resolveException,
}));

import { ProfessionalQueue } from './professional-queue';

const ANA = '22222222-2222-4222-8222-222222222222';
const TRAINING_ID = '44444444-4444-4444-8444-444444444444';
const NUTRITION_ID = '55555555-5555-4555-8555-555555555555';
const FAILURE_ID = '66666666-6666-4666-8666-666666666666';

const LONG_SUMMARY =
  'Protocolo gerado pela IA aguardando revisão. política de autonomia v1: PUBLISH_TRAINING_PLAN = AUTO mudança no protocolo na fila do profissional: revisão opcional, liberada após a janela Proponho A na terça, B na quinta e C no sábado. Avaliação postural por foto (leitura da IA, para auditoria): Cabeça e cervical: leve anteriorização; Ombros: simétricos. Coordenador: Antes da validação, confirmar carga recente.';

const inMinutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

const item = (over: Partial<ExceptionListItem> = {}): ExceptionListItem => ({
  id: TRAINING_ID,
  kind: 'PROTOCOL_REVIEW',
  priority: 'NORMAL',
  status: 'OPEN',
  domain: 'TRAINING',
  summary: LONG_SUMMARY,
  createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  assignedStaffId: null,
  studentId: ANA,
  studentName: 'Ana Souza',
  canResolve: true,
  reviewUrgency: 'OPTIONAL',
  autoReleaseAt: inMinutes(102),
  actionType: 'PUBLISH_TRAINING_PLAN',
  source: null,
  ...over,
});

const nutrition = () =>
  item({
    id: NUTRITION_ID,
    domain: 'NUTRITION',
    actionType: 'PUBLISH_NUTRITION_PLAN',
    autoReleaseAt: inMinutes(42),
    summary:
      'Protocolo gerado pela IA aguardando revisão. política de autonomia v1: PUBLISH_NUTRITION_PLAN = AUTO',
  });

const detail = (over: Partial<ExceptionDetail> = {}): ExceptionDetail => ({
  case: {
    id: TRAINING_ID,
    kind: 'PROTOCOL_REVIEW',
    priority: 'NORMAL',
    status: 'OPEN',
    domain: 'TRAINING',
    summary: LONG_SUMMARY,
    createdAt: new Date().toISOString(),
    assignedStaffId: null,
    canResolve: true,
    reviewUrgency: 'OPTIONAL',
    autoReleaseAt: inMinutes(102),
    userId: ANA,
    resolution: null,
    resolvedAt: null,
  },
  student: { id: ANA, name: 'Ana Souza', timezone: 'America/Sao_Paulo' },
  proposal: {
    id: '77777777-7777-4777-8777-777777777777',
    actionType: 'PUBLISH_TRAINING_PLAN',
    action: { type: 'PUBLISH_TRAINING_PLAN' },
    rationale: [
      'Proponho A na terça, B na quinta e C no sábado.',
      'Avaliação postural por foto (leitura da IA, para auditoria): Cabeça e cervical: leve anteriorização; Ombros: simétricos.',
      'Coordenador: Antes da validação, confirmar carga recente.',
    ],
    evidence: [],
    assumptions: ['Treina em academia com máquinas.'],
    uncertainty: 'MEDIUM',
    expectedOutcome: 'Constância de 4 sessões por semana.',
    status: 'PENDING',
  },
  decision: {
    id: '88888888-8888-4888-8888-888888888888',
    verdict: 'ASK',
    reasons: [
      'política de autonomia v1: PUBLISH_TRAINING_PLAN = AUTO',
      'mudança no protocolo na fila do profissional: revisão opcional, liberada após a janela',
    ],
    decidedBy: 'POLICY',
  },
  safety: null,
  state: {},
  exam: null,
  exerciseNames: null,
  ...over,
});

const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(new Response('{}')));

beforeEach(() => {
  for (const mock of [
    getExceptions,
    getException,
    getExceptionAnamnesis,
    regenerateProtocol,
    resolveException,
  ]) {
    mock.mockReset();
  }
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const holdCalls = (id: string) =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes(`/exceptions/${id}/review-hold`));

describe('Fila do Profissional', () => {
  it('pede só os casos em aberto da Fila e mostra o vazio bem explicado', async () => {
    getExceptions.mockResolvedValue([]);
    render(<ProfessionalQueue />);
    expect(await screen.findByText('Fila em dia')).toBeVisible();
    expect(getExceptions).toHaveBeenCalledWith(undefined, 'QUEUE', expect.anything());
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('mostra o erro com "Tentar novamente" quando a fila não carrega', async () => {
    getExceptions.mockRejectedValueOnce(new Error('API fora do ar'));
    render(<ProfessionalQueue />);
    expect(await screen.findByText('API fora do ar')).toBeVisible();
    getExceptions.mockResolvedValue([]);
    await userEvent.click(screen.getByRole('button', { name: /Tentar novamente/ }));
    expect(await screen.findByText('Fila em dia')).toBeVisible();
  });

  it('um único item por aluno, com uma linha para o treino e outra para o alimentar', async () => {
    getExceptions.mockResolvedValue([nutrition(), item()]);
    render(<ProfessionalQueue />);

    const cards = await screen.findAllByRole('article');
    expect(cards).toHaveLength(1);
    const card = cards[0] as HTMLElement;
    expect(within(card).getByRole('heading', { name: 'Ana Souza' })).toBeVisible();
    expect(within(card).getByText(/2 pendências · há 3 h/)).toBeVisible();

    const lines = within(
      within(card).getByRole('list', { name: /Pendências de Ana Souza/ }),
    ).getAllByRole('listitem');
    expect(lines.map((line) => within(line).getByText(/^Protocolo/).textContent)).toEqual([
      'Protocolo de treino',
      'Protocolo alimentar',
    ]);
    // O cabeçalho mostra o prazo mais próximo (o do alimentar).
    expect(within(card).getByText('Liberação automática em 42 min')).toBeVisible();
    // Cada linha tem o seu prazo à vista e o relógio com a frase completa.
    const first = lines[0] as HTMLElement;
    const second = lines[1] as HTMLElement;
    expect(within(first).getByText('Revisão opcional · libera em 1 h 42 min')).toBeVisible();
    expect(within(second).getByText('Revisão opcional · libera em 42 min')).toBeVisible();
    expect(
      within(first).getByRole('button', { name: 'Prazo da liberação automática' }),
    ).toHaveAccessibleDescription(/Liberação automática em 1 h 42 min/);
    expect(
      within(second).getByRole('button', { name: 'Prazo da liberação automática' }),
    ).toHaveAccessibleDescription(/Liberação automática em 42 min/);
  });

  it('o resumo não mostra o texto longo nem códigos técnicos da IA', async () => {
    getExceptions.mockResolvedValue([item()]);
    render(<ProfessionalQueue />);
    const card = await screen.findByRole('article');
    expect(card).not.toHaveTextContent(
      /PUBLISH_TRAINING_PLAN|política de autonomia|Avaliação postural|Coordenador/,
    );
    expect(card).not.toHaveTextContent(/Proponho A na terça/);
  });

  it('separa obrigatória de opcional; falha de geração do mesmo aluno é linha do mesmo item', async () => {
    getExceptions.mockResolvedValue([
      item(),
      item({
        id: FAILURE_ID,
        kind: 'DECISION_FAILURE',
        domain: 'NUTRITION',
        actionType: null,
        reviewUrgency: 'MANDATORY',
        autoReleaseAt: null,
        priority: 'HIGH',
        summary:
          'Não foi possível gerar o plano automaticamente: o agente nutrition-plan não produziu uma saída válida: meals: vazio',
      }),
      item({
        id: '99999999-9999-4999-8999-999999999999',
        studentId: '33333333-3333-4333-8333-333333333333',
        studentName: 'Bruno Lima',
        autoReleaseAt: inMinutes(5),
        actionType: 'SUBSTITUTE_EXERCISE',
      }),
    ]);
    render(<ProfessionalQueue />);

    const mandatory = await screen.findByRole('region', { name: 'Revisão obrigatória' });
    const optional = screen.getByRole('region', { name: 'Revisão opcional' });
    const ana = within(mandatory).getByRole('article', { name: 'Ana Souza' });
    expect(within(ana).getByText('Falha ao gerar o protocolo alimentar')).toBeVisible();
    expect(within(ana).getByText('Protocolo de treino')).toBeVisible();
    expect(within(ana).getByText('Falhou · nada foi enviado ao aluno')).toBeVisible();
    // A falha regera (sem lápis nem relógio) e o protocolo de treino também tem o 🔄.
    expect(within(ana).getAllByRole('button', { name: 'Regerar protocolo' })).toHaveLength(2);
    expect(
      within(ana).getAllByRole('button', { name: 'Prazo da liberação automática' }),
    ).toHaveLength(1);

    const bruno = within(optional).getByRole('article', { name: 'Bruno Lima' });
    expect(within(bruno).getByText('Troca de exercício')).toBeVisible();
    expect(within(bruno).getByRole('link', { name: 'Revisar a troca' })).toHaveAttribute(
      'href',
      '/dashboard/fila/99999999-9999-4999-8999-999999999999',
    );
    // Troca de exercício não pede ajuste aos agentes (só protocolo inteiro).
    expect(within(bruno).queryByRole('button', { name: 'Pedir ajuste aos agentes' })).toBeNull();
    expect(within(optional).queryByText('Ana Souza')).toBeNull();
  });

  it('lápis abre a edição do protocolo e o olho abre a anamnese só quando pedido (leitura auditada)', async () => {
    getExceptions.mockResolvedValue([item()]);
    getExceptionAnamnesis.mockResolvedValue({ submittedAt: null, flow: 'INITIAL', steps: [] });
    render(<ProfessionalQueue />);

    const card = await screen.findByRole('article');
    expect(
      within(card).getByRole('link', { name: 'Revisar e editar o protocolo' }),
    ).toHaveAttribute('href', `/dashboard/fila/${TRAINING_ID}`);
    const eye = within(card).getByRole('button', { name: 'Ver anamnese' });
    expect(eye).toHaveAccessibleDescription(/a leitura fica registrada na auditoria/);
    expect(getExceptionAnamnesis).not.toHaveBeenCalled();

    await userEvent.click(eye);
    expect(await screen.findByRole('dialog', { name: 'Respostas da anamnese' })).toBeVisible();
    await waitFor(() =>
      expect(getExceptionAnamnesis).toHaveBeenCalledWith(TRAINING_ID, expect.anything()),
    );
  });

  it('"Detalhes" abre a auditoria em seções com rótulo e segura a liberação automática', async () => {
    getExceptions.mockResolvedValue([item()]);
    getException.mockResolvedValue(detail());
    render(<ProfessionalQueue />);

    const toggle = await screen.findByRole('button', {
      name: 'Detalhes e auditoria de Protocolo de treino',
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(getException).not.toHaveBeenCalled();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const panel = await screen.findByRole('region', {
      name: 'Detalhes e auditoria: Protocolo de treino',
    });
    expect(await within(panel).findByText('Justificativa da IA')).toBeVisible();
    expect(
      within(panel).getByText('Proponho A na terça, B na quinta e C no sábado.'),
    ).toBeVisible();
    expect(within(panel).getByText('Parecer do coordenador')).toBeVisible();
    expect(within(panel).getByText('Antes da validação, confirmar carga recente.')).toBeVisible();
    expect(within(panel).getByText('Avaliação postural (leitura da IA)')).toBeVisible();
    expect(within(panel).getByText('Cabeça e cervical')).toBeVisible();
    expect(within(panel).getByText('leve anteriorização')).toBeVisible();
    expect(within(panel).getByText('Por que veio para a fila')).toBeVisible();
    expect(
      within(panel).getByText(
        /Política de autonomia \(versão 1\): publicar o protocolo de treino é automático/,
      ),
    ).toBeVisible();
    expect(within(panel).getByText('PUBLISH_TRAINING_PLAN = AUTO')).toBeVisible();
    expect(within(panel).getByText(/o envio espera você/)).toBeVisible();
    expect(within(panel).getByRole('link', { name: /Abrir a revisão completa/ })).toHaveAttribute(
      'href',
      `/dashboard/fila/${TRAINING_ID}`,
    );

    // Detalhes abertos = tela de revisão aberta: a trava segura o envio que vencer.
    await waitFor(() => expect(holdCalls(TRAINING_ID)).toHaveLength(1));
    expect(JSON.parse(String(holdCalls(TRAINING_ID)[0]?.[1]?.body))).toEqual({ active: true });

    await userEvent.click(toggle);
    expect(screen.queryByRole('region', { name: /Detalhes e auditoria/ })).toBeNull();
    await waitFor(() =>
      expect(holdCalls(TRAINING_ID).some(([, init]) => String(init?.body).includes('false'))).toBe(
        true,
      ),
    );
  });

  it('na revisão obrigatória, abrir os detalhes não mexe em trava (não há envio automático)', async () => {
    getExceptions.mockResolvedValue([item({ reviewUrgency: 'MANDATORY', autoReleaseAt: null })]);
    getException.mockResolvedValue(detail());
    render(<ProfessionalQueue />);
    await userEvent.click(await screen.findByRole('button', { name: /Detalhes e auditoria/ }));
    expect(await screen.findByText('Justificativa da IA')).toBeVisible();
    expect(holdCalls(TRAINING_ID)).toHaveLength(0);
    expect(screen.getByText('Revisão obrigatória · sem envio automático')).toBeVisible();
  });

  it('a falha de geração mostra o que aconteceu, um problema por linha, e "Regerar" encerra o caso', async () => {
    getExceptions.mockResolvedValue([
      item({
        id: FAILURE_ID,
        kind: 'DECISION_FAILURE',
        actionType: null,
        reviewUrgency: 'MANDATORY',
        autoReleaseAt: null,
        summary:
          'Não foi possível gerar o plano automaticamente: o agente training-plan não produziu uma saída válida: sessions.0: vazio; volume: acima do limite',
      }),
    ]);
    getException.mockResolvedValue(detail({ proposal: null, decision: null }));
    resolveException.mockResolvedValue({ id: FAILURE_ID, status: 'RESOLVED' });
    render(<ProfessionalQueue />);

    await userEvent.click(await screen.findByRole('button', { name: /Detalhes e auditoria/ }));
    expect(await screen.findByText('O que aconteceu')).toBeVisible();
    expect(screen.getByText('sessions.0: vazio')).toBeVisible();
    expect(screen.getByText('volume: acima do limite')).toBeVisible();

    getExceptions.mockResolvedValue([]);
    await userEvent.click(screen.getByRole('button', { name: 'Regerar protocolo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Regerar do zero' }));
    await waitFor(() =>
      expect(resolveException).toHaveBeenCalledWith(
        FAILURE_ID,
        'Regeração do protocolo solicitada.',
      ),
    );
    expect(await screen.findByText('Fila em dia')).toBeVisible();
  });

  it('🔄 num protocolo regera do zero (sem orientação) e o caso sai da fila', async () => {
    getExceptions.mockResolvedValue([item()]);
    regenerateProtocol.mockResolvedValue({
      id: TRAINING_ID,
      status: 'RESOLVED',
      outcome: 'REGENERATION_REQUESTED',
    });
    render(<ProfessionalQueue />);

    await userEvent.click(await screen.findByRole('button', { name: 'Regerar protocolo' }));
    expect(screen.getByText(/geram outro inteiro, do início/)).toBeVisible();
    expect(screen.queryByLabelText('Orientação para os agentes')).toBeNull();
    getExceptions.mockResolvedValue([]);
    await userEvent.click(screen.getByRole('button', { name: 'Regerar do zero' }));
    await waitFor(() => expect(regenerateProtocol).toHaveBeenCalledWith(TRAINING_ID));
    expect(resolveException).not.toHaveBeenCalled();
    expect(await screen.findByText('Fila em dia')).toBeVisible();
  });

  it('troca de exercício e ajuste não têm o 🔄 (só o lápis para revisar)', async () => {
    getExceptions.mockResolvedValue([item({ actionType: 'SUBSTITUTE_EXERCISE' })]);
    render(<ProfessionalQueue />);
    const card = await screen.findByRole('article');
    expect(within(card).getByRole('link', { name: 'Revisar a troca' })).toBeVisible();
    expect(within(card).queryByRole('button', { name: 'Regerar protocolo' })).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Pedir ajuste aos agentes' })).toBeNull();
  });

  it('papel fora do domínio vê o item em somente leitura, sem ações de decisão', async () => {
    getExceptions.mockResolvedValue([item({ canResolve: false })]);
    render(<ProfessionalQueue />);
    const card = await screen.findByRole('article');
    expect(within(card).getByText(/somente leitura para o seu papel/)).toBeVisible();
    expect(within(card).queryByRole('button', { name: 'Regerar protocolo' })).toBeNull();
  });

  it('o relógio explica o prazo no toque (sem gesto especial) e some com Esc', async () => {
    getExceptions.mockResolvedValue([item()]);
    render(<ProfessionalQueue />);
    const clock = await screen.findByRole('button', { name: 'Prazo da liberação automática' });
    expect(clock).toHaveAccessibleDescription(
      /Liberação automática em 1 h 42 min \(às \d{2}:\d{2}\) se ninguém agir antes · revisão opcional/,
    );
    expect(clock).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(clock);
    expect(clock).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(clock, { key: 'Escape' });
    expect(clock).toHaveAttribute('aria-expanded', 'false');
  });
});
