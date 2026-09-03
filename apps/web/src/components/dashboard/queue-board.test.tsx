import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  editProtocolItem,
  handoffItem,
  optionalProtocolItem,
  parqProtocolItem,
  protocolItem,
  queueResponse,
  substitutionItem,
} from '../../../test/dashboard-fixtures';

const { getQueue, getAnamnesisAnswers } = vi.hoisted(() => ({
  getQueue: vi.fn(),
  getAnamnesisAnswers: vi.fn(),
}));
vi.mock('@/lib/dashboard-api', () => ({
  getQueue,
  getAnamnesisAnswers,
  captureDashboardEvent: vi.fn(),
}));

import { QueueBoard, sortQueue } from './queue-board';

type StreamListener = (event: Event) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];
  readonly listeners = new Map<string, StreamListener[]>();
  readonly close = vi.fn();
  onopen: StreamListener | null = null;
  onerror: StreamListener | null = null;

  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string) {
    const event = new Event(type);
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

/**
 * Círculo do ícone do card — o `<span aria-hidden>` que embrulha o ícone lucide. É
 * decorativo por definição, então não tem papel nem nome acessível pra consultar: só
 * dá pra alcançar pelo DOM. Primeiro `span` do card, sempre.
 */
function iconCircle(card: HTMLElement): HTMLElement {
  const circle = card.querySelector<HTMLElement>('span[aria-hidden="true"].rounded-full');
  if (!circle) throw new Error('círculo do ícone não encontrado no card');
  return circle;
}

beforeEach(() => {
  getQueue.mockReset();
  getAnamnesisAnswers.mockReset();
  MockEventSource.instances = [];
  vi.stubGlobal('EventSource', MockEventSource);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('QueueBoard', () => {
  it('separa em duas categorias — Revisão Humana Obrigatória e Revisão Humana Opcional', async () => {
    getQueue.mockResolvedValue(queueResponse);
    render(<QueueBoard />);
    const mandatorySection = await screen.findByRole('region', {
      name: 'Revisão Humana Obrigatória',
    });
    const optionalSection = screen.getByRole('region', { name: 'Revisão Humana Opcional' });
    expect(within(mandatorySection).getAllByRole('listitem')).toHaveLength(
      queueResponse.mandatory.length,
    );
    expect(within(optionalSection).getAllByRole('listitem')).toHaveLength(
      queueResponse.optional.length,
    );
    expect(within(optionalSection).getByText(optionalProtocolItem.title)).toBeVisible();
  });

  it('as duas seções são agrupamento tipográfico, não cartão, e mostram a contagem ao lado do título', async () => {
    getQueue.mockResolvedValue(queueResponse);
    render(<QueueBoard />);
    const mandatorySection = await screen.findByRole('region', {
      name: 'Revisão Humana Obrigatória',
    });
    const optionalSection = screen.getByRole('region', { name: 'Revisão Humana Opcional' });
    // Spec de Sofia: a seção deixou de ser caixa (era caixa dentro de caixa com os
    // cards) — vira só título + espaço, idêntico entre as duas seções.
    expect(mandatorySection.className).toBe(optionalSection.className);
    expect(mandatorySection.className).not.toContain('border');
    const mandatoryHeading = screen.getByRole('heading', { name: 'Revisão Humana Obrigatória' });
    const optionalHeading = screen.getByRole('heading', { name: 'Revisão Humana Opcional' });
    expect(mandatoryHeading.nextElementSibling).toHaveTextContent(
      String(queueResponse.mandatory.length),
    );
    expect(optionalHeading.nextElementSibling).toHaveTextContent(
      String(queueResponse.optional.length),
    );
  });

  it('esconde o badge de severidade "Revisão de rotina" (é o de todo protocolo, não diferencia nada)', async () => {
    getQueue.mockResolvedValue(queueResponse);
    render(<QueueBoard />);
    await screen.findByText(optionalProtocolItem.title);
    expect(screen.queryByText('Revisão de rotina')).not.toBeInTheDocument();
    // `ALERT` é a única severidade que ainda renderiza pill — na fila real, o protocolo
    // `MANDATORY` de origem `EDIT`. O de origem `PARQ` é SAFETY e não renderiza pill.
    expect(screen.getByText('Atenção')).toBeVisible();
  });

  it('SAFETY não renderiza o pill "Segurança" — a severidade já vem da faixa, do ícone e do título', async () => {
    getQueue.mockResolvedValue({ ...queueResponse, mandatory: [handoffItem] });
    render(<QueueBoard />);
    const card = (await screen.findByText(handoffItem.title)).closest('li') as HTMLElement;

    expect(within(card).queryByText('Segurança')).not.toBeInTheDocument();
    expect(within(card).queryByTitle('Segurança · ação prioritária')).not.toBeInTheDocument();
    // O que continua carregando o sinal de segurança: faixa coral no card e ícone
    // preenchido de destructive (nenhum dos dois some junto com o pill).
    expect(card.className).toContain('border-l-coral');
    expect(iconCircle(card).className).toContain('bg-destructive');
  });

  it('círculo do ícone: fundo verde na seção "Revisão Humana Opcional", contorno fora dela', async () => {
    // A cor vem de `section`, não da severidade. O card ROUTINE em `mandatory` é
    // hipotético — hoje todo protocolo `reviewUrgency: OPTIONAL` é ROUTINE e todo
    // ROUTINE cai em `optional` — e está aqui só pra travar essa distinção.
    const mandatoryRoutine = { ...protocolItem, id: '77777777-7777-4777-8777-777777777777' };
    getQueue.mockResolvedValue({
      ...queueResponse,
      mandatory: [mandatoryRoutine],
      optional: [optionalProtocolItem],
    });
    render(<QueueBoard />);

    const optionalSection = await screen.findByRole('region', { name: 'Revisão Humana Opcional' });
    const optionalCard = within(optionalSection)
      .getByText(optionalProtocolItem.title)
      .closest('li') as HTMLElement;
    const optionalCircle = iconCircle(optionalCard);
    expect(optionalCircle.className).toContain('bg-verde-pulso');
    // Par de contraste da marca sobre verde-pulso (= `--primary-foreground`). Branco
    // aqui não alcançaria o 3:1 de WCAG 1.4.11 sobre #25E27E.
    expect(optionalCircle.className).toContain('text-petroleo');
    expect(optionalCircle.className).not.toContain('border');

    const mandatorySection = screen.getByRole('region', { name: 'Revisão Humana Obrigatória' });
    const mandatoryCircle = iconCircle(
      within(mandatorySection).getByText(mandatoryRoutine.title).closest('li') as HTMLElement,
    );
    expect(mandatoryCircle.className).toContain('border border-border');
    expect(mandatoryCircle.className).not.toContain('bg-verde-pulso');
  });

  it('badge ALERT continua sem title e sem complemento oculto — o rótulo já é completo', async () => {
    getQueue.mockResolvedValue(queueResponse);
    render(<QueueBoard />);
    const card = (await screen.findByText(editProtocolItem.title)).closest('li');
    const badge = within(card as HTMLElement).getByText('Atenção');
    expect(badge).not.toHaveAttribute('title');
    expect(badge.textContent).toBe('Atenção');
  });

  it('botão de relógio: só aparece com prazo de auto-liberação, com o tooltip certo', async () => {
    // `autoReleaseAt` relativo a "agora" — evita depender de data fixa da fixture.
    const soonToRelease = {
      ...optionalProtocolItem,
      autoReleaseAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    };
    getQueue.mockResolvedValue({ ...queueResponse, optional: [soonToRelease, protocolItem] });
    render(<QueueBoard />);
    const withDeadline = (await screen.findByText(soonToRelease.title)).closest('li');
    const clockButton = within(withDeadline as HTMLElement).getByRole('button', {
      name: /dispara automaticamente.*whatsapp/i,
    });
    expect(clockButton).toBeVisible();
    // Tooltip visível no hover (não só o aria-label do botão) — texto de verdade, não vazio.
    expect(
      within(withDeadline as HTMLElement).getByRole('tooltip', { hidden: true }),
    ).toHaveTextContent(/dispara automaticamente.*whatsapp/i);

    const withoutDeadline = screen.getByText(protocolItem.title).closest('li');
    expect(
      within(withoutDeadline as HTMLElement).queryByRole('button', {
        name: /whatsapp/i,
      }),
    ).not.toBeInTheDocument();
  });

  it('card de protocolo: "Ver respostas" abre modal com a anamnese; "Abrir" navega pro protocolo', async () => {
    const user = userEvent.setup();
    getQueue.mockResolvedValue(queueResponse);
    getAnamnesisAnswers.mockResolvedValue({
      userId: 'u1',
      submittedAt: '2026-08-18T12:00:00.000Z',
      personal: {
        name: 'Bruno Teste',
        birthDate: '1990-01-01',
        biologicalSex: 'MALE',
        heightCm: 180,
        weightKg: 80,
        phoneNumber: '+5511999999999',
      },
      routine: {
        primaryGoal: 'CONDITIONING',
        trainingStatus: 'NEVER',
        experience: 'BEGINNER',
        daysPerWeek: 4,
        sessionDuration: 'M45_TO_60',
        location: 'HOME',
        preferredPeriod: 'MORNING',
        emphasis: [],
        pastActivities: [],
        consistencyBarriers: [],
        preferredDays: [],
        practicesOtherSport: false,
      },
      health: {},
    });
    render(<QueueBoard />);
    const card = (await screen.findByText(optionalProtocolItem.title)).closest('li');
    expect(card).not.toBeNull();

    const openProtocol = within(card as HTMLElement).getByRole('link', { name: /Abrir/i });
    expect(openProtocol).toHaveAttribute(
      'href',
      `/dashboard/fila/protocol/${optionalProtocolItem.id}`,
    );

    const viewAnswers = within(card as HTMLElement).getByRole('button', {
      name: /Ver respostas/i,
    });
    await user.click(viewAnswers);

    expect(getAnamnesisAnswers).toHaveBeenCalledWith(
      'PROTOCOL',
      optionalProtocolItem.id,
      expect.anything(),
    );
    expect(await screen.findByRole('dialog', { name: /Respostas da anamnese/i })).toBeVisible();
    expect(screen.getByText('Bruno Teste')).toBeVisible();
  });

  it('modal de "Ver respostas": erro ao carregar mostra alerta com botão de tentar de novo', async () => {
    const user = userEvent.setup();
    getQueue.mockResolvedValue(queueResponse);
    getAnamnesisAnswers.mockRejectedValueOnce(new Error('Falha ao buscar anamnese.'));
    render(<QueueBoard />);
    const card = (await screen.findByText(optionalProtocolItem.title)).closest('li');
    await user.click(within(card as HTMLElement).getByRole('button', { name: /Ver respostas/i }));

    const dialog = await screen.findByRole('dialog', { name: /Respostas da anamnese/i });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Falha ao buscar anamnese.');

    getAnamnesisAnswers.mockResolvedValueOnce({
      userId: 'u1',
      submittedAt: '2026-08-18T12:00:00.000Z',
      personal: {
        name: 'Bruno Teste',
        birthDate: '1990-01-01',
        biologicalSex: 'MALE',
        heightCm: 180,
        weightKg: 80,
        phoneNumber: '+5511999999999',
      },
      routine: {
        primaryGoal: 'CONDITIONING',
        trainingStatus: 'NEVER',
        experience: 'BEGINNER',
        daysPerWeek: 4,
        sessionDuration: 'M45_TO_60',
        location: 'HOME',
        preferredPeriod: 'MORNING',
        emphasis: [],
        pastActivities: [],
        consistencyBarriers: [],
        preferredDays: [],
        practicesOtherSport: false,
      },
      health: {},
    });
    await user.click(within(dialog).getByRole('button', { name: /Tentar novamente/i }));
    expect(await within(dialog).findByText('Bruno Teste')).toBeVisible();
  });

  it('esconde o badge de status quando é PENDING_SIGNATURE (ruído, é o status de quase todo item aqui)', async () => {
    getQueue.mockResolvedValue({
      ...queueResponse,
      optional: [
        { ...optionalProtocolItem, status: 'PENDING_SIGNATURE', summary: 'PENDING_SIGNATURE' },
      ],
    });
    render(<QueueBoard />);
    const card = (await screen.findByText(optionalProtocolItem.title)).closest('li');
    expect(within(card as HTMLElement).queryByText('PENDING_SIGNATURE')).not.toBeInTheDocument();
  });

  /**
   * Desde 2026-08-24 o card de PAR-Q bloqueante é um card de PROTOCOLO como qualquer
   * outro: mesma rota `/dashboard/fila/protocol/{id}`, mesmo olho, mesmo endpoint de
   * anamnese. O que sobra de específico é só a legenda de origem — a faixa/ícone de
   * segurança vêm de `severity`, não do kind, e continuam funcionando sem mudança.
   */
  it('card de PAR-Q bloqueante é um card de protocolo: abre o protocolo e usa a anamnese de PROTOCOL', async () => {
    const user = userEvent.setup();
    getQueue.mockResolvedValue(queueResponse);
    getAnamnesisAnswers.mockResolvedValue({
      userId: 'u2',
      submittedAt: '2026-08-18T12:00:00.000Z',
      personal: {
        name: 'Carla Teste',
        birthDate: '1985-05-05',
        biologicalSex: 'FEMALE',
        heightCm: 165,
        weightKg: 60,
        phoneNumber: '+5511999999999',
      },
      routine: {
        primaryGoal: 'LOSE_FAT',
        trainingStatus: 'NEVER',
        experience: 'BEGINNER',
        daysPerWeek: 3,
        sessionDuration: 'M45_TO_60',
        location: 'HOME',
        preferredPeriod: 'MORNING',
        emphasis: [],
        pastActivities: [],
        consistencyBarriers: [],
        preferredDays: [],
        practicesOtherSport: false,
      },
      health: {},
    });
    render(<QueueBoard />);
    const card = (await screen.findByText(parqProtocolItem.title)).closest('li');
    expect(card).not.toBeNull();

    expect(within(card as HTMLElement).getByRole('link', { name: /Abrir/i })).toHaveAttribute(
      'href',
      `/dashboard/fila/protocol/${parqProtocolItem.id}`,
    );

    const viewAnswers = within(card as HTMLElement).getByRole('button', {
      name: /Ver respostas/i,
    });
    await user.click(viewAnswers);

    expect(getAnamnesisAnswers).toHaveBeenCalledWith(
      'PROTOCOL',
      parqProtocolItem.id,
      expect.anything(),
    );
    expect(await screen.findByRole('dialog', { name: /Respostas da anamnese/i })).toBeVisible();
    expect(screen.getByText('Carla Teste')).toBeVisible();
  });

  /**
   * A legenda é o único sinal LEGÍVEL de origem no card: a faixa coral é CSS e o ícone é
   * `aria-hidden`, e o título de um PAR-Q bloqueante é igual ao de qualquer protocolo.
   * `EDIT` (a outra origem de `MANDATORY`) não ganha legenda — já tem o pill "Atenção".
   */
  it('legenda de origem: só o card de PAR-Q bloqueante a exibe, junto da faixa e do ícone de segurança', async () => {
    getQueue.mockResolvedValue(queueResponse);
    render(<QueueBoard />);

    const parqCard = (await screen.findByText(parqProtocolItem.title)).closest('li') as HTMLElement;
    expect(within(parqCard).getByText('Origem: PAR-Q bloqueante')).toBeVisible();
    expect(parqCard.className).toContain('border-l-coral');
    expect(iconCircle(parqCard).className).toContain('bg-destructive');

    const editCard = screen.getByText(editProtocolItem.title).closest('li') as HTMLElement;
    expect(within(editCard).queryByText(/Origem:/)).not.toBeInTheDocument();
    expect(editCard.className).not.toContain('border-l-coral');

    const optionalCard = screen.getByText(optionalProtocolItem.title).closest('li') as HTMLElement;
    expect(within(optionalCard).queryByText(/Origem:/)).not.toBeInTheDocument();
  });

  // Achado 2026-09-02, ampliado 2026-09-03: proposta de substituição de exercício via IA
  // carrega sua própria legenda de origem e fica na seção própria "Revisão de
  // Substituição de Exercício Opcional" — não mais misturada com protocolo.
  it('card de substituição via IA mostra a legenda própria e fica na seção de substituição opcional', async () => {
    // `autoReleaseAt` relativo a "agora" — evita depender de data fixa da fixture (o
    // relógio muda de rótulo pra "Disparando…" quando o prazo já passou).
    const optionalSubstitution = {
      ...substitutionItem,
      autoReleaseAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    };
    getQueue.mockResolvedValue({
      ...queueResponse,
      substitutionOptional: [optionalSubstitution],
      counts: {
        ...queueResponse.counts,
        substitutionOptional: 1,
        total: queueResponse.counts.total + 1,
      },
    });
    render(<QueueBoard />);

    const section = await screen.findByRole('region', {
      name: 'Revisão de Substituição de Exercício Opcional',
    });
    const card = within(section).getByText(optionalSubstitution.title).closest('li') as HTMLElement;
    expect(within(card).getByText('Origem: substituição confirmada pelo aluno')).toBeVisible();
    expect(card.className).not.toContain('border-l-coral');
    // Continua auto-liberando — o relógio de prazo aparece igual a qualquer OPTIONAL.
    expect(
      within(card).getByRole('button', { name: /dispara automaticamente.*whatsapp/i }),
    ).toBeVisible();
  });

  // Achado 2026-09-03 (a pedido do fundador): aluno com protocolo de origem em PAR-Q
  // bloqueante — a substituição cai na seção obrigatória própria, com o MESMO
  // tratamento visual/de ação do protocolo MANDATORY: faixa coral, sem relógio de
  // auto-liberação, sem badge de status, e os mesmos botões existentes (na tela de
  // detalhe, gated só por `kind`+`status`, não por seção — ver `queue-detail.tsx`).
  it('substituição com origem em PAR-Q bloqueante cai na seção obrigatória, sem auto-liberação', async () => {
    const mandatorySubstitution = {
      ...substitutionItem,
      id: 'sub-mandatory-1',
      severity: 'SAFETY' as const,
      autoReleaseAt: null,
      title: 'Substituição de Exercício: Carla Teste',
      // Vazio de propósito: isola a checagem do badge de status (abaixo) do parágrafo
      // de resumo, que também renderizaria 'PENDING' e confundiria a asserção.
      summary: '',
    };
    getQueue.mockResolvedValue({
      ...queueResponse,
      substitutionMandatory: [mandatorySubstitution],
      counts: {
        ...queueResponse.counts,
        substitutionMandatory: 1,
        total: queueResponse.counts.total + 1,
      },
    });
    render(<QueueBoard />);

    const section = await screen.findByRole('region', {
      name: 'Revisão de Substituição de Exercício Obrigatória',
    });
    const card = within(section)
      .getByText(mandatorySubstitution.title)
      .closest('li') as HTMLElement;
    expect(card.className).toContain('border-l-coral');
    expect(
      within(card).getByText('Origem: substituição confirmada pelo aluno · PAR-Q bloqueante'),
    ).toBeVisible();
    expect(within(card).queryByRole('button', { name: /whatsapp/i })).not.toBeInTheDocument();
    expect(within(card).queryByText(mandatorySubstitution.status)).not.toBeInTheDocument();
    // Mesmo botão de navegação que qualquer outro card da fila — "Abrir caso".
    expect(within(card).getByRole('link', { name: 'Abrir caso' })).toBeVisible();
  });

  it('sem resumo: não mostra nenhum texto de placeholder, só omite o parágrafo', async () => {
    getQueue.mockResolvedValue({
      ...queueResponse,
      optional: [{ ...optionalProtocolItem, summary: '' }],
    });
    render(<QueueBoard />);
    const card = (await screen.findByText(optionalProtocolItem.title)).closest('li');
    expect((card as HTMLElement).querySelector('p')).toBeNull();
  });

  it('mostra estado vazio com significado operacional', async () => {
    getQueue.mockResolvedValue({
      mandatory: [],
      optional: [],
      substitutionMandatory: [],
      substitutionOptional: [],
      counts: {
        mandatory: 0,
        optional: 0,
        substitutionMandatory: 0,
        substitutionOptional: 0,
        total: 0,
      },
    });
    render(<QueueBoard />);
    expect(await screen.findByRole('heading', { name: 'Fila em dia' })).toBeVisible();
  });

  it('permite tentar novamente após falha', async () => {
    getQueue
      .mockRejectedValueOnce(new Error('API indisponível'))
      .mockResolvedValueOnce(queueResponse);
    render(<QueueBoard />);
    expect(await screen.findByRole('alert')).toHaveTextContent('API indisponível');
    await userEvent.click(screen.getByRole('button', { name: /tentar novamente/i }));
    expect(await screen.findByText(protocolItem.title)).toBeVisible();
  });

  it('ordena por idade dentro da mesma categoria sem mutar o array (mais antigo primeiro)', () => {
    const base = queueResponse.mandatory[0];
    if (!base) throw new Error('fixture sem item base');
    const source = [
      { ...base, createdAt: '2026-08-03T12:00:00.000Z' },
      { ...base, id: 'x', createdAt: '2026-08-01T12:00:00.000Z' },
    ];
    const sorted = sortQueue(source);
    expect(sorted[0]?.id).toBe('x');
    expect(source[0]?.id).not.toBe('x');
  });

  it('mantém dados anteriores visíveis quando apenas a atualização falha', async () => {
    getQueue.mockResolvedValueOnce(queueResponse).mockRejectedValueOnce(new Error('timeout'));
    render(<QueueBoard />);
    await screen.findByText(protocolItem.title);
    await userEvent.click(screen.getByRole('button', { name: /^atualizar$/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('timeout'));
    expect(screen.getByText(protocolItem.title)).toBeVisible();
  });

  it('recarrega a fila em queue.updated e encerra o stream ao desmontar', async () => {
    const base = queueResponse.mandatory[0];
    if (!base) throw new Error('fixture sem item base');
    const realtimeItem = {
      ...base,
      id: '77777777-7777-4777-8777-777777777777',
      title: 'Novo caso em tempo real',
    };
    getQueue.mockResolvedValueOnce(queueResponse).mockResolvedValueOnce({
      ...queueResponse,
      mandatory: [...queueResponse.mandatory, realtimeItem],
    });

    const view = render(<QueueBoard />);
    await screen.findByText(protocolItem.title);
    const stream = MockEventSource.instances[0];
    expect(stream?.url).toBe('/api/dashboard/queue/events');

    act(() => {
      stream?.onopen?.(new Event('open'));
      stream?.emit('queue.updated');
    });

    expect(await screen.findByText('Novo caso em tempo real')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Atualização em tempo real ativa');
    expect(getQueue).toHaveBeenCalledTimes(2);

    view.unmount();
    expect(stream?.close).toHaveBeenCalledOnce();
  });

  it('ativa polling apenas como contingência enquanto o EventSource reconecta', async () => {
    vi.useFakeTimers();
    getQueue.mockResolvedValue(queueResponse);
    render(<QueueBoard />);
    await act(async () => Promise.resolve());
    const stream = MockEventSource.instances[0];

    act(() => stream?.onerror?.(new Event('error')));
    expect(screen.getByRole('status')).toHaveTextContent('Tempo real em reconexão');

    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(getQueue).toHaveBeenCalledTimes(2);

    act(() => stream?.onopen?.(new Event('open')));
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(getQueue).toHaveBeenCalledTimes(2);
  });
});
