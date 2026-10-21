/**
 * Regra do fundador para a agenda flexível: "nenhuma trava por dor aberta ou atendimento
 * pausado" (confirmado em 2026-10-20: vale também quando o Léo assumiu a conversa). O
 * `ScheduleFlowService` não consulta nenhuma das duas; o `AIResponseWorker` precisa deixar o
 * pedido de agenda e o pedido do link passarem mesmo com o atendimento automático pausado, e
 * continuar em silêncio para todo o resto (a conversa é do profissional).
 *
 * Unitário (roda no `vitest run` do app); dependências que o caminho não usa são auto-mocks.
 */
import { DEFAULT_AGENT_PERSONA } from '@movivo/shared';
import { describe, expect, it, vi } from 'vitest';

import { RedisKeyBuilder } from '../../src/core/redis/redis-key.util';
import { AIResponseWorker } from '../../src/modules/coach/ai-response.worker';

const USER_ID = '22222222-2222-4222-8222-222222222222';
const keys = new RedisKeyBuilder('movivo-test');

/** Qualquer método é um `vi.fn()` que resolve `undefined`. */
function auto(overrides: Record<string, unknown> = {}) {
  return new Proxy(overrides, {
    get(target, property) {
      if (property in target) return target[property as string];
      if (property === 'then') return undefined;
      const fn = vi.fn(async () => undefined);
      target[property as string] = fn;
      return fn;
    },
  });
}

function makeWorker(
  paused: boolean,
  options: { intent?: string; safetyHandoff?: boolean; flowThrows?: boolean } = {},
) {
  const batch = [JSON.stringify({ text: 'hoje consigo treinar, posso fazer o treino A?' })];
  const multi = {
    lrange: () => multi,
    del: () => multi,
    exec: async () => [
      [null, batch],
      [null, 1],
    ],
  };
  const redis = auto({ multi: () => multi, llen: async () => 0 });
  const scheduleFlow = auto({
    hasOpenFlow: vi.fn(async () => false),
    handle: vi.fn(async () => {
      if (options.flowThrows) throw new Error('banco fora');
      return { kind: 'FIXED', text: 'Pode sim! Hoje é dia de A.', adjusted: true };
    }),
  });
  const queues = auto();
  const repo = auto({
    loadRuntimeUser: vi.fn(async () => ({
      scrubUser: { name: 'Ana', phoneNumber: null, email: null },
      biologicalSex: null,
      timezone: 'America/Sao_Paulo',
    })),
  });
  const worker = new AIResponseWorker(
    auto() as never, // workers
    queues as never,
    auto({ acquire: vi.fn(async () => 'token') }) as never, // lock
    auto({
      classify: vi.fn(async () => ({
        intent: options.intent ?? 'AJUSTE_AGENDA',
        safetyHandoff: options.safetyHandoff ?? false,
      })),
    }) as never,
    auto({ persona: vi.fn(async () => DEFAULT_AGENT_PERSONA) }) as never, // prompts
    auto() as never, // faq
    auto() as never, // forbiddenTopics
    auto({ evaluate: vi.fn(async () => []) }) as never, // l1Guardrails
    auto() as never, // context
    auto() as never, // grounding
    auto() as never, // llm
    auto() as never, // abuse
    auto() as never, // validation
    auto() as never, // methodology
    repo as never,
    auto({ hasActiveForUser: vi.fn(async () => true) }) as never,
    auto({ hasOpenFlow: vi.fn(async () => false) }) as never, // substitutionFlow
    scheduleFlow as never,
    redis as never,
    keys,
    auto({ isPaused: vi.fn(async () => paused) }) as never,
    auto() as never, // followups
    auto() as never, // logger
  );
  const job = {
    data: {
      userId: USER_ID,
      batchKey: keys.forUser(USER_ID, 'ai-response', 'batch'),
      correlationId: 'corr-1',
      enqueuedAt: Date.now(),
    },
    attemptsMade: 0,
  };
  return { worker, job, scheduleFlow, repo, queues };
}

describe('pedido de agenda com o atendimento automático pausado pelo profissional', () => {
  it('a mensagem do aluno continua indo para o histórico do profissional', async () => {
    const { worker, job, repo } = makeWorker(true);
    await worker.process(job as never);
    expect(repo.persistTurn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, direction: 'INBOUND' }),
    );
  });

  it('controle: sem a pausa, o mesmo pedido chega ao fluxo de agenda', async () => {
    const { worker, job, scheduleFlow } = makeWorker(false);
    await worker.process(job as never);
    expect(scheduleFlow.handle).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, intent: 'AJUSTE_AGENDA' }),
    );
  });

  it('pausa do atendimento não trava o ajuste de agenda (regra do fundador)', async () => {
    const { worker, job, scheduleFlow, queues } = makeWorker(true);
    await expect(worker.process(job as never)).resolves.toEqual({ status: 'PAUSED_SCHEDULE' });
    expect(scheduleFlow.handle).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, intent: 'AJUSTE_AGENDA' }),
    );
    // A resposta (copy fixa do fluxo) sai para o aluno e fica no histórico do profissional.
    expect(queues.enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'coach-message',
      expect.objectContaining({ userId: USER_ID, text: 'Pode sim! Hoje é dia de A.' }),
      expect.anything(),
    );
  });

  it('o pedido do link do check-in também é atendido durante a pausa', async () => {
    const { worker, job, scheduleFlow } = makeWorker(true, { intent: 'PEDIDO_LINK_TREINO' });
    await expect(worker.process(job as never)).resolves.toEqual({ status: 'PAUSED_SCHEDULE' });
    expect(scheduleFlow.handle).toHaveBeenCalledWith(
      expect.objectContaining({ intent: 'PEDIDO_LINK_TREINO' }),
    );
  });

  it('qualquer outro assunto segue em silêncio para o profissional (a conversa é dele)', async () => {
    const { worker, job, scheduleFlow, queues } = makeWorker(true, { intent: 'MOTIVACAO' });
    await expect(worker.process(job as never)).resolves.toEqual({ status: 'PAUSED' });
    expect(scheduleFlow.handle).not.toHaveBeenCalled();
    expect(queues.enqueue).not.toHaveBeenCalled();
  });

  it('sinal de segurança continua com o profissional, mesmo parecendo pedido de agenda', async () => {
    const { worker, job, scheduleFlow } = makeWorker(true, { safetyHandoff: true });
    await expect(worker.process(job as never)).resolves.toEqual({ status: 'PAUSED' });
    expect(scheduleFlow.handle).not.toHaveBeenCalled();
  });

  it('falha ao atender durante a pausa mantém o silêncio, nunca uma resposta inesperada', async () => {
    const { worker, job, queues } = makeWorker(true, { flowThrows: true });
    await expect(worker.process(job as never)).resolves.toEqual({ status: 'PAUSED' });
    expect(queues.enqueue).not.toHaveBeenCalled();
  });
});
