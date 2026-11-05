import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { REVIEW_HOLD_HEARTBEAT_MS, useReviewHold } from './use-review-hold';

const ID = '11111111-1111-4111-8111-111111111111';
const URL = `/api/dashboard/control/exceptions/${ID}/review-hold`;

const fetchMock = vi.fn();
const sendBeacon = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset().mockResolvedValue(new Response('{}'));
  sendBeacon.mockReset().mockReturnValue(true);
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(navigator, 'sendBeacon', { value: sendBeacon, configurable: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const bodies = () =>
  fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));

describe('useReviewHold', () => {
  it('segura o envio ao abrir a tela e renova a trava enquanto ela fica aberta', () => {
    renderHook(() => useReviewHold(ID, true));
    expect(fetchMock).toHaveBeenCalledWith(URL, expect.objectContaining({ method: 'POST' }));
    expect(bodies()).toEqual([{ active: true }]);

    vi.advanceTimersByTime(REVIEW_HOLD_HEARTBEAT_MS * 2);
    expect(bodies()).toEqual([{ active: true }, { active: true }, { active: true }]);
  });

  it('solta a trava ao sair da tela, para o envio vencido sair na hora', () => {
    const { unmount } = renderHook(() => useReviewHold(ID, true));
    unmount();
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon.mock.calls[0]?.[0]).toBe(URL);
    vi.advanceTimersByTime(REVIEW_HOLD_HEARTBEAT_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(1); // nenhuma renovação depois de sair
  });

  it('sem beacon, cai para fetch ao soltar', () => {
    sendBeacon.mockReturnValue(false);
    const { unmount } = renderHook(() => useReviewHold(ID, true));
    unmount();
    expect(bodies().at(-1)).toEqual({ active: false });
  });

  it('não faz nada quando o caso não tem liberação automática', () => {
    const { unmount } = renderHook(() => useReviewHold(ID, false));
    unmount();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendBeacon).not.toHaveBeenCalled();
  });
});
