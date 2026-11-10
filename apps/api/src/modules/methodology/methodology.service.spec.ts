/**
 * Nenhum destes testes chama modelo de IA: o avaliador e o banco são de mentira. Eles garantem
 * que o teste da metodologia respeita o limite de gasto, para na primeira reprovação, pode ser
 * cancelado e não paga duas vezes pelo que já passou.
 */
import { UnprocessableEntityException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { exampleParameters, methodologyDomainSpec } from '@movivo/shared';

import { MethodologyService, type MethodologyDocument } from './methodology.service';

const spec = methodologyDomainSpec('RECOVERY');
const doc = {
  id: '3e8f9372-0781-4f84-b6cc-4923feb8e0da',
  domain: 'RECOVERY',
  version: 2,
  status: 'DRAFT',
  parameters: exampleParameters(spec),
  guidance: {},
  justifications: {},
  evalRunIds: [],
} as unknown as MethodologyDocument;

/** Banco de mentira: a consulta de custos devolve `history`; as demais, o rascunho. */
function fakeDb(history: { taskId: string; costBrl: number }[]) {
  const updates: unknown[] = [];
  const chainOf = (rows: unknown[]) => {
    const chain: Record<string, unknown> = {};
    for (const name of ['from', 'where', 'orderBy', 'limit']) chain[name] = () => chain;
    chain.set = (values: unknown) => {
      updates.push(values);
      return chain;
    };
    chain.returning = () => Promise.resolve(rows);
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve);
    return chain;
  };
  const tx = {
    select: (fields?: unknown) => chainOf(fields ? history : [doc]),
    update: () => chainOf([doc]),
  };
  return { db: { runAsSystem: (cb: (t: unknown) => unknown) => cb(tx) }, updates };
}

interface Options {
  tasks: string[];
  history?: { taskId: string; costBrl: number }[];
  casesOf?: (taskId: string) => number;
  /** Custo e resultado de cada tarefa; por padrão, passa e custa R$ 0,10. */
  result?: (taskId: string) => { passed: boolean; costBrl: number };
  evaluate?: (taskId: string) => Promise<unknown>;
  /** Títulos dos casos por id (para o texto de "o que reprovou"). */
  titles?: Record<string, string>;
}

function build(options: Options) {
  const { db, updates } = fakeDb(options.history ?? []);
  const calls: string[] = [];
  const evaluate =
    options.evaluate ??
    ((taskId: string) => {
      calls.push(taskId);
      const { passed, costBrl } = options.result?.(taskId) ?? { passed: true, costBrl: 0.1 };
      return Promise.resolve(summary(taskId, passed, costBrl));
    });
  const registry = {
    tasksUsing: () => options.tasks,
    get: (taskId: string) => ({
      task: { promptVersion: 'v1' },
      cases:
        options.casesOf || !options.titles
          ? new Array(options.casesOf?.(taskId) ?? 1).fill({})
          : Object.entries(options.titles).map(([id, title]) => ({ id, title })),
    }),
  };
  const panelTestRoute = vi.fn((taskId: string) => ({
    vendor: 'DEEPSEEK',
    model: 'deepseek-flash',
    taskId,
  }));
  const service = new MethodologyService(
    db as never,
    {} as never,
    registry as never,
    { evaluate, panelTestRoute, panelTestModel: () => 'deepseek-flash' } as never,
    {} as never,
    {} as never,
  );
  return { service, updates, calls, panelTestRoute };
}

const summary = (taskId: string, passed: boolean, costBrl: number) => ({
  evalRunId: `run-${taskId}`,
  taskId,
  passed,
  casesTotal: 2,
  casesPassed: passed ? 2 : 1,
  costBrl,
  results: [],
});

async function settled(service: MethodologyService) {
  for (let i = 0; i < 100; i += 1) {
    if (service.testProgress(doc.id).state !== 'RUNNING') break;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  return service.testProgress(doc.id);
}

describe('teste da metodologia em segundo plano', () => {
  it('devolve na hora, acompanha o andamento e grava o resultado', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { service, updates } = build({
      tasks: ['a.one', 'b.two'],
      evaluate: async (taskId) => {
        await gate;
        return summary(taskId, true, 0.1);
      },
    });

    const started = await service.startTest(doc.id, null, 5);
    expect(started).toMatchObject({ state: 'RUNNING', total: 2, completed: 0 });

    release();
    const done = await settled(service);
    expect(done.state).toBe('FINISHED');
    expect(done.completed).toBe(2);
    expect(done.spentBrl).toBeCloseTo(0.2);
    expect(done.outcome?.passed).toBe(true);
    expect(done.outcome?.evaluations).toHaveLength(2);
    expect(updates).toContainEqual({ status: 'TESTING', evalRunIds: ['run-a.one', 'run-b.two'] });
  });

  it('cada tarefa roda no modelo barato dos testes, sem rota de produção', async () => {
    const seen: unknown[] = [];
    const { service } = build({
      tasks: ['a.one'],
      evaluate: (taskId) => Promise.resolve(summary(taskId, true, 0.01)),
    });
    // O avaliador de mentira devolve o que recebeu: confere a opção repassada.
    const evaluation = (
      service as unknown as { evaluation: { evaluate: (...a: unknown[]) => unknown } }
    ).evaluation;
    const original = evaluation.evaluate;
    evaluation.evaluate = (taskId: unknown, options: unknown) => {
      seen.push(options);
      return original(taskId, options);
    };
    await service.startTest(doc.id, null, 5);
    await settled(service);
    expect(seen[0]).toMatchObject({
      routeOverride: { vendor: 'DEEPSEEK', model: 'deepseek-flash' },
    });
  });

  it('para na primeira tarefa que reprova e não paga o resto', async () => {
    const { service, updates, calls } = build({
      tasks: ['a.one', 'b.two', 'c.three'],
      result: (taskId) => ({ passed: taskId !== 'a.one', costBrl: 0.1 }),
    });
    await service.startTest(doc.id, null, 5);
    const done = await settled(service);

    expect(calls).toEqual(['a.one']);
    expect(done.state).toBe('FINISHED');
    expect(done.outcome?.passed).toBe(false);
    expect(done.stoppedReason).toContain('O teste parou em «');
    expect(done.stoppedReason).toContain('que reprovou');
    expect(done.stoppedReason).not.toMatch(/[a-z]+\.[a-z_]+/); // sem id técnico (ex.: a.one)
    expect(updates).toContainEqual({ status: 'DRAFT', evalRunIds: ['run-a.one'] });
  });

  it('mostra, em português, o que reprovou e usa o nome legível do agente', async () => {
    const { service } = build({
      tasks: ['recovery.analyze_week'],
      evaluate: () =>
        Promise.resolve({
          ...summary('recovery.analyze_week', false, 0.15),
          results: [
            {
              caseId: 'c1',
              pass: false,
              error: null,
              assertions: [
                { pass: false, description: 'não exagera nas leituras', detail: 'x' },
                { pass: true, description: 'cita o sono', detail: 'y' },
              ],
            },
            { caseId: 'c2', pass: false, error: 'saída inválida: x', assertions: [] },
            { caseId: 'c3', pass: false, error: '429 rate limit', assertions: [] },
          ],
        }),
      titles: { c1: 'Pico de carga', c2: 'Semana boa' },
    });
    await service.startTest(doc.id, null, 5);
    const done = await settled(service);

    expect(done.stoppedReason).toContain('«Recuperação: analisar a semana»');
    expect(done.stoppedReason).toContain('R$');
    expect(done.stoppedReason).not.toContain('recovery.analyze_week');
    expect(done.outcome?.evaluations[0]?.failures).toEqual([
      'Pico de carga: não atendeu (não exagera nas leituras).',
      'Semana boa: o modelo respondeu fora do formato esperado.',
      'Situação de teste: não foi possível obter a resposta do modelo.',
    ]);
  });

  it('roda as tarefas mais baratas primeiro', async () => {
    const { service, calls } = build({
      tasks: ['cara', 'barata', 'media'],
      history: [
        { taskId: 'cara', costBrl: 1.5 },
        { taskId: 'barata', costBrl: 0.05 },
        { taskId: 'media', costBrl: 0.2 },
      ],
    });
    await service.startTest(doc.id, null, 10);
    await settled(service);
    expect(calls).toEqual(['barata', 'media', 'cara']);
  });

  it('não começa tarefa que, pela estimativa, estouraria o limite de gasto', async () => {
    const { service, calls } = build({
      tasks: ['barata', 'cara'],
      history: [
        { taskId: 'barata', costBrl: 0.1 },
        { taskId: 'cara', costBrl: 1.5 },
      ],
    });
    await service.startTest(doc.id, null, 1);
    const done = await settled(service);

    expect(calls).toEqual(['barata']);
    expect(done.stoppedReason).toContain('limite de');
    expect(done.outcome?.passed).toBe(false); // não avaliou tudo: não vale como aprovado
    expect(done.spentBrl).toBeCloseTo(0.1);
  });

  it('para quando o gasto real atinge o limite', async () => {
    const { service, calls } = build({
      tasks: ['a.one', 'b.two', 'c.three'],
      result: () => ({ passed: true, costBrl: 0.6 }),
    });
    await service.startTest(doc.id, null, 1);
    const done = await settled(service);

    expect(calls).toHaveLength(2);
    expect(done.stoppedReason).toContain('atingir o limite');
    expect(done.outcome?.passed).toBe(false);
  });

  it('cancelar impede as próximas tarefas e diz quanto foi gasto', async () => {
    const built = build({
      tasks: ['a.one', 'b.two'],
      evaluate: (taskId) => {
        built.service.cancelTest(doc.id); // clique em "Cancelar" durante a primeira tarefa
        return Promise.resolve(summary(taskId, true, 0.25));
      },
    });
    const { service } = built;
    await service.startTest(doc.id, null, 5);
    const done = await settled(service);

    expect(done.state).toBe('FAILED');
    expect(done.error).toContain('Teste cancelado');
    expect(done.error).toContain('0,25');
    expect(done.completed).toBe(1);
    expect(built.updates).toEqual([]); // o rascunho não muda de estado
  });

  it('testar de novo não paga outra vez pelo que já passou com o mesmo conteúdo', async () => {
    let failing = true;
    const { service, calls } = build({
      tasks: ['a.one', 'b.two'],
      history: [
        { taskId: 'a.one', costBrl: 0.1 },
        { taskId: 'b.two', costBrl: 0.2 },
      ],
      result: (taskId) => ({ passed: !(failing && taskId === 'b.two'), costBrl: 0.1 }),
    });
    await service.startTest(doc.id, null, 5);
    await settled(service);
    expect(calls).toEqual(['a.one', 'b.two']);

    failing = false;
    await service.startTest(doc.id, null, 5);
    const second = await settled(service);

    expect(calls).toEqual(['a.one', 'b.two', 'b.two']); // a.one não foi reavaliada
    expect(second.outcome?.passed).toBe(true);
    expect(second.spentBrl).toBeCloseTo(0.1);
  });

  it('falha do modelo vira frase clara e mantém o rascunho', async () => {
    const { service, updates } = build({
      tasks: ['a.one'],
      evaluate: () => Promise.reject(new Error('429 rate limit')),
    });
    await service.startTest(doc.id, null, 5);
    const done = await settled(service);
    expect(done.state).toBe('FAILED');
    expect(done.error).toContain('O teste parou em «Tarefa interna dos agentes»');
    expect(done.error).not.toContain('a.one');
    expect(updates).toEqual([]);
  });

  it('tarefa sem casos recusa antes de gastar chamadas de modelo', async () => {
    const evaluate = vi.fn();
    const { service } = build({ tasks: ['a.one'], casesOf: () => 0, evaluate });
    await expect(service.startTest(doc.id, null, 5)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('a recusa por falta de casos nomeia a metodologia, não repete tarefa e tranquiliza sobre o rascunho', async () => {
    const { service } = build({
      tasks: ['strength.review_session', 'unknown.a', 'unknown.b'],
      casesOf: () => 0,
    });
    const error = await service.startTest(doc.id, null, 5).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    const message = (error as UnprocessableEntityException).message;
    expect(message).toContain('metodologia de ' + spec.title);
    expect(message).toContain('«Musculação: analisar o treino concluído»');
    // Tarefas sem tradução aparecem uma única vez, não repetidas.
    expect(message.match(/Tarefa interna dos agentes/g)).toHaveLength(1);
    expect(message).toContain('rascunho, que continua salvo');
  });

  it('clicar duas vezes não inicia dois testes (e não paga em dobro)', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const evaluate = vi.fn(async (taskId: string) => {
      await gate;
      return summary(taskId, true, 0.1);
    });
    const { service } = build({ tasks: ['a.one'], evaluate });
    await service.startTest(doc.id, null, 5);
    await service.startTest(doc.id, null, 5);
    release();
    await settled(service);
    expect(evaluate).toHaveBeenCalledTimes(1);
  });
});

describe('estimativa de custo', () => {
  it('soma o custo da última avaliação de cada tarefa, sem chamar modelo', async () => {
    const evaluate = vi.fn();
    const { service } = build({
      tasks: ['a.one', 'b.two', 'nova'],
      history: [
        { taskId: 'a.one', costBrl: 0.5 },
        { taskId: 'a.one', costBrl: 9 }, // mais antiga: ignorada
        { taskId: 'b.two', costBrl: 1 },
      ],
      evaluate,
    });
    const estimate = await service.estimateTest(doc.id);

    expect(estimate.estimatedTotalBrl).toBe(1.5);
    expect(estimate.unknownTasks).toBe(1);
    expect(estimate.tasks.find((t) => t.taskId === 'nova')?.estimatedBrl).toBeNull();
    expect(estimate.suggestedBudgetBrl).toBe(3); // 1,5 × 1,5 + R$ 0,30 da tarefa sem histórico
    expect(estimate.model).toBe('deepseek-flash');
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('sem histórico nenhum, sugere o limite mínimo', async () => {
    const { service } = build({ tasks: [] });
    expect((await service.estimateTest(doc.id)).suggestedBudgetBrl).toBe(1);
  });

  it('sem teste iniciado o andamento é IDLE', () => {
    const { service } = build({ tasks: [] });
    expect(service.testProgress(doc.id)).toMatchObject({ state: 'IDLE', total: 0, spentBrl: 0 });
  });
});
