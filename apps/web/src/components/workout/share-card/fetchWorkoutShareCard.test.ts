import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchWorkoutShareCard, shareCardVersion } from './fetchWorkoutShareCard';
import { fullBodyShareCardMock, workoutShareCardMock } from './workout-share-card.mocks';

const ID = '22222222-2222-4222-8222-222222222222';
const png = () =>
  new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
    status: 200,
    headers: { 'Content-Type': 'image/png' },
  });
const status = (code: number) => new Response(null, { status: code });

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('fetchWorkoutShareCard', () => {
  it('baixa o PNG da rota do BFF', async () => {
    const fetchMock = vi.fn(async (_url: string) => png());
    vi.stubGlobal('fetch', fetchMock);
    const blob = await fetchWorkoutShareCard(ID, new AbortController().signal);
    expect(blob.type).toBe('image/png');
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/workout/sessions/${ID}/share-card`);
  });

  it('versiona a URL pelo conteúdo: o card corrigido nunca reutiliza o cache do antigo', async () => {
    const fetchMock = vi.fn(async (_url: string) => png());
    vi.stubGlobal('fetch', fetchMock);
    const version = shareCardVersion(workoutShareCardMock);
    await fetchWorkoutShareCard(ID, new AbortController().signal, version);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `/api/workout/sessions/${ID}/share-card?v=${encodeURIComponent(version)}`,
    );
    expect(version).not.toBe(shareCardVersion(fullBodyShareCardMock));
    expect(version).toBe(
      shareCardVersion({
        ...workoutShareCardMock,
        workout: {
          ...workoutShareCardMock.workout,
          muscleGroupsForHighlighter: [
            ...workoutShareCardMock.workout.muscleGroupsForHighlighter,
          ].reverse(),
        },
      }),
    );
  });

  it('refaz a busca em 5xx e em queda de rede, até recuperar', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(status(503))
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(png());
    vi.stubGlobal('fetch', fetchMock);
    const promise = fetchWorkoutShareCard(ID, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(promise).resolves.toHaveProperty('type', 'image/png');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('desiste após 3 tentativas', async () => {
    const fetchMock = vi.fn(async () => status(502));
    vi.stubGlobal('fetch', fetchMock);
    const promise = fetchWorkoutShareCard(ID, new AbortController().signal);
    const settled = expect(promise).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(5_000);
    await settled;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('não insiste em 401/404 e rejeita corpo que não é PNG', async () => {
    const fetchMock = vi.fn(async () => status(404));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchWorkoutShareCard(ID, new AbortController().signal)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborta uma tentativa lenta por timeout e tenta de novo', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) =>
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('x', 'AbortError')),
            ),
          ),
      )
      .mockResolvedValueOnce(png());
    vi.stubGlobal('fetch', fetchMock);
    const promise = fetchWorkoutShareCard(ID, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(12_000);
    await expect(promise).resolves.toHaveProperty('type', 'image/png');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('cancelar (desmontagem) interrompe sem novas tentativas', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => status(503));
    vi.stubGlobal('fetch', fetchMock);
    const promise = fetchWorkoutShareCard(ID, controller.signal);
    const settled = expect(promise).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(5_000);
    await settled;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
