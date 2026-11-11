/**
 * Pedido da Fila (ajuste ou regerar do zero) com retry/reentrega do job: no máximo UM rascunho por
 * evento, e o aluno recebe a mensagem uma vez só. Cobre as três camadas: pré-checagem (não gasta
 * modelo), guarda dentro da transação (corrida entre execuções) e chave estável da entrega.
 */
import { describe, expect, it, vi } from 'vitest';

import { PlanDocumentRegistry } from '../jobs/plan-document.registry';
import type { WhatsappOutboundJob } from '../jobs/whatsapp-outbound.contract';
import { PlanDelivery } from './plan-delivery.service';
import { PlanGenerationService } from './plan-generation.service';

const USER = '11111111-1111-4111-8111-111111111111';
const PLAN = '33333333-3333-4333-8333-333333333333';
const EVENT = '44444444-4444-4444-8444-444444444444';

/** `select()` devolve, em ordem, as linhas enfileiradas; `execute` registra o SQL (lock). */
function fakeTx(rows: unknown[][]) {
  const queue = [...rows];
  const executed: unknown[] = [];
  const tx = {
    select: () => {
      const result = queue.shift() ?? [];
      const chain: Record<string, unknown> = {};
      for (const method of ['from', 'where', 'orderBy', 'limit', 'innerJoin']) {
        chain[method] = () => chain;
      }
      chain.then = (resolve: (value: unknown) => unknown) => resolve(result);
      return chain;
    },
    execute: vi.fn((query: unknown) => {
      executed.push(query);
      return Promise.resolve([]);
    }),
  };
  return { tx, executed };
}

function build(rows: unknown[][]) {
  const { tx, executed } = fakeTx(rows);
  const db = { runAsSystem: <T>(work: (t: typeof tx) => Promise<T>) => work(tx) };
  const stateReader = { read: vi.fn() };
  const publisher = {
    createTrainingDraft: vi.fn().mockResolvedValue({ planId: 'novo-plano' }),
    createNutritionDraft: vi.fn().mockResolvedValue({ planId: 'novo-plano' }),
    activateTraining: vi.fn().mockResolvedValue({}),
    activateNutrition: vi.fn().mockResolvedValue({}),
  };
  const pipeline = {
    decide: vi.fn().mockResolvedValue({ verdict: 'REVIEW', exceptionCaseId: 'caso-novo' }),
    recordExecution: vi.fn(),
  };
  const delivery = { sendAfterPublish: vi.fn().mockResolvedValue(true) };
  const outbox = { flushSoon: vi.fn().mockResolvedValue(undefined) };
  const unused = {} as never;
  const service = new PlanGenerationService(
    db as never,
    unused, // runner
    stateReader as never,
    unused, // methodology
    unused, // catalog
    pipeline as never,
    publisher as never,
    unused, // foods
    delivery as never,
    outbox as never,
    unused, // physique
    { setContext: vi.fn() } as never,
  );
  return { service, tx, executed, stateReader, publisher, pipeline, delivery, outbox };
}

const trainingProposal = { id: 'prop-1', action: { type: 'PUBLISH_TRAINING_PLAN', planId: PLAN } };
const nutritionProposal = {
  id: 'prop-2',
  action: { type: 'PUBLISH_NUTRITION_PLAN', planId: PLAN },
};

describe('adjust — pré-checagem (retry depois do commit)', () => {
  it('rascunho já gravado e em revisão: devolve o caso existente, sem ler o estado nem criar outro', async () => {
    const t = build([[trainingProposal], [{ status: 'DRAFT' }], [{ id: 'caso-existente' }]]);
    const result = await t.service.adjustByInstruction(USER, 'TRAINING', 'x', {
      triggerEventId: EVENT,
    });
    expect(result).toEqual({ status: 'PENDING_REVIEW', exceptionCaseIds: ['caso-existente'] });
    expect(t.stateReader.read).not.toHaveBeenCalled();
    expect(t.publisher.createTrainingDraft).not.toHaveBeenCalled();
    expect(t.outbox.flushSoon).toHaveBeenCalledTimes(1);
    expect(t.delivery.sendAfterPublish).not.toHaveBeenCalled();
  });

  it('já publicado, mas a entrega caiu: reenvia com a chave do plano (o aluno não recebe em dobro)', async () => {
    const t = build([[nutritionProposal], [{ status: 'ACTIVE' }], []]);
    const result = await t.service.adjustByInstruction(USER, 'NUTRITION', 'x', {
      triggerEventId: EVENT,
    });
    expect(result).toEqual({ status: 'ADJUSTED', planId: PLAN });
    expect(t.delivery.sendAfterPublish).toHaveBeenCalledWith(USER, 'NUTRITION', PLAN);
    expect(t.publisher.createNutritionDraft).not.toHaveBeenCalled();
  });

  it('primeira execução do pedido (nenhuma proposta ainda): segue para a geração normal', async () => {
    // Sem proposta anterior o fluxo segue e para na leitura do estado (não é o foco aqui).
    const t = build([[]]);
    t.stateReader.read.mockRejectedValue(new Error('parou aqui'));
    await expect(
      t.service.adjustByInstruction(USER, 'TRAINING', 'x', { triggerEventId: EVENT }),
    ).rejects.toThrow('parou aqui');
    expect(t.stateReader.read).toHaveBeenCalledTimes(1);
  });

  it('sem evento de origem (follow-ups) não deduplica: comportamento anterior', async () => {
    const t = build([]);
    t.stateReader.read.mockRejectedValue(new Error('parou aqui'));
    await expect(t.service.adjustByInstruction(USER, 'TRAINING', 'x', {})).rejects.toThrow(
      'parou aqui',
    );
  });
});

describe('proposeTraining/proposeNutrition — guarda dentro da transação', () => {
  const ctx = (dedupeByTrigger?: boolean) => ({
    userId: USER,
    goalId: 'goal',
    today: '2026-11-06',
    triggerEventId: EVENT,
    stateVersion: 1,
    ...(dedupeByTrigger === undefined ? {} : { dedupeByTrigger }),
  });
  const built = {
    structure: { summary: 'resumo', sessions: [], phases: [], modalityPriorities: [] },
    schedule: {},
    methodologyVersions: {},
    runs: [],
  };
  const invoke = (service: PlanGenerationService, tx: unknown, c: unknown) =>
    (
      service as unknown as {
        proposeTraining: (tx: unknown, ctx: unknown, built: unknown) => Promise<unknown>;
      }
    ).proposeTraining(tx, c, built);

  it('outra execução já gravou: toma o lock, devolve a proposta dela e NÃO cria rascunho nem decisão', async () => {
    const t = build([[trainingProposal], [{ status: 'DRAFT' }], [{ id: 'caso-existente' }]]);
    const result = await invoke(t.service, t.tx, ctx(true));
    expect(result).toEqual({
      planId: PLAN,
      activated: false,
      exceptionCaseId: 'caso-existente',
    });
    expect(t.tx.execute).toHaveBeenCalledTimes(1);
    expect(t.publisher.createTrainingDraft).not.toHaveBeenCalled();
    expect(t.pipeline.decide).not.toHaveBeenCalled();
  });

  it('primeira execução: toma o lock, não acha proposta e cria o rascunho normalmente', async () => {
    const t = build([[]]);
    const result = await invoke(t.service, t.tx, ctx(true));
    expect(t.tx.execute).toHaveBeenCalledTimes(1);
    expect(t.publisher.createTrainingDraft).toHaveBeenCalledTimes(1);
    expect(t.pipeline.decide).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ planId: 'novo-plano', exceptionCaseId: 'caso-novo' });
  });

  it('sem a flag (geração inicial, renovação): nada muda — nem lock nem consulta', async () => {
    const t = build([]);
    await invoke(t.service, t.tx, ctx());
    expect(t.tx.execute).not.toHaveBeenCalled();
    expect(t.publisher.createTrainingDraft).toHaveBeenCalledTimes(1);
  });

  it('a nutrição usa a própria tarefa e a mesma guarda', async () => {
    const t = build([[nutritionProposal], [{ status: 'ACTIVE' }], []]);
    const result = await (
      t.service as unknown as {
        proposeNutrition: (tx: unknown, ctx: unknown, built: unknown) => Promise<unknown>;
      }
    ).proposeNutrition(t.tx, ctx(true), { run: {}, structure: {}, version: 1 });
    expect(result).toEqual({ planId: PLAN, activated: true, exceptionCaseId: null });
    expect(t.publisher.createNutritionDraft).not.toHaveBeenCalled();
  });
});

describe('PlanDelivery — chave de idempotência da mensagem', () => {
  function delivery(previousPlans: number) {
    const rows = Array.from({ length: previousPlans }, (_, i) => ({ id: `p${i}` }));
    const chain: Record<string, unknown> = {};
    for (const method of ['from', 'where', 'limit']) chain[method] = () => chain;
    chain.then = (resolve: (value: unknown) => unknown) => resolve(rows);
    const db = {
      runAsSystem: <T>(work: (t: unknown) => Promise<T>) => work({ select: () => chain }),
    };
    const queues = { enqueue: vi.fn().mockResolvedValue(undefined) };
    const plans = { read: vi.fn().mockResolvedValue(null) };
    const registry = new PlanDocumentRegistry();
    const service = new PlanDelivery(db as never, queues as never, plans as never, registry);
    return { service, queues, plans, registry };
  }

  const sentText = (queues: { enqueue: ReturnType<typeof vi.fn> }, call = 0) =>
    (queues.enqueue.mock.calls[call]?.[2] as WhatsappOutboundJob).text ?? '';
  const sentDocs = (queues: { enqueue: ReturnType<typeof vi.fn> }, call = 0) =>
    (queues.enqueue.mock.calls[call]?.[2] as WhatsappOutboundJob).documents ?? [];

  it('primeira entrega: uma bolha de texto e os dois PDFs (treino e alimentar) como arquivo, sem nenhum link', async () => {
    const { service, queues } = delivery(1);
    await service.sendAfterPublish(USER, 'NUTRITION', PLAN);
    const text = sentText(queues);
    expect(text.split('\n---\n')).toHaveLength(1);
    expect(text).toMatch(/protocolo de treino e dieta estão prontos\./);
    expect(text).not.toMatch(/https?:\/\/|www\.|\.com\b|chat\.whatsapp/i);
    expect(
      sentDocs(queues).map((d) => [
        d.plan,
        'fileName' in d ? d.fileName : null,
        'url' in d && d.url,
      ]),
    ).toEqual([
      ['treino', null, false],
      ['alimentacao', null, false],
    ]);
  });

  it('atualização: só o PDF do que mudou, dizendo que substitui o anterior, sem link', async () => {
    const { service, queues } = delivery(2);
    await service.sendAfterPublish(USER, 'NUTRITION', PLAN);
    const text = sentText(queues);
    expect(text).toMatch(/ajustamos seu protocolo alimentar/i);
    expect(text).toMatch(/substitui o anterior/);
    expect(text).not.toMatch(/https?:\/\//);
    expect(sentDocs(queues).map((d) => d.plan)).toEqual(['alimentacao']);
  });

  it('o PDF é gerado a partir do protocolo vigente; sem protocolo, não há arquivo', async () => {
    const { service, registry, plans } = delivery(1);
    service.onModuleInit();
    await expect(registry.render(USER, 'treino')).resolves.toBeNull();
    expect(plans.read).toHaveBeenCalledWith(USER);
  });

  it('atualização: com a chave do plano, duas chamadas usam o MESMO dedupeId/jobId', async () => {
    const { service, queues } = delivery(2);
    await service.sendAfterPublish(USER, 'TRAINING', PLAN);
    await service.sendAfterPublish(USER, 'TRAINING', PLAN);
    const ids = queues.enqueue.mock.calls.map((call) => (call[3] as { jobId: string }).jobId);
    expect(ids).toEqual([
      `plan-updated_TRAINING_${USER}_${PLAN}`,
      `plan-updated_TRAINING_${USER}_${PLAN}`,
    ]);
    expect(queues.enqueue.mock.calls[0]?.[2]).toMatchObject({ dedupeId: ids[0] });
  });

  it('sem a chave mantém o comportamento anterior: cada chamada é uma mensagem nova', async () => {
    vi.useFakeTimers();
    try {
      const { service, queues } = delivery(2);
      vi.setSystemTime(1_000);
      await service.sendUpdate(USER, 'NUTRITION');
      vi.setSystemTime(2_000);
      await service.sendUpdate(USER, 'NUTRITION');
      const ids = queues.enqueue.mock.calls.map((call) => (call[3] as { jobId: string }).jobId);
      expect(new Set(ids).size).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
