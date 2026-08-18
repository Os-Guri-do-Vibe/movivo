import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AnamnesisApiError,
  getSession,
  isPhoneComplete,
  maskNationalPhone,
  parsePhoneE164,
  sendPhoneCode,
  startAnamnesis,
  submitAnamnesis,
  SUPPORTED_PHONE_COUNTRIES,
  toE164,
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

describe('telefone internacional', () => {
  it('oferece todos os países e territórios sem metadados de bandeira', () => {
    expect(SUPPORTED_PHONE_COUNTRIES.length).toBeGreaterThan(200);
    expect(SUPPORTED_PHONE_COUNTRIES[0]).toMatchObject({
      iso: 'BR',
      name: 'Brasil',
      callingCode: '+55',
    });
    expect(SUPPORTED_PHONE_COUNTRIES.every((country) => !('flag' in country))).toBe(true);

    for (const expected of [
      { iso: 'US', callingCode: '+1' },
      { iso: 'PT', callingCode: '+351' },
      { iso: 'JP', callingCode: '+81' },
      { iso: 'NG', callingCode: '+234' },
    ]) {
      expect(SUPPORTED_PHONE_COUNTRIES).toContainEqual(expect.objectContaining(expected));
    }
  });

  it('aplica a máscara do país progressivamente', () => {
    expect(maskNationalPhone('BR', '11')).toBe('(11)');
    expect(maskNationalPhone('BR', '11999')).toBe('(11) 999');
    expect(maskNationalPhone('BR', '11999999999')).toBe('(11) 99999-9999');
    expect(maskNationalPhone('PT', '912345678')).toBe('912 345 678');
    expect(maskNationalPhone('US', '2025550123')).toBe('(202) 555-0123');
    expect(maskNationalPhone('JP', '09012345678')).toBe('090-1234-5678');
    expect(maskNationalPhone('NG', '08021234567')).toBe('0802 123 4567');
  });

  it('usa os exemplos móveis reais como placeholder e validação de comprimento', () => {
    for (const country of SUPPORTED_PHONE_COUNTRIES) {
      expect(country.placeholder).not.toBe('');
      expect(isPhoneComplete(country.iso, country.placeholder)).toBe(true);
    }
    expect(isPhoneComplete('BR', '(11) 9999-999')).toBe(false);
  });

  it('BR: celular faltando o último dígito não é "completo" mesmo batendo o formato de um fixo válido (bug real)', () => {
    // 10 dígitos nacionais (DDD + 8) é, por coincidência, o mesmo comprimento de um
    // fixo brasileiro válido — sem restringir por tipo, isValidPhoneNumber aceitava
    // isso como "completo" um dígito antes do celular real terminar de ser digitado,
    // fazendo o campo do código de verificação aparecer cedo e o envio ir pro número
    // truncado errado.
    expect(isPhoneComplete('BR', '(11) 98765-432')).toBe(false);
    expect(isPhoneComplete('BR', '(11) 98765-4321')).toBe(true);
  });

  it('combina DDI e número nacional em E.164', () => {
    expect(toE164('BR', '(11) 99999-9999')).toBe('+5511999999999');
    expect(toE164('PT', '912 345 678')).toBe('+351912345678');
    expect(toE164('JP', '090-1234-5678')).toBe('+819012345678');
    expect(toE164('NG', '0802 123 4567')).toBe('+2348021234567');
  });

  it('reidrata país e máscara do E.164 persistido', () => {
    expect(parsePhoneE164('+351912345678')).toEqual({
      countryIso: 'PT',
      phoneMasked: '912 345 678',
    });
    expect(parsePhoneE164('+819012345678')).toEqual({
      countryIso: 'JP',
      phoneMasked: '090-1234-5678',
    });
    expect(parsePhoneE164('+12423591234')).toEqual({
      countryIso: 'BS',
      phoneMasked: '(242) 359-1234',
    });
    expect(parsePhoneE164('+999123')).toBeNull();
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
