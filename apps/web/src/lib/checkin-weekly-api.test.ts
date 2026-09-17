/**
 * Testes do cliente HTTP do check-in semanal. `fetch` é mockado — o contrato do backend é
 * exercitado no lado da API.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CheckinWeeklyApiError,
  getCheckinWeeklySession,
  submitCheckinWeekly,
} from './checkin-weekly-api';

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

describe('getCheckinWeeklySession', () => {
  it('GET no endpoint de sessão e devolve status/semana', async () => {
    const fetchMock = mockFetch(200, { status: 'PENDING', firstName: 'Ana', weekNumber: 4 });
    vi.stubGlobal('fetch', fetchMock);
    const session = await getCheckinWeeklySession('token123');
    expect(session).toEqual({ status: 'PENDING', firstName: 'Ana', weekNumber: 4 });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/checkin/session/token123');
  });

  it('lança CheckinWeeklyApiError em status de erro', async () => {
    vi.stubGlobal('fetch', mockFetch(404, { message: 'Check-in não encontrado.' }));
    await expect(getCheckinWeeklySession('token123')).rejects.toThrow('request_failed_404');
  });

  it('erro sem corpo de mensagem: issues fica vazio', async () => {
    vi.stubGlobal('fetch', mockFetch(500, {}));
    try {
      await getCheckinWeeklySession('token123');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CheckinWeeklyApiError);
      expect((err as CheckinWeeklyApiError).issues).toEqual([]);
    }
  });

  it('erro cujo corpo não é JSON válido: issues fica vazio (catch do .json())', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new SyntaxError('corpo não é JSON');
      },
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    try {
      await getCheckinWeeklySession('token123');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CheckinWeeklyApiError);
      expect((err as CheckinWeeklyApiError).issues).toEqual([]);
    }
  });

  it('sucesso cujo corpo não é JSON válido: cai no objeto vazio (catch do .json())', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('corpo vazio');
      },
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    await expect(getCheckinWeeklySession('token123')).resolves.toEqual({});
  });
});

describe('submitCheckinWeekly', () => {
  it('POST no endpoint de submit com o payload completo', async () => {
    const fetchMock = mockFetch(200, { status: 'SUBMITTED' });
    vi.stubGlobal('fetch', fetchMock);
    const payload = {
      sleepQuality: 'BOA' as const,
      mood: 'FELIZ' as const,
      nutritionScore: 8,
      adherenceScore: 9,
      changesNoticed: [],
      durationFit: 'ADEQUADA' as const,
    };
    const result = await submitCheckinWeekly('token123', payload);
    expect(result).toEqual({ status: 'SUBMITTED' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/checkin/session/token123/submit');
    expect(JSON.parse(init.body as string)).toEqual(payload);
  });

  it('lança CheckinWeeklyApiError com issues em 400', async () => {
    vi.stubGlobal('fetch', mockFetch(400, { message: ['Informe a duração do treino.'] }));
    try {
      await submitCheckinWeekly('token123', {
        sleepQuality: 'BOA' as const,
        mood: 'FELIZ' as const,
        nutritionScore: 8,
        adherenceScore: 9,
        changesNoticed: [],
        durationFit: 'ADEQUADA' as const,
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CheckinWeeklyApiError);
      expect((err as CheckinWeeklyApiError).issues).toEqual(['Informe a duração do treino.']);
    }
  });
});
