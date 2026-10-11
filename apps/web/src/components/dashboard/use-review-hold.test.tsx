import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { REVIEW_HOLD_HEARTBEAT_MS, useReviewHold } from './use-review-hold';

const ID = '11111111-1111-4111-8111-111111111111';
const URL = `/api/dashboard/protocols/${ID}/review-hold`;

const bodiesOf = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string));

describe('useReviewHold', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let sendBeacon: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn(async () => new Response('{}'));
    sendBeacon = vi.fn(() => true);
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: sendBeacon });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('troca de exercício usa o recurso próprio (substitutions), com o mesmo contrato', () => {
    const { unmount } = renderHook(() => useReviewHold('SUBSTITUTION', ID, true));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/dashboard/substitutions/${ID}/review-hold`,
      expect.objectContaining({ body: JSON.stringify({ active: true }) }),
    );
    unmount();
    expect(sendBeacon).toHaveBeenCalledWith(
      `/api/dashboard/substitutions/${ID}/review-hold`,
      expect.any(Blob),
    );
  });

  it('ao abrir a tela já avisa o servidor, com credencial e keepalive', () => {
    renderHook(() => useReviewHold('PROTOCOL', ID, true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      URL,
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
        body: JSON.stringify({ active: true }),
      }),
    );
  });

  it('renova a trava periodicamente enquanto a tela segue aberta', () => {
    renderHook(() => useReviewHold('PROTOCOL', ID, true));
    vi.advanceTimersByTime(REVIEW_HOLD_HEARTBEAT_MS * 3);
    expect(bodiesOf(fetchMock)).toEqual([
      { active: true },
      { active: true },
      { active: true },
      { active: true },
    ]);
  });

  it('ao sair da tela (voltar à fila) solta a trava e para de renovar', () => {
    const { unmount } = renderHook(() => useReviewHold('PROTOCOL', ID, true));
    unmount();
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [url, blob] = sendBeacon.mock.calls[0] as [string, Blob];
    expect(url).toBe(URL);
    expect(blob.type).toBe('application/json');

    fetchMock.mockClear();
    vi.advanceTimersByTime(REVIEW_HOLD_HEARTBEAT_MS * 3);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ao fechar a aba (pagehide) solta a trava uma única vez, mesmo desmontando depois', () => {
    const { unmount } = renderHook(() => useReviewHold('PROTOCOL', ID, true));
    window.dispatchEvent(new Event('pagehide'));
    unmount();
    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });

  it('sem sendBeacon (ou se ele recusar), cai no fetch de saída', () => {
    sendBeacon.mockReturnValue(false);
    const { unmount } = renderHook(() => useReviewHold('PROTOCOL', ID, true));
    fetchMock.mockClear();
    unmount();
    expect(bodiesOf(fetchMock)).toEqual([{ active: false }]);
  });

  it('desligado (protocolo sem envio automático) não avisa nada', () => {
    const { unmount } = renderHook(() => useReviewHold('PROTOCOL', ID, false));
    vi.advanceTimersByTime(REVIEW_HOLD_HEARTBEAT_MS * 2);
    unmount();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('se o aviso falhar, não derruba a tela', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(() => renderHook(() => useReviewHold('PROTOCOL', ID, true))).not.toThrow();
    await vi.advanceTimersByTimeAsync(REVIEW_HOLD_HEARTBEAT_MS);
  });

  it('ligar depois (detalhe carregou) começa a segurar; desligar solta', () => {
    const { rerender } = renderHook(({ on }) => useReviewHold('PROTOCOL', ID, on), {
      initialProps: { on: false },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    rerender({ on: true });
    expect(bodiesOf(fetchMock)).toEqual([{ active: true }]);
    rerender({ on: false });
    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });
});
