import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { GatewayRequest, GatewayResult, TierRoute } from '../ai/ai.types';
import type { ModelGateway } from '../ai/model-gateway';
import type { TenantDatabase } from '../database/tenant-database.service';
import type { AgentContextSources } from './agent-context';
import { PublishedAgentProfiles } from './agent-profile.reader';
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
  // Sem rota reserva por padrão: os testes de correção veem só as rodadas do modelo principal.
  const routesFor = vi.fn(async (): Promise<TierRoute[]> => []);
  return { gateway: { complete, routesFor } as unknown as ModelGateway, requests, routesFor };
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

  it('texto longo demais não derruba a tarefa: é cortado na última frase que cabe', async () => {
    const wordy = defineAgentTask({
      ...task,
      id: 'teste.texto',
      output: z.object({ sessoes: z.number().int(), motivo: z.string().min(1).max(60) }),
      validators: [],
    });
    const motivo =
      'Três dias livres bastam. Mais que isso pesaria na recuperação e no sono do aluno.';
    const { gateway, requests } = gatewayReplying(JSON.stringify({ sessoes: 3, motivo }));
    const result = await new AgentRunner(gateway).run(
      wordy,
      { diasDisponiveis: 3 },
      { userId: null, sources },
    );
    // Uma rodada só: nada de gastar chamada de IA corrigindo 20 caracteres a mais.
    expect(requests).toHaveLength(1);
    expect(result.correctionRounds).toBe(0);
    expect(result.output.motivo).toBe('Três dias livres bastam.');
  });

  it('o principal não converge: tenta do zero com o modelo reserva de outro fornecedor', async () => {
    const { gateway, requests, routesFor } = gatewayReplying(
      '{"sessoes":9,"motivo":"a"}',
      '{"sessoes":8,"motivo":"b"}',
      '{"sessoes":7,"motivo":"c"}',
      '{"sessoes":3,"motivo":"3 dias livres"}',
    );
    const route = (vendor: TierRoute['vendor'], model: string): TierRoute => ({
      vendor,
      model,
      maxOutputTokens: 1_000,
      timeoutMs: 1_000,
      temperature: 0.3,
      vision: false,
    });
    routesFor.mockResolvedValue([
      route('DEEPSEEK', 'deepseek-v4-pro'),
      route('OPENAI', 'gpt-6.1-sol'),
    ]);
    const result = await new AgentRunner(gateway).run(
      task,
      { diasDisponiveis: 3 },
      { userId: null, sources },
    );
    expect(result.output.sessoes).toBe(3);
    // 3 rodadas no principal (1 + 2 correções) e a 4ª, do zero, na reserva.
    expect(requests).toHaveLength(4);
    expect(requests.slice(0, 3).every((r) => r.routeOverride === undefined)).toBe(true);
    expect(requests[3]?.routeOverride).toMatchObject({ vendor: 'OPENAI', model: 'gpt-6.1-sol' });
    expect(requests[3]?.messages).toHaveLength(1);
    expect(result.modelRunIds).toEqual(['run-1', 'run-2', 'run-3', 'run-4']);
  });

  it('resposta idêntica encerra as correções; reserva sem crédito passa para a próxima', async () => {
    const same = '{"sessoes":9,"motivo":"x"}';
    const requests: GatewayRequest[] = [];
    const complete = vi.fn(async (request: GatewayRequest): Promise<GatewayResult> => {
      requests.push(structuredClone(request));
      if (request.routeOverride?.vendor === 'OPENAI') throw new Error('VENDOR_AUTH');
      const text =
        request.routeOverride?.vendor === 'ANTHROPIC' ? '{"sessoes":3,"motivo":"ok"}' : same;
      return {
        text,
        vendor: request.routeOverride?.vendor ?? 'DEEPSEEK',
        model: 'm',
        usage: { tokensInput: 1, tokensCached: 0, tokensOutput: 1 },
        latencyMs: 1,
        costBrl: 0,
        modelRunId: `run-${requests.length}`,
      };
    });
    const route = (vendor: TierRoute['vendor']): TierRoute => ({
      vendor,
      model: vendor.toLowerCase(),
      maxOutputTokens: 1_000,
      timeoutMs: 1_000,
      temperature: 0.3,
      vision: false,
    });
    const routesFor = vi.fn(async () => [route('DEEPSEEK'), route('OPENAI'), route('ANTHROPIC')]);
    const gateway = { complete, routesFor } as unknown as ModelGateway;
    const result = await new AgentRunner(gateway).run(
      task,
      { diasDisponiveis: 3 },
      { userId: null, sources },
    );
    expect(result.output.sessoes).toBe(3);
    // DeepSeek: 1ª resposta e a repetida (para aí); OpenAI sem crédito cai; Anthropic resolve.
    expect(requests.map((r) => r.routeOverride?.vendor ?? 'DEEPSEEK')).toEqual([
      'DEEPSEEK',
      'DEEPSEEK',
      'OPENAI',
      'ANTHROPIC',
    ]);
  });

  it('em avaliação (rota fixa) não troca de modelo', async () => {
    const { gateway, requests, routesFor } = gatewayReplying('{"sessoes":9,"motivo":"x"}');
    routesFor.mockResolvedValue([]);
    await expect(
      new AgentRunner(gateway).run(
        task,
        { diasDisponiveis: 3 },
        {
          userId: null,
          sources,
          routeOverride: {
            vendor: 'DEEPSEEK',
            model: 'deepseek-flash',
            maxOutputTokens: 1_000,
            timeoutMs: 1_000,
            temperature: 0.1,
            vision: false,
          },
        },
      ),
    ).rejects.toBeInstanceOf(AgentTaskError);
    // A mesma resposta duas vezes encerra as correções; e sem trocar de modelo.
    expect(requests).toHaveLength(2);
    expect(routesFor).not.toHaveBeenCalled();
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

  it('o erro final carrega a última resposta reprovada (a das violações)', async () => {
    const { gateway } = gatewayReplying(
      '{"sessoes":9,"motivo":"a"}',
      '{"sessoes":8,"motivo":"b"}',
      '{"sessoes":7,"motivo":"c"}',
    );
    const error = await new AgentRunner(gateway)
      .run(task, { diasDisponiveis: 3 }, { userId: null, sources })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AgentTaskError);
    expect((error as AgentTaskError).rejectedOutput).toBe('{"sessoes":7,"motivo":"c"}');
    expect((error as AgentTaskError).violations.map((v) => v.message).join(' ')).toContain(
      'mais sessões que dias disponíveis',
    );
  });

  it('modelo fixado: usa a rota configurada dele e não troca de fornecedor', async () => {
    const { gateway, requests, routesFor } = gatewayReplying('{"sessoes":9,"motivo":"x"}');
    const configured: TierRoute = {
      vendor: 'DEEPSEEK',
      model: 'deepseek-v4-pro',
      maxOutputTokens: 4_000,
      timeoutMs: 45_000,
      temperature: 0.4,
      vision: false,
    };
    routesFor.mockImplementation(async (tier?: unknown) =>
      tier === 'STANDARD'
        ? [{ ...configured, vendor: 'ANTHROPIC', model: 'claude-sonnet-5-5' }, configured]
        : [],
    );
    await expect(
      new AgentRunner(gateway).run(
        task,
        { diasDisponiveis: 3 },
        { userId: null, sources, pinnedModel: { vendor: 'DEEPSEEK', model: 'deepseek-v4-pro' } },
      ),
    ).rejects.toBeInstanceOf(AgentTaskError);
    // Todas as rodadas no DeepSeek configurado; a resposta repetida encerra sem ir à reserva.
    expect(requests.every((r) => r.routeOverride?.model === 'deepseek-v4-pro')).toBe(true);
    expect(requests[0]?.routeOverride).toEqual(configured);
    expect(routesFor).toHaveBeenCalledTimes(1);
  });

  it('modelo fixado com thinking: esforço, teto e timeout da operação sobre a rota do tier', async () => {
    const { gateway, requests, routesFor } = gatewayReplying('{"sessoes":3,"motivo":"x"}');
    routesFor.mockResolvedValue([
      {
        vendor: 'DEEPSEEK',
        model: 'deepseek-v4-pro',
        maxOutputTokens: 12_000,
        timeoutMs: 180_000,
        temperature: 0.3,
        vision: false,
      },
    ]);
    await new AgentRunner(gateway).run(
      task,
      { diasDisponiveis: 3 },
      {
        userId: null,
        sources,
        pinnedModel: {
          vendor: 'DEEPSEEK',
          model: 'deepseek-v4-pro',
          reasoningEffort: 'high',
          maxOutputTokens: 48_000,
          timeoutMs: 1_200_000,
        },
      },
    );
    expect(requests[0]?.routeOverride).toMatchObject({
      model: 'deepseek-v4-pro',
      reasoningEffort: 'high',
      maxOutputTokens: 48_000,
      timeoutMs: 1_200_000,
    });
  });

  it('modelo fixado fora dos tiers: erro claro, sem chamar o modelo', async () => {
    const { gateway, requests } = gatewayReplying('{"sessoes":3,"motivo":"x"}');
    await expect(
      new AgentRunner(gateway).run(
        task,
        { diasDisponiveis: 3 },
        { userId: null, sources, pinnedModel: { vendor: 'OPENAI', model: 'inexistente' } },
      ),
    ).rejects.toThrow('não está habilitado');
    expect(requests).toHaveLength(0);
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

  it('a ficha do agente entra antes do papel e marca a versão do prompt', async () => {
    const { gateway, requests } = gatewayReplying('{"sessoes":3,"motivo":"3 dias livres"}');
    const result = await new AgentRunner(gateway).run(
      task,
      { diasDisponiveis: 3 },
      {
        userId: null,
        sources,
        profileOverride: { agent: 'STRENGTH', version: 4, content: 'Técnica antes de carga.' },
      },
    );
    const system = requests[0]?.system ?? '';
    expect(system.indexOf('# Ficha do agente\nTécnica antes de carga.')).toBeGreaterThan(-1);
    expect(system.indexOf('# Ficha do agente')).toBeLessThan(system.indexOf('# Seu papel'));
    expect(result.promptVersion).toBe(`${task.promptVersion}.STRENGTH.v4`);
    expect(requests[0]?.promptVersion).toBe(result.promptVersion);
  });

  it('persona: a publicada do sexo do aluno, a outra por empréstimo, ou o texto do código', async () => {
    const run = async (published: { agent: string; version: number; content: string }[]) => {
      const { gateway, requests } = gatewayReplying('{"sessoes":3,"motivo":"3 dias livres"}');
      const db = { runAsSystem: async () => published } as unknown as TenantDatabase;
      const result = await new AgentRunner(gateway, new PublishedAgentProfiles(db)).run(
        task,
        { diasDisponiveis: 3 },
        { userId: null, sources, persona: 'PERSONA_MALE' },
      );
      return { system: requests[0]?.system ?? '', version: result.promptVersion };
    };
    const male = { agent: 'PERSONA_MALE', version: 2, content: 'Sou o Leo.' };
    const female = { agent: 'PERSONA_FEMALE', version: 1, content: 'Sou a Mari.' };
    expect(await run([male, female])).toMatchObject({
      version: `${task.promptVersion}.PERSONA_MALE.v2`,
    });
    expect((await run([male])).system).toContain('# Persona (quem fala com o aluno)\nSou o Leo.');
    expect((await run([female])).system).toContain('Sou a Mari.');
    const fallback = await run([]);
    expect(fallback.system).toContain('Sou o Leonardo, persona de inteligência artificial');
    expect(fallback.version).toBe(`${task.promptVersion}.PERSONA_MALE.v0`);
  });
});

describe('extractJson', () => {
  it('tolera cercas de código e texto antes do objeto', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Aqui está: {"a":2}')).toEqual({ a: 2 });
    expect(() => extractJson('sem json')).toThrow();
  });
});
