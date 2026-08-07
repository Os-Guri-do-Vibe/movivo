import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { queueResponse } from '../../../test/dashboard-fixtures';

const { getQueue } = vi.hoisted(() => ({ getQueue: vi.fn() }));
vi.mock('@/lib/dashboard-api', () => ({
  getQueue,
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
  MockEventSource.instances = [];
  vi.stubGlobal('EventSource', MockEventSource);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('QueueBoard', () => {
  it('coloca SAFETY antes das demais prioridades e mantém rótulos textuais', async () => {
    getQueue.mockResolvedValue(queueResponse);
    render(<QueueBoard />);
    const list = await screen.findByRole('list', { name: /itens pendentes/i });
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Segurança · ação prioritária');
    expect(items[1]).toHaveTextContent('Atenção');
    expect(items[2]).toHaveTextContent('Revisão de rotina');
  });

  it('mostra estado vazio com significado operacional', async () => {
    getQueue.mockResolvedValue({ items: [], counts: {} });
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
    expect(await screen.findByText('Relato exige atenção profissional')).toBeVisible();
  });

  it('ordena por idade dentro da mesma prioridade sem mutar o array', () => {
    const base = queueResponse.items[0];
    if (!base) throw new Error('fixture sem item base');
    const source = [
      { ...base, ageMinutes: 2 },
      { ...base, id: 'x', ageMinutes: 20 },
    ];
    const sorted = sortQueue(source);
    expect(sorted[0]?.id).toBe('x');
    expect(source[0]?.ageMinutes).toBe(2);
  });

  it('mantém dados anteriores visíveis quando apenas a atualização falha', async () => {
    getQueue.mockResolvedValueOnce(queueResponse).mockRejectedValueOnce(new Error('timeout'));
    render(<QueueBoard />);
    await screen.findByText('Relato exige atenção profissional');
    await userEvent.click(screen.getByRole('button', { name: /atualizar fila/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('timeout'));
    expect(screen.getByText('Relato exige atenção profissional')).toBeVisible();
  });

  it('recarrega a fila em queue.updated e encerra o stream ao desmontar', async () => {
    const base = queueResponse.items[0];
    if (!base) throw new Error('fixture sem item base');
    const realtimeItem = {
      ...base,
      id: '55555555-5555-4555-8555-555555555555',
      title: 'Novo caso em tempo real',
    };
    getQueue.mockResolvedValueOnce(queueResponse).mockResolvedValueOnce({
      ...queueResponse,
      items: [...queueResponse.items, realtimeItem],
    });

    const view = render(<QueueBoard />);
    await screen.findByText('Relato exige atenção profissional');
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
