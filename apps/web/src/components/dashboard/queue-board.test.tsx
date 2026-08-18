import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  optionalProtocolItem,
  parqItem,
  protocolItem,
  queueResponse,
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

  it('os dois containeres têm a mesma estilização de borda sólida, sem contador no título', async () => {
    getQueue.mockResolvedValue(queueResponse);
    render(<QueueBoard />);
    const mandatorySection = await screen.findByRole('region', {
      name: 'Revisão Humana Obrigatória',
    });
    const optionalSection = screen.getByRole('region', { name: 'Revisão Humana Opcional' });
    expect(mandatorySection.className).toBe(optionalSection.className);
    expect(mandatorySection.className).toContain('border-border');
    const mandatoryHeading = screen.getByRole('heading', { name: 'Revisão Humana Obrigatória' });
    const optionalHeading = screen.getByRole('heading', { name: 'Revisão Humana Opcional' });
    // Antes o contador vinha logo depois do título, dentro do mesmo agrupamento — sem
    // ele, o próximo irmão do título já é a lista/estado vazio da seção.
    expect(mandatoryHeading.nextElementSibling?.tagName).not.toBe('SPAN');
    expect(optionalHeading.nextElementSibling?.tagName).not.toBe('SPAN');
  });

  it('esconde o badge de severidade "Revisão de rotina" (é o de todo protocolo, não diferencia nada)', async () => {
    getQueue.mockResolvedValue(queueResponse);
    render(<QueueBoard />);
    await screen.findByText(optionalProtocolItem.title);
    expect(screen.queryByText('Revisão de rotina')).not.toBeInTheDocument();
    // PAR-Q é severidade ALERT — o badge continua aparecendo, porque ali diferencia.
    expect(screen.getByText('Atenção')).toBeVisible();
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

  it('esconde o badge de status quando é PENDING_SIGNATURE (ruído, é o status de quase todo item aqui)', async () => {
    getQueue.mockResolvedValue({
      ...queueResponse,
      optional: [{ ...optionalProtocolItem, status: 'PENDING_SIGNATURE', summary: 'PENDING_SIGNATURE' }],
    });
    render(<QueueBoard />);
    const card = (await screen.findByText(optionalProtocolItem.title)).closest('li');
    expect(within(card as HTMLElement).queryByText('PENDING_SIGNATURE')).not.toBeInTheDocument();
  });

  it('card de PAR-Q também tem "Ver respostas" (achado 2026-08-18: olho nas duas caixas)', async () => {
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
    const card = (await screen.findByText(parqItem.title)).closest('li');
    expect(card).not.toBeNull();

    expect(within(card as HTMLElement).getByRole('link', { name: /Abrir/i })).toHaveAttribute(
      'href',
      `/dashboard/fila/parq/${parqItem.id}`,
    );

    const viewAnswers = within(card as HTMLElement).getByRole('button', {
      name: /Ver respostas/i,
    });
    await user.click(viewAnswers);

    // PARQ usa a sessão diretamente (ainda não virou protocolo) — endpoint diferente do PROTOCOL.
    expect(getAnamnesisAnswers).toHaveBeenCalledWith('PARQ', parqItem.id, expect.anything());
    expect(await screen.findByRole('dialog', { name: /Respostas da anamnese/i })).toBeVisible();
    expect(screen.getByText('Carla Teste')).toBeVisible();
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
      counts: { mandatory: 0, optional: 0, total: 0 },
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
    await userEvent.click(screen.getByRole('button', { name: /atualizar fila/i }));
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
