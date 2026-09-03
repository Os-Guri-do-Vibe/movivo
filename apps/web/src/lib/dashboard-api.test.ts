import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  approveSubstitutionNow,
  DashboardApiError,
  discardSubstitution,
  getOperations,
  getQueue,
  getQueueDetail,
  parseOperations,
  parseQueueDetail,
  parseQueueResponse,
  resolveHandoff,
  saveProtocol,
  signProtocol,
} from './dashboard-api';
import {
  operationsResponse,
  protocolContent,
  protocolDetail,
  queueResponse,
  substitutionDetail,
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
    expect(() =>
      parseQueueResponse({
        mandatory: [null],
        optional: [],
        substitutionMandatory: [],
        substitutionOptional: [],
      }),
    ).toThrow(/item da fila inválido/i);
    expect(() =>
      parseQueueResponse({
        mandatory: [{ ...queueResponse.mandatory[0], id: '' }],
        optional: [],
        substitutionMandatory: [],
        substitutionOptional: [],
      }),
    ).toThrow(/incompleto/i);
    expect(() =>
      parseQueueResponse({
        mandatory: [{ ...queueResponse.mandatory[0], kind: 'UNKNOWN' }],
        optional: [],
        substitutionMandatory: [],
        substitutionOptional: [],
      }),
    ).toThrow(DashboardApiError);
    // `PARQ` saiu do enum em 2026-08-24 e é hoje um kind desconhecido como outro qualquer.
    expect(() =>
      parseQueueResponse({
        mandatory: [{ ...queueResponse.mandatory[0], kind: 'PARQ' }],
        optional: [],
        substitutionMandatory: [],
        substitutionOptional: [],
      }),
    ).toThrow(DashboardApiError);
    expect(() =>
      parseQueueResponse({
        mandatory: [{ ...queueResponse.mandatory[0], severity: 'RED' }],
        optional: [],
        substitutionMandatory: [],
        substitutionOptional: [],
      }),
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

  it('normaliza contagens, contexto, validação e handoff opcionais', () => {
    const detail = parseQueueDetail({
      ...protocolDetail,
      context: { age: 32, active: true, ignored: { nested: true }, absent: null },
      protocol: {
        ...protocolDetail.protocol,
        validation: { valid: false, issues: ['volume', null] },
        signedAt: 123,
        signatureHash: 123,
      },
      handoff: { reason: '', level: '', status: '' },
    });
    expect(detail.context).toEqual({ age: 32, active: true, absent: null });
    expect(detail.protocol?.validation).toEqual({ valid: false, issues: ['volume'] });
    expect(detail.protocol?.signedAt).toBeNull();
    expect(detail.handoff).toEqual({
      reason: protocolDetail.item.summary,
      level: protocolDetail.item.severity,
      status: protocolDetail.item.status,
    });

    expect(
      parseQueueResponse({
        counts: { mandatory: 1, optional: 0, total: 3, ignored: '3' },
        mandatory: [{ ...queueResponse.mandatory[0], ageMinutes: -2, summary: null, status: null }],
        optional: [],
        substitutionMandatory: [],
        substitutionOptional: [],
      }),
    ).toMatchObject({
      counts: { mandatory: 1, optional: 0, total: 3 },
      mandatory: [{ ageMinutes: 0, summary: '', status: 'PENDENTE' }],
    });
  });

  // `origin` é legenda, não contrato de renderização: valor fora do par PARQ/EDIT (ou
  // ausente, como num backend antigo) vira `null` sem derrubar a fila inteira.
  it('preserva a origem do protocolo obrigatório e degrada valor desconhecido para null', () => {
    const base = queueResponse.mandatory[0];
    if (!base) throw new Error('fixture sem item obrigatório');
    const empty = { optional: [], substitutionMandatory: [], substitutionOptional: [] };
    expect(parseQueueResponse({ mandatory: [base], ...empty }).mandatory[0]?.origin).toBe('PARQ');
    expect(
      parseQueueResponse({ mandatory: [{ ...base, origin: 'EDIT' }], ...empty }).mandatory[0]
        ?.origin,
    ).toBe('EDIT');
    for (const origin of ['DESCONHECIDA', undefined, null]) {
      expect(
        parseQueueResponse({ mandatory: [{ ...base, origin }], ...empty }).mandatory[0]?.origin,
      ).toBeNull();
    }
  });

  // Achado 2026-09-02, ampliado 2026-09-03 — fluxo de substituição de exercício via IA,
  // agora também com par obrigatória/opcional próprio.
  it('valida item e detalhe de substituição', () => {
    expect(
      parseQueueResponse({
        mandatory: [],
        optional: [],
        substitutionMandatory: [],
        substitutionOptional: [substitutionDetail.item],
      }),
    ).toEqual({
      mandatory: [],
      optional: [],
      substitutionMandatory: [],
      substitutionOptional: [substitutionDetail.item],
      counts: {
        mandatory: 0,
        optional: 0,
        substitutionMandatory: 0,
        substitutionOptional: 0,
        total: 0,
      },
    });
    const detail = parseQueueDetail(substitutionDetail);
    expect(detail.substitution).toEqual(substitutionDetail.substitution);
  });

  it('recusa detalhe de substituição com estado desconhecido', () => {
    expect(() =>
      parseQueueDetail({
        ...substitutionDetail,
        substitution: { ...substitutionDetail.substitution, status: 'UNKNOWN' },
      }),
    ).toThrow(/estado da substituição/i);
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
    await resolveHandoff('h1', 'Contato realizado', 'Registro');
    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit;
      expect(String(init.body ?? '')).not.toContain('user_id');
    }
    expect(fetchMock.mock.calls[2]?.[1]?.body).toBe(
      JSON.stringify({
        resolution: 'Contato realizado',
        notes: 'Registro',
        confirmation: true,
      }),
    );
  });

  // A liberação do PAR-Q acontece DENTRO da assinatura no backend (2026-08-24) — não há
  // mais rota `/parq/{id}/release` no BFF, e assinar é a única chamada que o RT dispara.
  it('assina o protocolo sem nenhuma chamada extra de liberação PAR-Q', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, { status: 'SIGNED' }));
    vi.stubGlobal('fetch', fetchMock);
    await signProtocol('p1');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/dashboard/protocols/p1/sign');
  });

  it('aprova ou recusa a substituição no endpoint certo, sem corpo', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, { status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);
    await approveSubstitutionNow('s1');
    await discardSubstitution('s1');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/dashboard/substitutions/s1/approve');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/dashboard/substitutions/s1/discard');
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).method).toBe('POST');
      expect((call[1] as RequestInit).body).toBeUndefined();
    }
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
