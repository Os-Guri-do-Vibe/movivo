import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { GatewayRequest, GatewayResult } from '../ai/ai.types';
import type { ModelGateway } from '../ai/model-gateway';
import type { AgentContextSources } from './agent-context';
import { AgentRunner, AgentTaskError, extractJson } from './agent-runner';
import { defineAgentTask } from './agent-task';

const task = defineAgentTask({
  id: 'teste.sessoes',
  role: 'Treinador de teste.',
  instructions: 'Proponha a quantidade de sessões por semana.',
  tier: 'STANDARD',
  methodology: ['STRENGTH'],
  state: ['availability'],
  input: z.object({ diasDisponiveis: z.number().int() }),
  output: z.object({ sessoes: z.number().int().min(1).max(7), motivo: z.string().min(1) }),
  validators: [
    (input, output) =>
      output.sessoes > input.diasDisponiveis
        ? [{ path: 'sessoes', message: 'mais sessões que dias disponíveis' }]
        : [],
  ],
  maxCorrectionRounds: 2,
});

const sources: AgentContextSources = {
  methodology: async () => ({
    text: 'Frequência mínima de 2x por grupo.',
    versions: { STRENGTH: 3 },
  }),
  state: async () => ({ slices: { availability: { dias: ['MON', 'WED', 'FRI'] } }, version: 7 }),
};

function gatewayReplying(...texts: string[]) {
  const requests: GatewayRequest[] = [];
  const complete = vi.fn(async (request: GatewayRequest): Promise<GatewayResult> => {
    requests.push(structuredClone(request));
    const text = texts[requests.length - 1] ?? texts.at(-1) ?? '';
    return {
      text,
      vendor: 'DEEPSEEK',
      model: 'm',
      usage: { tokensInput: 10, tokensCached: 0, tokensOutput: 5 },
      latencyMs: 1,
      costBrl: 0.01,
      modelRunId: `run-${requests.length}`,
    };
  });
  return { gateway: { complete } as unknown as ModelGateway, requests };
}

describe('AgentRunner', () => {
  it('devolve a saída válida na primeira rodada, com versões de estado e metodologia', async () => {
    const { gateway, requests } = gatewayReplying('{"sessoes":3,"motivo":"3 dias livres"}');
    const result = await new AgentRunner(gateway).run(
      task,
      { diasDisponiveis: 3 },
      { userId: null, sources },
    );
    expect(result).toMatchObject({
      output: { sessoes: 3 },
      correctionRounds: 0,
      stateVersion: 7,
      methodologyVersions: { STRENGTH: 3 },
      modelRunIds: ['run-1'],
    });
    const [first] = requests;
    expect(first?.tier).toBe('STANDARD');
    expect(first?.promptVersion).toBe(task.promptVersion);
    expect(first?.system).toContain('Constituição MOVIVO');
    expect(first?.system).toContain('Frequência mínima de 2x por grupo.');
    expect(first?.system).toContain('"sessoes"');
    expect(first?.messages[0]?.content).toContain('<dados>');
    expect(first?.messages[0]?.content).toContain('"diasDisponiveis":3');
  });

  it('devolve ao modelo a lista exata de violações e aceita a correção', async () => {
    const { gateway, requests } = gatewayReplying(
      'não sei',
      '{"sessoes":9,"motivo":"x"}',
      '{"sessoes":5,"motivo":"x"}',
    );
    await expect(
      new AgentRunner(gateway).run(task, { diasDisponiveis: 3 }, { userId: null, sources }),
    ).rejects.toBeInstanceOf(AgentTaskError);
    expect(requests).toHaveLength(3);
    const lastUserMessage = requests[2]?.messages.at(-1)?.content;
    expect(lastUserMessage).toContain('sessoes');
  });

  it('corrige violação de validador de domínio na rodada seguinte', async () => {
    const { gateway, requests } = gatewayReplying(
      '{"sessoes":5,"motivo":"quero muito"}',
      '{"sessoes":3,"motivo":"3 dias livres"}',
    );
    const result = await new AgentRunner(gateway).run(
      task,
      { diasDisponiveis: 3 },
      { userId: null, sources },
    );
    expect(result.output.sessoes).toBe(3);
    expect(result.correctionRounds).toBe(1);
    expect(result.modelRunIds).toEqual(['run-1', 'run-2']);
    expect(requests[1]?.messages.at(-1)?.content).toContain('mais sessões que dias disponíveis');
  });

  it('a versão do prompt muda quando a instrução muda', () => {
    const other = defineAgentTask({ ...task, instructions: `${task.instructions} Seja breve.` });
    expect(other.promptVersion).not.toBe(task.promptVersion);
  });
});

describe('extractJson', () => {
  it('tolera cercas de código e texto antes do objeto', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Aqui está: {"a":2}')).toEqual({ a: 2 });
    expect(() => extractJson('sem json')).toThrow();
  });
});
