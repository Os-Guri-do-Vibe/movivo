import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DashboardApiError,
  getOperations,
  getQueue,
  getQueueDetail,
  parseOperations,
  parseQueueDetail,
  parseQueueResponse,
  releaseParq,
  resolveHandoff,
  saveProtocol,
  signProtocol,
} from './dashboard-api';
import {
  operationsResponse,
  protocolContent,
  protocolDetail,
  queueResponse,
} from '../../test/dashboard-fixtures';

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

afterEach(() => vi.restoreAllMocks());

describe('parsers do contrato do dashboard', () => {
  it('valida fila, detalhe e operações', () => {
    expect(parseQueueResponse(queueResponse)).toEqual(queueResponse);
    expect(parseQueueDetail(protocolDetail).protocol?.content.phase).toBe('HIPERTROFIA');
    expect(parseOperations(operationsResponse).sla.protocolBreached).toBe(true);
  });

  it('recusa tipos, prioridades, protocolos e operações fora do contrato', () => {
    expect(() => parseQueueResponse(null)).toThrow(/fila inválida/i);
    expect(() => parseQueueResponse({ items: [null] })).toThrow(/item da fila inválido/i);
    expect(() => parseQueueResponse({ items: [{ ...queueResponse.items[0], id: '' }] })).toThrow(
      /incompleto/i,
    );
    expect(() =>
      parseQueueResponse({ items: [{ ...queueResponse.items[0], kind: 'UNKNOWN' }] }),
    ).toThrow(DashboardApiError);
    expect(() =>
      parseQueueResponse({ items: [{ ...queueResponse.items[0], severity: 'RED' }] }),
    ).toThrow(/prioridade/i);
    expect(() =>
      parseQueueDetail({
        ...protocolDetail,
        protocol: { ...protocolDetail.protocol, content: {} },
      }),
    ).toThrow(/contrato/i);
    expect(() => parseOperations({ funnel: null, sla: {} })).toThrow(/operações/i);
    expect(() =>
      parseQueueDetail({ ...protocolDetail, replay: { messages: [{ role: 'ROBOT' }] } }),
    ).toThrow(/papel de mensagem/i);
    expect(() => parseQueueDetail({ ...protocolDetail, replay: null })).toThrow(/replay/i);
  });

  it('normaliza contagens, contexto, validação, PAR-Q e handoff opcionais', () => {
    const detail = parseQueueDetail({
      ...protocolDetail,
      context: { age: 32, active: true, ignored: { nested: true }, absent: null },
      protocol: {
        ...protocolDetail.protocol,
        validation: { valid: false, issues: ['volume', null] },
        signedAt: 123,
        signatureHash: 123,
      },
      parq: { flags: ['resposta positiva', null], state: '' },
      handoff: { reason: '', level: '', status: '' },
    });
    expect(detail.context).toEqual({ age: 32, active: true, absent: null });
    expect(detail.protocol?.validation).toEqual({ valid: false, issues: ['volume'] });
    expect(detail.protocol?.signedAt).toBeNull();
    expect(detail.parq?.flags).toEqual(['resposta positiva']);
    expect(detail.handoff).toEqual({
      reason: protocolDetail.item.summary,
      level: protocolDetail.item.severity,
      status: protocolDetail.item.status,
    });

    expect(
      parseQueueResponse({
        counts: { total: 3, ignored: '3', infinity: Number.POSITIVE_INFINITY },
        items: [{ ...queueResponse.items[0], ageMinutes: -2, summary: null, status: null }],
      }),
    ).toMatchObject({
      counts: { total: 3 },
      items: [{ ageMinutes: 0, summary: '', status: 'PENDENTE' }],
    });
  });

  it('preserva primeiro treino indisponível sem inventar zero', () => {
    const parsed = parseOperations({
      ...operationsResponse,
      funnel: { ...operationsResponse.funnel, firstWorkout: null },
      sla: { ...operationsResponse.sla, protocolDeliveryMinutes: null, coachP95Seconds: null },
    });
    expect(parsed.funnel.firstWorkout).toBeNull();
    expect(parsed.sla.protocolDeliveryMinutes).toBeNull();
    expect(parsed.sla.coachP95Seconds).toBeNull();
  });
});

describe('cliente BFF same-origin', () => {
  it('lê fila e operações com credenciais same-origin', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, queueResponse))
      .mockResolvedValueOnce(response(200, operationsResponse));
    vi.stubGlobal('fetch', fetchMock);
    await expect(getQueue()).resolves.toEqual(queueResponse);
    await expect(getOperations()).resolves.toEqual(operationsResponse);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/dashboard/queue');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: 'same-origin' });
  });

  it('lê detalhe e aplica fallback para corpo de erro não JSON', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, protocolDetail))
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => Promise.reject(new Error()),
      });
    vi.stubGlobal('fetch', fetchMock);
    await expect(getQueueDetail('PROTOCOL', 'id com espaço')).resolves.toEqual(protocolDetail);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/dashboard/queue/protocol/id%20com%20espa%C3%A7o',
    );
    await expect(getQueue()).rejects.toMatchObject({ status: 503 });
  });

  it('envia apenas o recurso e decisão, nunca user_id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, { status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);
    await saveProtocol('p1', protocolContent, 'Ajuste profissional');
    await signProtocol('p1');
    await releaseParq('q1', 'Revisado');
    await resolveHandoff('h1', 'Contato realizado', 'Registro');
    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit;
      expect(String(init.body ?? '')).not.toContain('user_id');
    }
    expect(fetchMock.mock.calls[2]?.[1]?.body).toBe(
      JSON.stringify({ decision: 'RELEASED', notes: 'Revisado', confirmation: true }),
    );
  });

  it('propaga mensagem e detalhes seguros de validação', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(response(422, { message: 'Edição bloqueada.', validation: ['volume'] })),
    );
    await expect(saveProtocol('p1', protocolContent, 'motivo')).rejects.toMatchObject({
      status: 422,
      message: 'Edição bloqueada.',
      details: ['volume'],
    });
  });
});
