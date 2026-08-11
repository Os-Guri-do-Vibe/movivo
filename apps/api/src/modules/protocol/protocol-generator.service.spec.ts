import { describe, expect, it, vi } from 'vitest';

import type { LlmRouter } from '../ai-coach/llm/llm-router.service';
import type { LLMRequest, LLMResult } from '../ai-coach/llm/llm.types';
import {
  extractJsonObject,
  ProtocolGenerationError,
  ProtocolGeneratorService,
  PROMPT_VERSION,
} from './protocol-generator.service';
import type { UserConstraints } from './user-constraints';

function llmResult(text: string): LLMResult {
  return {
    text,
    provider: 'OPENAI_GPT41',
    model: 'gpt-4.1',
    tokensInput: 100,
    tokensOutput: 200,
    tokensCached: 0,
    latencyMs: 42,
    attempt: 1,
    dataClass: 'HEALTH',
    costBrl: 0.01,
  };
}

/** JSON de protocolo válido usando um exerciseId REAL da base. */
function validProtocolJson(exerciseId = 'goblet_squat'): string {
  return JSON.stringify({
    promptVersion: PROMPT_VERSION,
    goal: 'GAIN_MUSCLE',
    phase: 'ADAPTACAO',
    weeklyFrequency: 3,
    sessions: [
      {
        dayLabel: 'Dia A',
        focus: 'Corpo inteiro',
        exercises: [
          {
            exerciseId,
            name: 'Agachamento goblet',
            sets: 3,
            reps: { min: 8, max: 12 },
            loadStrategy: 'DOUBLE_PROGRESSION',
            restSeconds: 90,
          },
        ],
      },
    ],
  });
}

const constraints: UserConstraints = {
  goal: 'GAIN_MUSCLE',
  level: 'INICIANTE',
  daysPerWeek: 3,
  location: 'FULL_GYM',
  equipment: ['halteres'],
  emphasis: [],
  avoid: [],
  injuryTags: ['KNEE'],
  injuriesRaw: ['dor no joelho'],
};

function makeService(responses: string[]) {
  const calls: LLMRequest[] = [];
  const queue = [...responses];
  const llm = {
    complete: vi.fn(async (req: LLMRequest) => {
      calls.push(req);
      return llmResult(queue.shift() ?? '');
    }),
  } as unknown as LlmRouter;
  const logger = { setContext: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const service = new ProtocolGeneratorService(llm, logger as never);
  return { service, calls };
}

const command = { userId: 'u-1', user: { name: 'João' }, constraints };

describe('ProtocolGeneratorService', () => {
  it('gera um ProtocolStructure válido a partir da saída do LLM', async () => {
    const { service } = makeService([validProtocolJson()]);
    const result = await service.generate(command);
    expect(result.structure.goal).toBe('GAIN_MUSCLE');
    expect(result.structure.sessions[0]?.exercises[0]?.exerciseId).toBe('goblet_squat');
    expect(result.promptVersion).toBe(PROMPT_VERSION);
    expect(result.unknownExerciseIds).toEqual([]);
  });

  it('injeta metodologia, base e constraints no prompt e fixa os params', async () => {
    const { service, calls } = makeService([validProtocolJson()]);
    await service.generate(command);
    const req = calls[0];
    if (!req) throw new Error('esperava uma chamada ao LLM');
    expect(req.purpose).toBe('PROTOCOL_GENERATION');
    expect(req.temperature).toBe(0.4);
    expect(req.system).toContain('metodologia'); // diretrizes CREF
    expect(req.system).toContain('goblet_squat'); // vocabulário da base
    expect(req.messages[0]?.content).toContain('GAIN_MUSCLE'); // constraints
    expect(req.messages[0]?.content).toContain('KNEE'); // restrição a evitar
  });

  it('ensina a divisão de treino e a técnica avançada da metodologia v2', async () => {
    const { service, calls } = makeService([validProtocolJson()]);
    await service.generate(command);
    const req = calls[0];
    if (!req) throw new Error('esperava uma chamada ao LLM');
    expect(req.system).toContain('splitType'); // schema com divisão
    expect(req.system).toContain('PUSH_PULL_LEGS');
    expect(req.system).toContain('technique'); // schema com técnica avançada
    expect(req.system).toContain('grupos:'); // grupos musculares no catálogo do prompt
    // O nível do usuário limita as divisões oferecidas (INICIANTE não recebe ABC/ABCDE).
    const userMessage = req.messages[0]?.content ?? '';
    expect(userMessage).toContain('Divisões permitidas para este nível: FULL_BODY');
    expect(userMessage).not.toContain('ABCDE');
  });

  it('tolera JSON dentro de cercas de código (```json)', async () => {
    const fenced = '```json\n' + validProtocolJson() + '\n```';
    const { service } = makeService([fenced]);
    const result = await service.generate(command);
    expect(result.structure.weeklyFrequency).toBe(3);
  });

  it('faz 1 retry corretivo quando a primeira saída é malformada', async () => {
    const { service, calls } = makeService(['isto não é json', validProtocolJson()]);
    const result = await service.generate(command);
    expect(result.structure.phase).toBe('ADAPTACAO');
    expect(calls).toHaveLength(2);
    // o retry acrescenta a instrução corretiva
    expect(calls[1]?.messages.at(-1)?.content).toContain('JSON válido');
  });

  it('lança ProtocolGenerationError se as duas tentativas forem malformadas', async () => {
    const { service } = makeService(['lixo', 'mais lixo']);
    await expect(service.generate(command)).rejects.toBeInstanceOf(ProtocolGenerationError);
  });

  it('sinaliza exercício fora da base (rede de segurança da US-2.3) sem falhar', async () => {
    const { service } = makeService([validProtocolJson('exercicio_fantasma')]);
    const result = await service.generate(command);
    expect(result.unknownExerciseIds).toContain('exercicio_fantasma');
  });
});

describe('extractJsonObject', () => {
  it('extrai o objeto entre a primeira { e a última }', () => {
    expect(extractJsonObject('prefixo {"a":1} sufixo')).toBe('{"a":1}');
  });

  it('retorna null quando não há objeto', () => {
    expect(extractJsonObject('sem json aqui')).toBeNull();
  });
});
