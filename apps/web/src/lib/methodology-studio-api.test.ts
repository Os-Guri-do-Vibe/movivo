import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MethodologyStudioError,
  cancelTest,
  discardDraft,
  getTestEstimate,
  listDomains,
  testDraft,
} from './methodology-studio-api';

function respond(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status < 400,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

async function failure(action: () => Promise<unknown>): Promise<MethodologyStudioError> {
  try {
    await action();
  } catch (e) {
    if (e instanceof MethodologyStudioError) return e;
  }
  throw new Error('esperava um MethodologyStudioError');
}

describe('erros do estúdio de metodologia', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mantém a frase em português que o servidor mandou, com os campos afetados', async () => {
    respond(400, {
      message: 'Alguns valores não puderam ser salvos.',
      issues: [{ path: 'a.b', message: 'Seção · Campo: não foi preenchido.' }],
    });
    const error = await failure(() => discardDraft('x'));
    expect(error.message).toBe('Alguns valores não puderam ser salvos.');
    expect(error.issues).toHaveLength(1);
  });

  it.each([
    [401, 'Sua sessão expirou. Entre de novo para continuar.'],
    [403, 'Seu papel pode ver a metodologia, mas não editar nem publicar.'],
    [409, 'Esta ação não é possível no estado atual da versão. Atualize a página e confira.'],
    [500, 'Algo deu errado do nosso lado. Tente de novo em instantes.'],
  ])(
    'troca o texto em inglês do servidor (status %i) por uma frase clara',
    async (status, text) => {
      respond(status, { message: 'Internal server error' });
      expect((await failure(listDomains)).message).toBe(text);
    },
  );

  it('descartar o rascunho chama a API por POST (e não por GET)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { discarded: true } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(discardDraft('abc')).resolves.toEqual({ discarded: true });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/dashboard/control/methodology/documents/abc/discard',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('texto técnico de rota ("Cannot GET ...") nunca vai para a tela', async () => {
    respond(404, { message: 'Cannot GET /api/v1/control-center/methodology/documents/x/discard' });
    expect((await failure(() => discardDraft('x'))).message).toBe(
      'Não encontramos o que você pediu. Atualize a página e tente de novo.',
    );
  });

  it('sem resposta legível, usa a frase do status', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: false, status: 404, json: () => Promise.reject(new Error()) }),
    );
    expect((await failure(listDomains)).message).toContain('Não encontramos o que você pediu');
  });

  it('sem conexão, explica em vez de mostrar "Failed to fetch"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const error = await failure(listDomains);
    expect(error.message).toBe(
      'Não foi possível conectar ao servidor. Confira sua internet e tente de novo.',
    );
  });
});

describe('teste com os agentes em segundo plano', () => {
  afterEach(() => vi.unstubAllGlobals());

  const progress = (state: string, extra: Record<string, unknown> = {}) => ({
    data: {
      state,
      total: 3,
      completed: 0,
      currentTask: null,
      startedAt: null,
      outcome: null,
      error: null,
      spentBrl: 0,
      stoppedReason: null,
      ...extra,
    },
  });
  const reply = (body: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(body) });
  const outcome = { passed: true, evaluations: [], unjustified: [] };

  it('inicia, acompanha o andamento e devolve o resultado', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(progress('RUNNING', { currentTask: 'a.b' })))
      .mockResolvedValueOnce(reply(progress('RUNNING', { completed: 2 })))
      .mockResolvedValueOnce(reply(progress('FINISHED', { completed: 3, outcome })));
    vi.stubGlobal('fetch', fetchMock);
    const seen: number[] = [];

    await expect(testDraft('x', 2, (p) => seen.push(p.completed), 0)).resolves.toEqual({
      outcome,
      spentBrl: 0,
      stoppedReason: null,
    });
    expect(seen).toEqual([0, 2, 3]);
    expect(fetchMock.mock.calls.map(([, init]) => (init as RequestInit).method)).toEqual([
      'POST',
      'GET',
      'GET',
    ]);
  });

  it('mostra a frase de erro pronta quando o teste falha', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(reply(progress('FAILED', { error: 'O teste parou na tarefa a.b.' }))),
    );
    expect((await failure(() => testDraft('x', 2, undefined, 0))).message).toBe(
      'O teste parou na tarefa a.b.',
    );
  });

  it('avisa quando o servidor reiniciou no meio do teste', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(reply(progress('RUNNING')))
        .mockResolvedValueOnce(reply(progress('IDLE'))),
    );
    expect((await failure(() => testDraft('x', 2, undefined, 0))).message).toContain(
      'o servidor reiniciou',
    );
  });

  it('tolera uma oscilação de rede durante a espera', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(reply(progress('RUNNING')))
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(reply(progress('FINISHED', { outcome }))),
    );
    await expect(testDraft('x', 2, undefined, 0)).resolves.toMatchObject({ outcome });
  });

  it('só inicia o teste enviando o limite de gasto confirmado', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(progress('FINISHED', { outcome })));
    vi.stubGlobal('fetch', fetchMock);
    await testDraft('x', 3.5, undefined, 0);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ budgetBrl: 3.5 });
  });

  it('devolve o gasto e o motivo de ter parado antes do fim', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        reply(
          progress('FINISHED', {
            outcome: { ...outcome, passed: false },
            spentBrl: 0.42,
            stoppedReason: 'O teste parou em «X», que reprovou.',
          }),
        ),
      ),
    );
    await expect(testDraft('x', 2, undefined, 0)).resolves.toMatchObject({
      spentBrl: 0.42,
      stoppedReason: 'O teste parou em «X», que reprovou.',
    });
  });

  it('cancelar e estimar usam as rotas próprias', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        reply({
          data: {
            tasks: [{ taskId: 'a.b', cases: 2, estimatedBrl: 0.5 }],
            estimatedTotalBrl: 0.5,
            unknownTasks: 0,
            suggestedBudgetBrl: 2,
            model: 'deepseek-flash',
          },
        }),
      )
      .mockResolvedValueOnce(reply(progress('RUNNING')));
    vi.stubGlobal('fetch', fetchMock);
    await expect(getTestEstimate('x')).resolves.toMatchObject({ suggestedBudgetBrl: 2 });
    await cancelTest('x');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/dashboard/control/methodology/documents/x/test/estimate',
      '/api/dashboard/control/methodology/documents/x/test/cancel',
    ]);
  });
});
