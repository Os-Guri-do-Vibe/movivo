import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  amendActiveProtocol,
  addCatalogExerciseToSubstitutionItem,
  approveSubstitutionNow,
  DashboardApiError,
  discardSubstitution,
  getOperations,
  getQueue,
  getQueueDetail,
  parseOperations,
  parseAlertsResponse,
  parseAlertsSummary,
  getNotificationHistory,
  parseNotificationHistory,
  parseNotificationsResponse,
  parseNotificationsSummary,
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
  batchSubstitutionDetail,
  substitutionDetail,
} from '../../test/dashboard-fixtures';

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

afterEach(() => vi.restoreAllMocks());

describe('parsers do contrato do dashboard', () => {
  it('valida alertas do AI Coach e a contagem sem dados do aluno', () => {
    const alert = {
      id: '33333333-3333-4333-8333-333333333333',
      studentName: 'Ana',
      level: 'SAFETY',
      reason: 'RED_FLAG',
      sourceType: 'CONVERSATION',
      status: 'OPEN',
      createdAt: '2026-10-12T12:00:00.000Z',
      updatedAt: '2026-10-12T12:00:00.000Z',
    };
    expect(parseAlertsResponse({ open: [alert], resolved: [] })).toEqual({
      open: [{ ...alert, read: false }],
      resolved: [],
    });
    expect(
      parseAlertsResponse({ open: [{ ...alert, read: true }], resolved: [] }).open[0]?.read,
    ).toBe(true);
    expect(parseAlertsSummary({ open: 3.8 })).toEqual({ open: 3 });
    expect(() =>
      parseAlertsResponse({ open: [{ ...alert, level: 'URGENT' }], resolved: [] }),
    ).toThrow(/prioridade/i);
    expect(() => parseAlertsSummary({ open: -1 })).toThrow(/resumo/i);
  });

  it('valida notificações do sino e rejeita tipo ou contagem inválidos', () => {
    const item = {
      type: 'protocol',
      id: 'p-1',
      read: true,
      createdAt: '2026-10-12T12:00:00.000Z',
      level: null,
      title: 'Protocolo para Revisão: Ana',
      section: 'MANDATORY',
      origin: 'PARQ',
      autoReleaseAt: null,
    };
    const parsed = parseNotificationsResponse({
      snapshotAt: '2026-10-12T13:00:00.000Z',
      items: [item],
      totalPending: 3,
      unread: 2,
      openSafety: 1,
    });
    expect(parsed).toMatchObject({ snapshotAt: '2026-10-12T13:00:00.000Z', totalPending: 3 });
    expect(parsed.items[0]).toMatchObject({ type: 'protocol', read: true, section: 'MANDATORY' });
    expect(parseNotificationsSummary({ unread: 4.9, openSafety: 0 })).toEqual({
      unread: 4,
      openSafety: 0,
    });
    expect(() =>
      parseNotificationsResponse({
        items: [{ ...item, type: 'x' }],
        totalPending: 1,
        unread: 1,
        openSafety: 0,
      }),
    ).toThrow(/tipo/i);
    expect(() => parseNotificationsSummary({ unread: -1, openSafety: 0 })).toThrow(/não lidas/i);
  });

  it('valida o registro de notificações com estado, resultado e cursor', () => {
    const base = {
      type: 'substitution',
      id: 's-1',
      read: true,
      createdAt: '2026-10-12T12:00:00.000Z',
    };
    const parsed = parseNotificationHistory({
      snapshotAt: '2026-10-13T12:00:00.000Z',
      items: [
        { ...base, status: 'SETTLED', outcome: 'DISCARDED', settledAt: '2026-10-12T13:00:00.000Z' },
        { ...base, id: 's-2', status: 'PENDING', outcome: 'inválido' },
      ],
      nextCursor: 'abc',
      unread: 1,
      openSafety: 0,
    });
    expect(parsed.nextCursor).toBe('abc');
    expect(parsed.items[0]).toMatchObject({ status: 'SETTLED', outcome: 'DISCARDED' });
    expect(parsed.items[1]).toMatchObject({ status: 'PENDING', outcome: null, settledAt: null });
    expect(parseNotificationHistory({ items: [], unread: 0, openSafety: 0 }).nextCursor).toBeNull();
    expect(() => parseNotificationHistory({ unread: 0 })).toThrow(/inválida/i);
  });

  it('pede o registro com filtros e cursor na query', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      response(200, {
        snapshotAt: '2026-10-13T12:00:00.000Z',
        items: [],
        unread: 0,
        openSafety: 0,
      }),
    );
    await getNotificationHistory({ state: 'unread', type: 'alert', cursor: 'c1' });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/dashboard/notifications/history?state=unread&type=alert&cursor=c1',
    );
  });

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
      studentName: null,
      sourceType: null,
      sourceId: null,
    });

    expect(
      parseQueueDetail({
        ...protocolDetail,
        handoff: {
          reason: 'FORA_DE_ESCOPO',
          level: 'ALERT',
          status: 'OPEN',
          studentId: '22222222-2222-4222-8222-222222222222',
          trigger: {
            content: 'Posso falar sobre outro assunto?',
            createdAt: '2026-10-12T12:00:00.000Z',
            direction: 'INBOUND',
          },
        },
      }).handoff,
    ).toMatchObject({
      studentId: '22222222-2222-4222-8222-222222222222',
      trigger: { content: 'Posso falar sobre outro assunto?', direction: 'INBOUND' },
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
    expect(
      parseQueueResponse({ mandatory: [{ ...base, origin: 'FALLBACK' }], ...empty }).mandatory[0]
        ?.origin,
    ).toBe('FALLBACK');
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

  it('troca em lote: parseia cada item (decisão, obrigatório, opções seguras)', () => {
    const detail = parseQueueDetail(batchSubstitutionDetail);
    expect(detail.substitution?.items).toHaveLength(3);
    expect(detail.substitution?.items[1]).toMatchObject({
      index: 1,
      to: { id: null, name: 'Extensora Unilateral' },
      catalogGap: true,
      mandatory: true,
      decision: 'PENDING',
    });
    expect(detail.substitution?.items[0]?.options.map((o) => o.id)).toEqual([
      'agachamento_hack',
      'afundo',
    ]);
  });

  it('resposta de API anterior ao lote (sem `items`) vira um único item das colunas from/to', () => {
    const legacy = {
      ...substitutionDetail,
      substitution: { ...substitutionDetail.substitution, items: undefined },
    };
    const detail = parseQueueDetail(legacy);
    expect(detail.substitution?.items).toEqual([
      {
        index: 0,
        from: { id: 'flexao', name: 'Flexão' },
        to: { id: 'flexao_diamante', name: 'Flexão Diamante' },
        catalogGap: false,
        mandatory: false,
        decision: 'PENDING',
        options: [],
      },
    ]);
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
    await saveProtocol('p1', protocolContent);
    await amendActiveProtocol('p1', {
      content: protocolContent,
      expectedVersion: 1,
      reason: 'Troca manual segura',
      confirmation: true,
    });
    await signProtocol('p1');
    await resolveHandoff('h1', 'Contato realizado', 'Registro');
    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit;
      expect(String(init.body ?? '')).not.toContain('user_id');
    }
    expect(fetchMock.mock.calls[3]?.[1]?.body).toBe(
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

  // Achado 2026-09-30 (troca em lote): a aprovação carrega a decisão do profissional por item.
  it('aprova a substituição enviando a decisão por item (editar e descartar)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, { status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);
    await approveSubstitutionNow('s1', [
      { index: 0, action: 'APPROVE', toExerciseId: 'afundo' },
      { index: 1, action: 'DISCARD' },
    ]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/dashboard/substitutions/s1/approve');
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      items: [
        { index: 0, action: 'APPROVE', toExerciseId: 'afundo' },
        { index: 1, action: 'DISCARD' },
      ],
    });
  });

  it('liga o exercício publicado ao item certo da proposta (por posição), sem aprovar', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, { attached: true }));
    vi.stubGlobal('fetch', fetchMock);
    await addCatalogExerciseToSubstitutionItem('s1', 2, {
      exerciseKey: 'extensora_unilateral',
      changeNote: 'nota',
      name: 'Extensora Unilateral',
      pattern: 'ISOLATION',
      muscleGroups: ['quadríceps'],
      equipment: [],
      locations: ['FULL_GYM'],
      levels: ['INICIANTE'],
      contraindicatedFor: [],
      substitutes: [],
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/dashboard/substitutions/s1/items/2/catalog-exercise',
    );
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe('POST');
  });

  it('propaga mensagem e detalhes seguros de validação', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(response(422, { message: 'Edição bloqueada.', validation: ['volume'] })),
    );
    await expect(saveProtocol('p1', protocolContent)).rejects.toMatchObject({
      status: 422,
      message: 'Edição bloqueada.',
      details: ['volume'],
    });
  });

  it('recusa por regra de segurança mostra o que corrigir em vez do texto genérico', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response(400, {
          error: 'request_failed_400',
          message: 'Não foi possível concluir a solicitação.',
          violations: [
            {
              rule: 'EXERCISE_UNKNOWN',
              detail: 'exercício fora da base: manual-1',
              action: 'BLOCK',
            },
            {
              rule: 'TECHNIQUE_OVERUSE',
              detail: 'Treino A: 3 exercícios com técnica',
              action: 'BLOCK',
            },
          ],
        }),
      ),
    );
    await expect(signProtocol('p1')).rejects.toMatchObject({
      status: 400,
      message:
        'Regras de segurança não atendidas: exercício fora da base: manual-1; Treino A: 3 exercícios com técnica',
      details: ['exercício fora da base: manual-1', 'Treino A: 3 exercícios com técnica'],
    });
  });
});
