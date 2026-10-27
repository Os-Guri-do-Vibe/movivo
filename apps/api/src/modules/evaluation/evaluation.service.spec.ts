import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { GatewayRequest, GatewayResult } from '../../core/ai/ai.types';
import type { ModelGateway } from '../../core/ai/model-gateway';
import { AgentRunner } from '../../core/agents/agent-runner';
import { defineAgentTask } from '../../core/agents/agent-task';
import { AgentTaskRegistry } from '../../core/agents/agent-task-registry';
import type { EvalCase } from '../../core/agents/eval-case';
import type { TenantDatabase } from '../../core/database/tenant-database.service';
import { EvaluationService } from './evaluation.service';

const task = defineAgentTask({
  id: 'teste.frequencia',
  role: 'Treinador de teste.',
  instructions: 'Proponha sessões por semana.',
  tier: 'STANDARD',
  methodology: ['STRENGTH'],
  state: ['availability'],
  input: z.object({}),
  output: z.object({ sessoes: z.number().int(), modalidade: z.string() }),
  validators: [],
  maxCorrectionRounds: 0,
});

const evalCase = (id: string, extra: Partial<EvalCase> = {}): EvalCase => ({
  id,
  taskId: task.id,
  title: id,
  safetyCritical: false,
  minScore: 1,
  state: { availability: { dias: 3 }, goals: { segredo: 'não pedido pela tarefa' } },
  methodology: { STRENGTH: 'No máximo 3 sessões.' },
  input: {},
  assertions: [
    { kind: 'path', path: 'sessoes', op: 'lte', value: 3, description: 'respeita os 3 dias' },
    { kind: 'check', name: 'forca', description: 'é musculação' },
  ],
  ...extra,
});

function setup(replies: string[]) {
  const requests: GatewayRequest[] = [];
  const gateway = {
    complete: vi.fn(async (request: GatewayRequest): Promise<GatewayResult> => {
      requests.push(request);
      return {
        text: replies[requests.length - 1] ?? '{}',
        vendor: 'OPENAI',
        model: 'm',
        usage: { tokensInput: 1, tokensCached: 0, tokensOutput: 1 },
        latencyMs: 1,
        costBrl: 0.02,
        modelRunId: `run-${requests.length}`,
      };
    }),
  } as unknown as ModelGateway;
  const registry = new AgentTaskRegistry();
  registry.register(task, [evalCase('dentro-do-limite'), evalCase('estoura-o-limite')], {
    forca: (output) => ({
      pass: (output as { modalidade: string }).modalidade === 'STRENGTH',
      detail: 'modalidade',
    }),
  });
  const inserted: unknown[] = [];
  const db = {
    runAsSystem: async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        insert: () => ({
          values: (row: unknown) => {
            inserted.push(row);
            return { returning: async () => [{ id: 'eval-run-1' }] };
          },
        }),
      }),
  } as unknown as TenantDatabase;
  const service = new EvaluationService(registry, new AgentRunner(gateway), db, null);
  return { service, requests, inserted };
}

describe('EvaluationService', () => {
  it('roda cada caso, aplica asserções e grava o resultado com custo', async () => {
    const { service, requests, inserted } = setup([
      '{"sessoes":3,"modalidade":"STRENGTH"}',
      '{"sessoes":5,"modalidade":"STRENGTH"}',
    ]);
    const summary = await service.evaluate(task.id);
    expect(summary).toMatchObject({ casesTotal: 2, casesPassed: 1, passed: false });
    expect(summary.results[1]?.assertions.find((a) => !a.pass)?.description).toBe(
      'respeita os 3 dias',
    );
    expect(summary.costBrl).toBeCloseTo(0.04);
    expect(inserted[0]).toMatchObject({ taskId: task.id, promptVersion: task.promptVersion });
    // O caso fixa o estado, mas só as fatias que a tarefa pede chegam ao modelo.
    const sent = String(requests[0]?.messages[0]?.content);
    expect(sent).toContain('"availability"');
    expect(sent).not.toContain('segredo');
    expect(requests[0]?.system).toContain('No máximo 3 sessões.');
  });

  it('caso cuja execução falha conta como reprovado, com o motivo', async () => {
    const { service } = setup(['isso não é json']);
    const summary = await service.evaluate(task.id, { caseIds: ['dentro-do-limite'] });
    expect(summary.passed).toBe(false);
    expect(summary.results[0]?.error).toContain('saída inválida');
  });

  it('o registro recusa caso com checagem que a tarefa não registrou', () => {
    const registry = new AgentTaskRegistry();
    expect(() => registry.register(task, [evalCase('x')])).toThrow('checagem "forca"');
  });
});
