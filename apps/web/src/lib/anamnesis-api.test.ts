/**
 * Testes do cliente HTTP da anamnese (US-1.6): mapeamento de objetivo, envelope de
 * erro (rede vs. status) e persistência do token. `fetch` é mockado — o contrato do
 * backend é exercitado no E2E (US-1.8).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  clearToken,
  getStoredToken,
  mapGoal,
  patchBlock,
  recordConsents,
  startAnamnesis,
  storeToken,
  submitAnamnesis,
} from './anamnesis-api';

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mapGoal', () => {
  it('mapeia os objetivos da landing para o enum do contrato', () => {
    expect(mapGoal('perder_peso')).toBe('LOSE_WEIGHT');
    expect(mapGoal('ganhar_massa')).toBe('GAIN_MUSCLE');
    expect(mapGoal('condicionamento')).toBe('CONDITIONING');
  });

  it('devolve undefined para ausente ou desconhecido', () => {
    expect(mapGoal(null)).toBeUndefined();
    expect(mapGoal('foo')).toBeUndefined();
  });
});

describe('token no cliente', () => {
  it('guarda, lê e limpa o token', () => {
    expect(getStoredToken()).toBeNull();
    storeToken('abc');
    expect(getStoredToken()).toBe('abc');
    clearToken();
    expect(getStoredToken()).toBeNull();
  });
});

describe('requisições', () => {
  it('start envia primaryGoal mapeado e retorna o token', async () => {
    const fetchSpy = mockFetch(201, { token: 't1', expiresAt: 'x', lastBlock: 1 });
    vi.stubGlobal('fetch', fetchSpy);
    const res = await startAnamnesis('ganhar_massa');
    expect(res.token).toBe('t1');
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.primaryGoal).toBe('GAIN_MUSCLE');
  });

  it('204 (consentimento) resolve sem corpo', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 204 } as Response);
    vi.stubGlobal('fetch', fetchSpy);
    await expect(
      recordConsents('t1', [{ type: 'HEALTH_DATA', version: 'v', accepted: true }]),
    ).resolves.toBeUndefined();
  });

  it('erro de rede vira ApiError status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(submitAnamnesis('t1')).rejects.toMatchObject({ status: 0 });
  });

  it('status de erro vira ApiError com a mensagem do servidor', async () => {
    vi.stubGlobal('fetch', mockFetch(403, { message: 'Consentimento de saúde é obrigatório.' }));
    const err = await patchBlock('t1', 2, {
      parq: { version: 'v', answers: [] },
    } as never).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
    expect((err as ApiError).message).toContain('Consentimento');
  });
});
