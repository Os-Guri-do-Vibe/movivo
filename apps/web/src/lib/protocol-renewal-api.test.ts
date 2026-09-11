/**
 * Testes do cliente HTTP do formulário de renovação de mesociclo. `fetch` é mockado —
 * o contrato do backend é exercitado no E2E.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getRenewalSession,
  patchRenewalStep,
  ProtocolRenewalApiError,
  submitRenewal,
} from './protocol-renewal-api';

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getRenewalSession', () => {
  it('GET na sessão pelo token e devolve a view', async () => {
    const fetchMock = mockFetch(200, { status: 'IN_PROGRESS', currentStep: 2 });
    vi.stubGlobal('fetch', fetchMock);
    const view = await getRenewalSession('tok-123');
    expect(view).toEqual({ status: 'IN_PROGRESS', currentStep: 2 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/protocol-renewal/session/tok-123');
    expect(init.cache).toBe('no-store');
  });

  it('sessão vencida (410) lança ProtocolRenewalApiError com o status', async () => {
    vi.stubGlobal('fetch', mockFetch(410, { message: 'Sessão de renovação expirada.' }));
    await expect(getRenewalSession('tok-expired')).rejects.toMatchObject({
      status: 410,
      issues: ['Sessão de renovação expirada.'],
    });
  });

  it('erro sem corpo JSON válido cai em issues vazio', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    try {
      await getRenewalSession('tok-500');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ProtocolRenewalApiError);
      expect((err as ProtocolRenewalApiError).issues).toEqual([]);
    }
  });
});

describe('patchRenewalStep', () => {
  it('PATCH no bloco com o payload serializado', async () => {
    const fetchMock = mockFetch(200, { currentStep: 3 });
    vi.stubGlobal('fetch', fetchMock);
    const res = await patchRenewalStep('tok-123', 2, { fatigueLevel: 'MODERADO' });
    expect(res.currentStep).toBe(3);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/protocol-renewal/session/tok-123/step/2');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ fatigueLevel: 'MODERADO' });
  });

  it('payload inválido (400) lança com as issues do backend', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(400, { message: ['Informe a intensidade (0-10).', 'Informe a região.'] }),
    );
    await expect(patchRenewalStep('tok-123', 3, {})).rejects.toMatchObject({
      status: 400,
      issues: ['Informe a intensidade (0-10).', 'Informe a região.'],
    });
  });
});

describe('submitRenewal', () => {
  it('POST no submit e devolve o status', async () => {
    const fetchMock = mockFetch(200, { status: 'SUBMITTED' });
    vi.stubGlobal('fetch', fetchMock);
    const res = await submitRenewal('tok-123');
    expect(res.status).toBe('SUBMITTED');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/protocol-renewal/session/tok-123/submit');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  it('sessão já enviada (409) lança ProtocolRenewalApiError', async () => {
    vi.stubGlobal('fetch', mockFetch(409, { message: 'Este formulário já foi enviado.' }));
    await expect(submitRenewal('tok-123')).rejects.toMatchObject({ status: 409 });
  });
});
