import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AnamnesisApiError,
  getSession,
  maskPhoneBR,
  sendPhoneCode,
  startAnamnesis,
  submitAnamnesis,
  toE164BR,
  verifyPhoneCode,
} from './anamnesis-api';

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

describe('maskPhoneBR', () => {
  it('aplica a máscara (xx) xxxxx-xxxx progressivamente', () => {
    expect(maskPhoneBR('11')).toBe('11');
    expect(maskPhoneBR('11999')).toBe('(11) 999');
    expect(maskPhoneBR('11999999999')).toBe('(11) 99999-9999');
  });

  it('ignora dígitos além do 11º', () => {
    expect(maskPhoneBR('119999999999999')).toBe('(11) 99999-9999');
  });
});

describe('toE164BR', () => {
  it('converte a máscara para E.164 com +55', () => {
    expect(toE164BR('(11) 99999-9999')).toBe('+5511999999999');
  });
});

describe('startAnamnesis', () => {
  it('POST /anamnesis/start e devolve o token', async () => {
    const fetchMock = mockFetch(201, { token: 'abc', expiresAt: 'x', currentStep: 1 });
    vi.stubGlobal('fetch', fetchMock);
    const res = await startAnamnesis();
    expect(res.token).toBe('abc');
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/anamnesis/start');
  });
});

describe('getSession', () => {
  it('GET /anamnesis/session/{token}', async () => {
    const fetchMock = mockFetch(200, { status: 'IN_PROGRESS', currentStep: 1 });
    vi.stubGlobal('fetch', fetchMock);
    await getSession('tok123');
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/anamnesis/session/tok123');
  });

  it('lança AnamnesisApiError em 404', async () => {
    vi.stubGlobal('fetch', mockFetch(404, { message: 'não encontrada' }));
    await expect(getSession('bad')).rejects.toBeInstanceOf(AnamnesisApiError);
  });
});

describe('sendPhoneCode / verifyPhoneCode', () => {
  it('envia o número e recebe o estado de reenvio', async () => {
    const fetchMock = mockFetch(200, { sent: true, resendAvailableAt: 'x', expiresAt: 'y' });
    vi.stubGlobal('fetch', fetchMock);
    const res = await sendPhoneCode('tok', '+5511999999999');
    expect(res.sent).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ phoneNumber: '+5511999999999' });
  });

  it('verifica o código', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { phoneVerified: true }));
    const res = await verifyPhoneCode('tok', '123456');
    expect(res.phoneVerified).toBe(true);
  });
});

describe('submitAnamnesis', () => {
  it('devolve status e outcome, nada mais', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { status: 'SUBMITTED', outcome: 'READY' }));
    const res = await submitAnamnesis('tok');
    expect(res).toEqual({ status: 'SUBMITTED', outcome: 'READY' });
  });
});
