import { describe, expect, it, vi } from 'vitest';

import type { LlmRouter } from '../ai-coach/llm/llm-router.service';
import type { LLMRequest, LLMResult } from '../ai-coach/llm/llm.types';
import type { SemanticMemoryPort } from '../ai-coach/context/semantic-memory.port';
import { METHODOLOGY_GUIDELINES, METHODOLOGY_VERSION } from './methodology';
import type { MethodologyProvider } from './methodology-provider.service';
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

/** 3 sessões (bate com `constraints.preferredDays` = MON/WED/FRI) — `weekday` opcional. */
function threeSessionsJson(weekdays: (string | undefined)[]): string {
  return JSON.stringify({
    promptVersion: PROMPT_VERSION,
    goal: 'GAIN_MUSCLE',
    phase: 'ADAPTACAO',
    weeklyFrequency: 3,
    sessions: weekdays.map((weekday, i) => ({
      dayLabel: `Dia ${i + 1}`,
      ...(weekday ? { weekday } : {}),
      focus: 'Corpo inteiro',
      exercises: [
        {
          exerciseId: 'goblet_squat',
          name: 'Agachamento goblet',
          sets: 3,
          reps: { min: 8, max: 12 },
          loadStrategy: 'DOUBLE_PROGRESSION',
          restSeconds: 90,
        },
      ],
    })),
  });
}

const constraints: UserConstraints = {
  goal: 'GAIN_MUSCLE',
  level: 'INICIANTE',
  daysPerWeek: 3,
  preferredDays: ['MON', 'WED', 'FRI'],
  location: 'FULL_GYM',
  equipment: ['halteres'],
  emphasis: [],
  avoid: [],
  injuryTags: ['KNEE'],
  injuriesRaw: ['dor no joelho'],
  requiresProfessionalReview: false,
  parqTags: [],
  parqTriggered: [],
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
  const methodology = {
    current: vi.fn().mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      version: 1,
      versionLabel: METHODOLOGY_VERSION,
      content: METHODOLOGY_GUIDELINES,
      contentSha256: 'a'.repeat(64),
    }),
  } as unknown as MethodologyProvider;
  const semantic = { retrieve: vi.fn().mockResolvedValue([]) } as unknown as SemanticMemoryPort;
  const service = new ProtocolGeneratorService(llm, logger as never, methodology, semantic);
  return { service, calls, logger };
}

function constraintsMessage(req: LLMRequest): string {
  return req.messages.find((message) => message.content.includes('GAIN_MUSCLE'))?.content ?? '';
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
    expect(req.system).not.toContain(METHODOLOGY_GUIDELINES);
    expect(req.messages[0]?.content).toContain('METODOLOGIA_PUBLICADA');
    expect(req.system).toContain('goblet_squat'); // vocabulário da base
    expect(constraintsMessage(req)).toContain('GAIN_MUSCLE');
    expect(constraintsMessage(req)).toContain('KNEE');
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
    const userMessage = constraintsMessage(req);
    expect(userMessage).toContain('Divisões permitidas para este nível: FULL_BODY');
    expect(userMessage).not.toContain('ABCDE');
  });

  // Achado 2026-08-18: sem os dias REAIS declarados, a IA gerava sessões genéricas sem
  // vínculo com a rotina do aluno (podendo entregar menos sessões do que dias declarados).
  it('exige uma sessão por dia real declarado, com o campo weekday no schema', async () => {
    const { service, calls } = makeService([validProtocolJson()]);
    await service.generate(command);
    const req = calls[0];
    if (!req) throw new Error('esperava uma chamada ao LLM');
    expect(req.system).toContain('"weekday"'); // schema com o campo novo
    const userMessage = constraintsMessage(req);
    expect(userMessage).toContain('MON, WED, FRI');
    expect(userMessage).toContain('EXATAMENTE uma sessão por dia');
  });

  it('sem preferredDays, não força a instrução de dias reais no prompt', async () => {
    const { service, calls } = makeService([validProtocolJson()]);
    await service.generate({ ...command, constraints: { ...constraints, preferredDays: [] } });
    const req = calls[0];
    if (!req) throw new Error('esperava uma chamada ao LLM');
    const userMessage = constraintsMessage(req);
    expect(userMessage).not.toContain('Dias da semana em que o aluno vai treinar');
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

  // Achado 2026-08-18 (evidência real de testes ponta a ponta): o GPT-4.1 devolvia
  // "weekday" ausente em TODAS as sessões mesmo com instrução enfática no prompt —
  // reforço determinístico por posição em vez de continuar apostando em texto de prompt.
  describe('backfill de "weekday" ausente (achado 2026-08-18)', () => {
    it('todas as sessões sem weekday + contagem bate com preferredDays → preenche por posição', async () => {
      const { service, logger } = makeService([
        threeSessionsJson([undefined, undefined, undefined]),
      ]);
      const result = await service.generate(command);
      expect(result.structure.sessions.map((s) => s.weekday)).toEqual(['MON', 'WED', 'FRI']);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ preferredDays: ['MON', 'WED', 'FRI'] }),
        expect.stringContaining('preenchendo por posição'),
      );
    });

    it('sessão com weekday parcialmente presente → NÃO mexe (deixa o validador decidir)', async () => {
      const { service } = makeService([threeSessionsJson(['MON', undefined, 'FRI'])]);
      const result = await service.generate(command);
      expect(result.structure.sessions.map((s) => s.weekday)).toEqual(['MON', undefined, 'FRI']);
    });

    it('todas as sessões já com weekday certo → não mexe, não loga', async () => {
      const { service, logger } = makeService([threeSessionsJson(['MON', 'WED', 'FRI'])]);
      const result = await service.generate(command);
      expect(result.structure.sessions.map((s) => s.weekday)).toEqual(['MON', 'WED', 'FRI']);
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('preenchendo por posição'),
      );
    });

    it('contagem de sessões diferente de preferredDays → NÃO preenche (deixa SESSION_COUNT_MISMATCH pegar)', async () => {
      const { service } = makeService([validProtocolJson()]); // 1 sessão só, preferredDays tem 3
      const result = await service.generate(command);
      expect(result.structure.sessions.map((s) => s.weekday)).toEqual([undefined]);
    });

    it('preferredDays vazio → NÃO preenche', async () => {
      const { service } = makeService([threeSessionsJson([undefined, undefined, undefined])]);
      const result = await service.generate({
        ...command,
        constraints: { ...constraints, preferredDays: [] },
      });
      expect(result.structure.sessions.every((s) => s.weekday === undefined)).toBe(true);
    });
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
