import { describe, expect, it, vi } from 'vitest';
import { protocolStructureSchema, type ProtocolStructure } from '@movivo/shared';

import type { AppConfigService } from '../../core/config';
import type { LlmRouter } from '../ai-coach/llm/llm-router.service';
import type { LLMRequest, LLMResult } from '../ai-coach/llm/llm.types';
import type { SemanticMemoryPort } from '../ai-coach/context/semantic-memory.port';
import {
  EXERCISE_BY_ID,
  EXERCISE_CATALOG,
  LEVEL_ORDER,
  lowestLevel,
  servesLocation,
} from '../catalog/exercises/exercise-catalog';
import { ExerciseCatalogProvider } from '../catalog/exercises/exercise-catalog-provider.service';
import { METHODOLOGY_GUIDELINES, METHODOLOGY_VERSION } from './methodology';
import type { MethodologyProvider } from './methodology-provider.service';
import {
  extractJsonObject,
  ProtocolGenerationError,
  painCautionBlock,
  ProtocolGeneratorService,
  PROMPT_VERSION,
  rtFavoritePreferenceBlock,
} from './protocol-generator.service';
import type { UserConstraints } from './user-constraints';
import { QUALITY_CRITERIA, qualityUnavailable } from './contextual-quality';
import { LLMUnavailableError } from '../ai-coach/llm/llm.types';
import { LLMAbuseError } from '../ai-coach/llm/llm-abuse-guard.service';
import { planProtocol } from './protocol-planner';
import { ValidationService } from './validation/validation.service';

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
function validProtocolJson(exerciseId = 'agachamento_barra'): string {
  return JSON.stringify({
    promptVersion: PROMPT_VERSION,
    goal: 'GAIN_MUSCLE',
    phase: 'ADAPTACAO',
    phaseDurationWeeks: 3,
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
    phaseDurationWeeks: 3,
    weeklyFrequency: 3,
    sessions: weekdays.map((weekday, i) => ({
      dayLabel: `Dia ${i + 1}`,
      ...(weekday ? { weekday } : {}),
      focus: 'Corpo inteiro',
      exercises: [
        {
          exerciseId: 'agachamento_barra',
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
  trainingStatus: 'REGULAR',
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

function makeService(
  responses: string[],
  retrieve: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue([]),
  catalog: ExerciseCatalogProvider = new ExerciseCatalogProvider(),
) {
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
  const semantic = { retrieve } as unknown as SemanticMemoryPort;
  const config = { llm: { protocolMaxTokens: 6000 } } as unknown as AppConfigService;
  const service = new ProtocolGeneratorService(
    llm,
    logger as never,
    methodology,
    config,
    catalog,
    semantic,
  );
  return { service, calls, logger, retrieve, llm, methodology };
}

function ragDoc(chunkId: string, documentId: string, snippet = chunkId) {
  return {
    chunkId,
    documentId,
    title: `Artigo ${documentId}`,
    snippet,
    score: 0.9,
  };
}

function constraintsMessage(req: LLMRequest): string {
  return req.messages.find((message) => message.content.includes('GAIN_MUSCLE'))?.content ?? '';
}

const command = { userId: 'u-1', user: { name: 'João' }, constraints };

function reviewJson(
  status: 'MET' | 'ADAPTED' | 'GAP' = 'MET',
  excerpt = METHODOLOGY_GUIDELINES.slice(0, 80).trim(),
) {
  return JSON.stringify(
    Object.fromEntries(
      QUALITY_CRITERIA.map((criterion) => [
        criterion,
        {
          status,
          methodologyExcerpt: excerpt,
          observation: 'Distribuição observada no rascunho sintético.',
          adjustment: status === 'GAP' ? 'Redistribua os exercícios elegíveis.' : null,
        },
      ]),
    ),
  );
}

describe('avaliação contextual com a metodologia publicada', () => {
  it('usa mesmo RT publicado, contexto e cobertura real, pelo router HEALTH', async () => {
    const { service, calls } = makeService([validProtocolJson(), reviewJson()]);
    const generated = await service.generate(command);
    const quality = await service.assessQuality(command, generated);
    expect(quality.summary.status).toBe('PASS');
    const request = calls[1];
    if (!request) throw new Error('esperava chamada do avaliador');
    expect(request).toMatchObject({
      purpose: 'PROTOCOL_GENERATION',
      intent: 'protocol_contextual_quality',
      dataClass: 'HEALTH',
      temperature: 0,
      json: true,
      user: command.user,
    });
    expect(request.system).toContain(METHODOLOGY_GUIDELINES);
    expect(request.system).toContain('nem imponha fase pelo PAR-Q');
    expect(request.system).not.toContain('- agachamento_barra |');
    expect(request.messages[0]?.content).toContain('treina regularmente');
    expect(request.messages[0]?.content).not.toContain('Monte o protocolo individualizado');
    expect(request.messages[1]?.content).toContain('RASCUNHO_E_COBERTURA_REAL');
    expect(request.messages[1]?.content).toContain('SQUAT');
    expect(request.messages[1]?.content).toContain('DADOS_NÃO_CONFIÁVEIS');
  });

  it.each(['ADAPTED', 'GAP'] as const)('distingue %s de aprovação genérica', async (status) => {
    const { service } = makeService([validProtocolJson(), reviewJson(status)]);
    const result = await service.assessQuality(command, await service.generate(command));
    expect(result.summary.status).toBe(status === 'GAP' ? 'GAPS' : 'PASS');
    expect(result.summary.checks.every((check) => check.status === status)).toBe(true);
    expect(JSON.stringify(result.summary)).not.toContain('Distribuição observada');
  });

  it.each([
    'não é JSON',
    '{invalid}',
    '{}',
    '{"METHODOLOGY_FIT":{"status":"MET"}}',
    reviewJson('MET', 'Regra inventada ausente na metodologia.'),
  ])('parecer inválido não vira PASS: %s', async (text) => {
    const { service, logger } = makeService([validProtocolJson(), text]);
    const quality = await service.assessQuality(command, await service.generate(command));
    expect(quality).toEqual(qualityUnavailable('INVALID_REVIEW'));
    expect(logger.warn).toHaveBeenCalled();
  });

  it('publicação concorrente não avalia o rascunho com outra metodologia', async () => {
    const { service, calls } = makeService([validProtocolJson()]);
    const generated = await service.generate(command);
    const quality = await service.assessQuality(command, {
      ...generated,
      methodologySha256: 'diferente',
    });
    expect(quality.summary.unavailableReason).toBe('METHODOLOGY_CHANGED');
    expect(calls).toHaveLength(1);
  });

  it('indisponibilidade esperada preserva o rascunho com revisão obrigatória explícita', async () => {
    const { service, llm, logger } = makeService([validProtocolJson()]);
    const generated = await service.generate(command);
    vi.mocked(llm.complete).mockRejectedValueOnce(new LLMUnavailableError('offline'));
    expect(await service.assessQuality(command, generated)).toEqual(
      qualityUnavailable('LLM_UNAVAILABLE'),
    );
    expect(logger.warn).toHaveBeenCalled();
  });

  it('não oculta erro inesperado do avaliador', async () => {
    const { service, llm } = makeService([validProtocolJson()]);
    const generated = await service.generate(command);
    vi.mocked(llm.complete).mockRejectedValueOnce(new Error('bug inesperado'));
    await expect(service.assessQuality(command, generated)).rejects.toThrow('bug inesperado');
  });

  it('limite diário não descarta um rascunho já gerado', async () => {
    const { service, llm } = makeService([validProtocolJson()]);
    const generated = await service.generate(command);
    vi.mocked(llm.complete).mockRejectedValueOnce(new LLMAbuseError('limite'));
    expect(await service.assessQuality(command, generated)).toEqual(
      qualityUnavailable('LLM_LIMIT'),
    );
  });

  it('usa a metodologia runtime publicada, não uma rubrica fixa presa ao seed', async () => {
    const content =
      'Metodologia sintética publicada: concilie o objetivo e as preferências com a recuperação individual.';
    const { service, calls, methodology } = makeService([
      validProtocolJson(),
      reviewJson('ADAPTED', content),
    ]);
    vi.mocked(methodology.current).mockResolvedValue({
      id: 'publicacao-v42',
      version: 42,
      versionLabel: 'metodologia-v42',
      content,
      contentSha256: 'b'.repeat(64),
    });
    const generated = await service.generate(command);
    const quality = await service.assessQuality(command, generated);
    expect(quality.summary.status).toBe('PASS');
    expect(generated.methodologyVersionId).toBe('publicacao-v42');
    expect(calls[1]?.system).toContain(content);
    expect(calls[1]?.system).not.toContain(METHODOLOGY_GUIDELINES);
  });

  it('fluxo PAR-Q: PASS de segurança sem core é corrigido mesmo se o avaliador disser MET', async () => {
    const initial = protocolStructureSchema.parse(
      JSON.parse(
        threeSessionsJson(['MON', 'WED', 'FRI']).replaceAll(
          'agachamento_barra',
          'agachamento_goblet',
        ),
      ),
    );
    const corrected: ProtocolStructure = {
      ...initial,
      sessions: initial.sessions.map((session) => ({
        ...session,
        exercises: [
          ...session.exercises,
          {
            exerciseId: 'prancha',
            name: 'Prancha',
            sets: 2,
            durationSeconds: 30,
            loadStrategy: 'BODYWEIGHT',
            restSeconds: 60,
          },
        ],
      })),
    };
    const { service, calls } = makeService([
      JSON.stringify(initial),
      reviewJson(),
      JSON.stringify(corrected),
      reviewJson(),
    ]);
    const input = {
      ...command,
      constraints: {
        ...constraints,
        requiresProfessionalReview: true,
        injuryTags: [],
        injuriesRaw: [],
        emphasis: ['core'],
      },
    };
    const validation = new ValidationService();
    expect(validation.validate({ structure: initial, constraints: input.constraints }).code).toBe(
      'PASS',
    );
    const plan = await planProtocol(service, validation, input);
    expect(plan.usedFallbackTemplate).toBe(false);
    expect(plan.trace.corrections).toBe(1);
    expect(plan.contextualQuality).toMatchObject({ status: 'PASS', missingEmphasisCount: 0 });
    expect(
      plan.content.sessions.every((session) =>
        session.exercises.some((exercise) => exercise.exerciseId === 'prancha'),
      ),
    ).toBe(true);
    expect(calls.map((call) => call.intent)).toEqual([
      'protocol_generation',
      'protocol_contextual_quality',
      'protocol_generation',
      'protocol_contextual_quality',
    ]);
    expect(calls[2]?.messages.at(-1)?.content).toContain('ênfase solicitada sem exercício');
    expect(JSON.stringify(plan.trace)).not.toContain('Distribuição observada');
    expect(JSON.stringify(plan.contextualQuality)).not.toContain('Distribuição observada');
  });

  it('leva contexto de rotina e histórico à geração e à avaliação, como dados não confiáveis', async () => {
    const { service, calls } = makeService([validProtocolJson(), reviewJson()]);
    const input = {
      ...command,
      constraints: {
        ...constraints,
        routineContext: 'Barreiras: LACK_OF_TIME, TIREDNESS. Esporte: corrida 3x/semana.',
        anamnesisInvariants: 'Experiência original intermediária.',
        continuation: {
          previousMesocycleNumber: 2,
          previousPhase: 'HIPERTROFIA' as const,
          previousPhaseDurationWeeks: 6,
          summary: 'Fadiga ao final do ciclo.',
          executionDigest: 'Aderência real: 80%.',
        },
      },
    };
    const generated = await service.generate(input);
    await service.assessQuality(input, generated);
    for (const request of calls) {
      const messages = request.messages.map((turn) => turn.content).join('\n');
      expect(messages).toContain('LACK_OF_TIME, TIREDNESS');
      expect(messages).toContain('Aderência real: 80%');
      expect(messages).toContain('DADO');
      expect(request.system).not.toContain('Esporte: corrida 3x/semana');
    }
  });
});

describe('ProtocolGeneratorService', () => {
  it.each([
    {
      name: 'avançado ocasional com ênfase em braços e pouco tempo',
      profile: {
        level: 'AVANCADO',
        trainingStatus: 'OCCASIONAL',
        daysPerWeek: 4,
        sessionMinutes: 30,
        emphasis: ['bíceps', 'tríceps', 'core'],
        routineContext: 'Barreiras: LACK_OF_TIME.',
        injuryTags: [],
        injuriesRaw: [],
      },
      expected: [
        'AVANCADO',
        'treina de forma ocasional/irregular',
        '30 min',
        'bíceps, tríceps, core',
        'LACK_OF_TIME',
      ],
    },
    {
      name: 'intermediário retornando após pausa longa',
      profile: {
        level: 'INTERMEDIARIO',
        trainingStatus: 'STOPPED',
        stoppedFor: 'Y1_TO_2',
        daysPerWeek: 3,
        sessionMinutes: 60,
        emphasis: ['ombro', 'core'],
        injuryTags: [],
        injuriesRaw: [],
      },
      expected: ['INTERMEDIARIO', '1 a 2 anos', '60 min', 'ombro, core'],
    },
    {
      name: 'iniciante com dor, sem bloqueio no PAR-Q',
      profile: {
        level: 'INICIANTE',
        trainingStatus: 'NEVER',
        daysPerWeek: 2,
        sessionMinutes: 45,
        emphasis: ['glúteo'],
      },
      expected: ['INICIANTE', '45 min', 'glúteo', 'KNEE', 'dor no joelho'],
    },
  ] satisfies Array<{
    name: string;
    profile: Partial<UserConstraints>;
    expected: string[];
  }>)(
    'contrato de geração contextual sem parecer adicional: $name',
    async ({ profile, expected }) => {
      const retrieve = vi.fn().mockResolvedValue([]);
      const { service, calls } = makeService([validProtocolJson()], retrieve);
      const input = { ...command, constraints: { ...constraints, ...profile } };
      await service.generate(input);
      expect(calls.map((call) => call.intent)).toEqual(['protocol_generation']);
      const request = calls[0];
      if (!request) throw new Error('Chamada de geração ausente');
      const message = request.messages.map((turn) => turn.content).join('\n');
      for (const value of expected) expect(message).toContain(value);
      expect(message).not.toContain('até 2');
      for (const requirement of [
        'experiência declarada não é regularidade',
        'séries diretas',
        'padrão CORE',
        'agrupamento muscular',
        'unilaterais dos dois lados',
        'orientação curta e acionável',
        'Não invente fontes',
      ])
        expect(request.system?.toLowerCase()).toContain(requirement.toLowerCase());
      const dosageQuery = retrieve.mock.calls[1]?.[0];
      expect(dosageQuery).toContain(profile.trainingStatus);
      expect(dosageQuery).toContain(`${profile.daysPerWeek} dias por semana`);
      expect(dosageQuery).toContain(`${profile.sessionMinutes} minutos por sessão`);
      expect(dosageQuery).not.toContain('dor no joelho');
    },
  );

  it('gera um ProtocolStructure válido a partir da saída do LLM', async () => {
    const { service } = makeService([validProtocolJson()]);
    const result = await service.generate(command);
    expect(result.structure.goal).toBe('GAIN_MUSCLE');
    expect(result.structure.sessions[0]?.exercises[0]?.exerciseId).toBe('agachamento_barra');
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
    // Achado 2026-09-03: a metodologia mora no `system` (canal confiável), não mais
    // como mensagem `user` no envelope de dado não confiável — ver cabeçalho do arquivo.
    expect(req.system).toContain(METHODOLOGY_GUIDELINES);
    expect(req.messages.some((m) => m.content.includes('METODOLOGIA_PUBLICADA'))).toBe(false);
    // `remada_baixa_iso_lateral` (não contraindicado por KNEE) confirma que a base aparece no prompt sem
    // contradizer o filtro de contraindicação do catálogo (constraints usa injuryTags: ['KNEE']).
    expect(req.system).toContain('remada_baixa_iso_lateral');
    expect(req.system).not.toContain('agachamento_barra'); // contraindicado por KNEE — filtrado do prompt
    expect(constraintsMessage(req)).toContain('GAIN_MUSCLE');
    expect(constraintsMessage(req)).toContain('KNEE');
  });

  // Achado 2026-09-02 (correção do fundador): o evento-alvo é contexto de OTIMIZAÇÃO do
  // prompt (fase/ênfase/progressão dentro do prazo real) — nunca fonte de
  // "phaseDurationWeeks" nem instrução pra prometer o resultado que o aluno descreveu.
  it('inclui o evento-alvo (Data-alvo) no prompt como otimização, nunca como promessa', async () => {
    const { service, calls } = makeService([validProtocolJson()]);
    await service.generate({
      ...command,
      constraints: {
        ...constraints,
        importantEvent: {
          date: '2026-12-25',
          daysUntil: 114,
          description: 'quero emagrecer e chegar a 70kg pro Natal',
        },
      },
    });
    const req = calls[0];
    if (!req) throw new Error('esperava uma chamada ao LLM');
    const message = constraintsMessage(req);
    expect(message).toContain('faltam 114 dias');
    expect(message).toContain('2026-12-25');
    expect(message).toContain('quero emagrecer e chegar a 70kg pro Natal');
    expect(message).toContain('NÃO prometa nem confirme esse número');
    expect(req.system).toContain('DURAÇÃO DO MESOCICLO');
  });

  it('sem evento-alvo, não inclui o bloco de otimização no prompt', async () => {
    const { service, calls } = makeService([validProtocolJson()]);
    await service.generate(command);
    const req = calls[0];
    if (!req) throw new Error('esperava uma chamada ao LLM');
    expect(constraintsMessage(req)).not.toContain('Evento/objetivo com prazo real');
  });

  it('busca evidência por facetas, combina mais de 3 trechos e remove duplicatas', async () => {
    const shared = ragDoc('chunk-shared', 'doc-shared');
    const retrieve = vi
      .fn()
      .mockResolvedValueOnce([ragDoc('chunk-goal-1', 'doc-1'), shared])
      .mockResolvedValueOnce([ragDoc('chunk-dose-1', 'doc-2'), shared])
      .mockResolvedValueOnce([ragDoc('chunk-place-1', 'doc-3')])
      .mockResolvedValueOnce([ragDoc('chunk-limit-1', 'doc-4')]);
    const { service, calls } = makeService([validProtocolJson()], retrieve);

    const result = await service.generate(command);

    expect(retrieve).toHaveBeenCalledTimes(4);
    expect(retrieve.mock.calls.every((call) => call[1]?.topK === 10)).toBe(true);
    expect(retrieve.mock.calls[0]?.[0]).toContain('hipertrofia');
    expect(retrieve.mock.calls[0]?.[0]).toContain('definição muscular');
    expect(result.knowledgeSources).toHaveLength(5);
    expect(
      result.knowledgeSources?.filter((source) => source.chunkId === 'chunk-shared'),
    ).toHaveLength(1);
    const evidenceMessage = calls[0]?.messages.find((message) =>
      message.content.includes('EVIDENCIAS_SELETIVAS'),
    );
    expect(evidenceMessage?.content).toContain('chunk-goal-1');
    expect(evidenceMessage?.content).toContain('chunk-limit-1');
  });

  it('preserva facetas disponíveis quando uma busca do RAG falha', async () => {
    const retrieve = vi
      .fn()
      .mockRejectedValueOnce(new Error('embedding indisponível'))
      .mockResolvedValueOnce([ragDoc('chunk-dose', 'doc-dose')])
      .mockResolvedValue([]);
    const { service, logger } = makeService([validProtocolJson()], retrieve);

    const result = await service.generate(command);

    expect(result.knowledgeSources?.map((source) => source.chunkId)).toEqual(['chunk-dose']);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-1' }),
      expect.stringContaining('faceta do RAG indisponível'),
    );
  });

  it('expande emagrecimento para definição, composição corporal e hipertrofia na busca', async () => {
    const retrieve = vi.fn().mockResolvedValue([]);
    const { service } = makeService([validProtocolJson()], retrieve);

    await service.generate({
      ...command,
      constraints: { ...constraints, goal: 'LOSE_FAT', injuryTags: [] },
    });

    const goalQuery = String(retrieve.mock.calls[0]?.[0]);
    expect(goalQuery).toContain('emagrecimento');
    expect(goalQuery).toContain('definição muscular');
    expect(goalQuery).toContain('hipertrofia');
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
        expect.objectContaining({
          preferredDays: ['MON', 'WED', 'FRI'],
          weekdays: ['MON', 'WED', 'FRI'],
        }),
        expect.stringContaining('distribuição determinística'),
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

// Redução de fallback (2026-09-29): conflito prompt × validador resolvido no prompt e
// rodada de correção com o JSON reprovado + feedback estruturado.
describe('prompt de regras verificadas e rodada de correção (2026-09-29)', () => {
  const loseFat: UserConstraints = {
    ...constraints,
    goal: 'LOSE_FAT',
    injuryTags: [],
    injuriesRaw: [],
  };

  async function userMessageFor(c: UserConstraints): Promise<string> {
    const { service, calls } = makeService([validProtocolJson()]);
    await service.generate({ ...command, constraints: c });
    return calls[0]?.messages[0]?.content ?? '';
  }

  it('LOSE_FAT: sai a exigência de circuito, entra musculação válida + cardio no fim sem "technique"', async () => {
    const message = await userMessageFor(loseFat);
    expect(message).not.toContain('Musculação tradicional sozinha');
    expect(message).not.toContain('não atende este objetivo');
    expect(message).toContain('NÃO é obrigatório usar circuito');
    expect(message).toContain('já é, sozinha, um treino completo e válido para este objetivo');
    expect(message).toContain('um bloco de cardio no FIM da sessão');
    expect(message).toContain('nunca use o campo "technique" para representá-lo');
    expect(message).toContain(
      'Padrões de movimento prioritários para este objetivo: SQUAT, HINGE, HORIZONTAL_PUSH, HORIZONTAL_PULL, LUNGE, CARDIO',
    );
  });

  it('CONDITIONING: mantém a exigência de cardio, como exercício separado e nunca "technique"', async () => {
    const message = await userMessageFor({ ...loseFat, goal: 'CONDITIONING' });
    expect(message).toContain('o treino resistido sozinho NÃO é a estratégia completa');
    expect(message).toContain('não use o campo "technique" para representá-lo');
    expect(message).toContain('o profissional CREF complementa na revisão');
  });

  it('INICIANTE: bloco de regras proíbe "technique" inclusive em CIRCUITO/superséries', async () => {
    const message = await userMessageFor(constraints);
    const rules = message.slice(message.indexOf('REGRAS VERIFICADAS AUTOMATICAMENTE'));
    expect(rules).toContain(
      'REGRAS VERIFICADAS AUTOMATICAMENTE (o protocolo é reprovado se violar qualquer uma):',
    );
    expect(rules).toContain('Nível INICIANTE: o campo "technique" é PROIBIDO');
    expect(rules).toContain('inclusive SUPERSET, BI_SET, TRI_SET e DESCANSO_ATIVO');
    expect(rules).toContain('no máximo 70% dos exercícios podem ser ISOLATION');
    expect(rules).toContain('Todo "exerciseId" deve ser copiado EXATAMENTE');
    expect(rules).toContain('nunca prometa prazo de resposta');
    // Bloco vem antes do fechamento da mensagem.
    expect(message.indexOf('REGRAS VERIFICADAS')).toBeLessThan(
      message.indexOf('Monte o protocolo individualizado'),
    );
  });

  it('INTERMEDIARIO/AVANCADO: teto de técnicas por sessão vem da constante do validador', async () => {
    const message = await userMessageFor({ ...constraints, level: 'INTERMEDIARIO' });
    expect(message).not.toContain('Nível INICIANTE: o campo "technique" é PROIBIDO');
    expect(message).toContain('no máximo 2 exercícios com "technique" por sessão');
    expect(message).toContain('a divisão CIRCUITO é a única exceção');
  });

  it('revisão obrigatória preserva status e delega fase à metodologia mesmo com teto legado', async () => {
    const regular = await userMessageFor(constraints);
    expect(regular).toContain('NÃO force ADAPTACAO');
    const capped = await userMessageFor({
      ...constraints,
      requiresProfessionalReview: true,
      maxPhase: 'ADAPTACAO',
    });
    expect(capped).toContain('NÃO force ADAPTACAO');
    expect(capped).not.toContain('"phase" DEVE ser exatamente "ADAPTACAO"');
    const { service, calls } = makeService([validProtocolJson()]);
    await service.generate({
      ...command,
      constraints: { ...constraints, requiresProfessionalReview: true },
    });
    expect(calls[0]?.system).toContain(
      'Revisão obrigatória não impõe ADAPTACAO nem reduz o nível de experiência.',
    );
  });

  it('schema: "technique" nunca para INICIANTE, nem em CIRCUITO; cardio no fim não é técnica', async () => {
    const { service, calls } = makeService([validProtocolJson()]);
    await service.generate(command);
    expect(calls[0]?.system).toContain(
      '(opcional; NUNCA para INICIANTE — nem em CIRCUITO; cardio no fim da sessão não é técnica)',
    );
  });

  it('regra genérica: padrão sem opção na base → não inventar id, omitir o padrão', async () => {
    const message = await userMessageFor(constraints);
    expect(message).toContain(
      'Se a base de referência não tiver nenhum exercício de um padrão de movimento, não invente um id: omita o padrão e equilibre a sessão com os demais.',
    );
  });

  // Revisão do Victor (2026-09-29): o reparo de id alucinado só aceita candidato da BASE
  // DESTE ALUNO (local + nível + contraindicação), nunca do catálogo inteiro.
  describe('reparo de id alucinado restrito à base do aluno', () => {
    const onlyBeginnerRow = (() => {
      const entries = EXERCISE_CATALOG.map((e) =>
        e.id === 'remada_invertida' ? { ...e, levels: ['INICIANTE' as const] } : e,
      );
      const byId = new Map(entries.map((e) => [e.id, e]));
      return {
        getAll: () => entries,
        getById: (id: string) => byId.get(id),
        isKnown: (id: string) => byId.has(id),
      } as unknown as ExerciseCatalogProvider;
    })();
    const home: UserConstraints = {
      ...constraints,
      location: 'HOME',
      injuryTags: [],
      injuriesRaw: [],
    };

    it('remada_invertida só Iniciante + aluno Avançado em Casa: não repara, fica EXERCISE_UNKNOWN', async () => {
      const { service } = makeService(
        [validProtocolJson('remada_invertida_na_mesa')],
        undefined,
        onlyBeginnerRow,
      );
      const result = await service.generate({
        ...command,
        constraints: { ...home, level: 'AVANCADO' },
      });
      expect(result.structure.sessions[0]?.exercises[0]?.exerciseId).toBe(
        'remada_invertida_na_mesa',
      );
      expect(result.unknownExerciseIds).toEqual(['remada_invertida_na_mesa']);
    });

    it('mesmo catálogo, aluno Iniciante em Casa (dentro da base): repara para remada_invertida', async () => {
      const { service } = makeService(
        [validProtocolJson('remada_invertida_na_mesa')],
        undefined,
        onlyBeginnerRow,
      );
      const result = await service.generate({ ...command, constraints: home });
      expect(result.structure.sessions[0]?.exercises[0]?.exerciseId).toBe('remada_invertida');
      expect(result.unknownExerciseIds).toEqual([]);
    });
  });

  // Achado 2026-10-14 (produção, perfil 7 dias/30 min/LOSE_FAT): saída rejeitada por falha de
  // forma derrubava o protocolo para o FALLBACK_TEMPLATE.
  describe('tolerância a falhas de forma da saída do modelo', () => {
    it('aceita saída sem promptVersion e devolve o promptVersion NOSSO', async () => {
      const { promptVersion: _drop, ...withoutVersion } = JSON.parse(validProtocolJson());
      const { service, calls } = makeService([JSON.stringify(withoutVersion)]);
      const result = await service.generate(command);
      expect(calls).toHaveLength(1);
      expect(result.structure.promptVersion).toBe(PROMPT_VERSION);
    });

    it('não pede promptVersion ao modelo no formato de saída', async () => {
      const { service, calls } = makeService([validProtocolJson()]);
      await service.generate(command);
      expect(calls[0]?.system).not.toContain('"promptVersion"');
    });

    it('registra o motivo (caminho do schema, sem conteúdo) quando a saída é reprovada', async () => {
      const broken = JSON.parse(validProtocolJson());
      broken.sessions[0].exercises[0].reps = { min: 20, max: 8 };
      const { service, logger } = makeService([JSON.stringify(broken), validProtocolJson()]);
      await service.generate(command);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u-1',
          reason: 'SCHEMA',
          issues: [expect.stringContaining('sessions.0.exercises.0.reps')],
        }),
        'saída reprovada pelo schema do protocolo',
      );
    });
  });

  // Achado 2026-10-14: o modelo escreve `supino_reto_maquina` ("supino na máquina") e o
  // catálogo chama o exercício de `supino_sentado_maquina`.
  describe('alias de nome popular de exercício', () => {
    it('supino_reto_maquina vira supino_sentado_maquina quando está na base do aluno', async () => {
      const { service } = makeService([validProtocolJson('supino_reto_maquina')]);
      const result = await service.generate(command);
      expect(result.structure.sessions[0]?.exercises[0]?.exerciseId).toBe('supino_sentado_maquina');
      expect(result.unknownExerciseIds).toEqual([]);
    });

    it('com ombro contraindicado, o destino sai da base: não repara e fica EXERCISE_UNKNOWN', async () => {
      const { service } = makeService([validProtocolJson('supino_reto_maquina')]);
      const result = await service.generate({
        ...command,
        constraints: { ...constraints, injuryTags: ['SHOULDER'] },
      });
      expect(result.structure.sessions[0]?.exercises[0]?.exerciseId).toBe('supino_reto_maquina');
      expect(result.unknownExerciseIds).toEqual(['supino_reto_maquina']);
    });
  });

  describe('rodada de correção', () => {
    // HINGE contraindicado por KNEE (as `constraints` deste arquivo têm KNEE).
    const vetoed = 'levantamento_terra_romeno_halter';
    const previous = JSON.parse(validProtocolJson(vetoed)) as ProtocolStructure;
    const previousFirst = previous.sessions[0]?.exercises[0];
    if (!previousFirst) throw new Error('fixture inválida');
    previousFirst.videoUrl = 'https://example.com/v.mp4';
    const correction = {
      previous,
      violations: [{ rule: 'EXERCISE_CONTRAINDICATED', detail: 'x', action: 'BLOCK' as const }],
      round: 1,
    };

    it('ordem das mensagens: user, evidências, assistant (JSON anterior), user (correção)', async () => {
      const retrieve = vi.fn().mockResolvedValue([ragDoc('chunk-1', 'doc-1')]);
      const { service, calls } = makeService([validProtocolJson()], retrieve);
      await service.generate({ ...command, correction });
      const messages = calls[0]?.messages ?? [];

      expect(messages.map((m) => m.role)).toEqual(['user', 'user', 'assistant', 'user']);
      expect(messages[0]?.content).toContain('Objetivo: GAIN_MUSCLE');
      expect(messages[1]?.content).toContain('EVIDENCIAS_SELETIVAS');
      const assistant = JSON.parse(messages[2]?.content ?? '{}') as Record<string, unknown>;
      expect(assistant).not.toHaveProperty('promptVersion');
      expect(messages[2]?.content).not.toContain('videoUrl');
      expect(messages[2]?.content).toContain(vetoed);
      expect(messages[3]?.content).toMatch(/^CORREÇÃO OBRIGATÓRIA:/);
      expect(messages[3]?.content).toContain(`[EXERCISE_CONTRAINDICATED] "${vetoed}"`);
    });

    it('opções de troca saem da base filtrada deste aluno (KNEE) — nunca um id vetado', async () => {
      const { service, calls } = makeService([validProtocolJson()]);
      await service.generate({ ...command, correction });
      const correctionMessage = calls[0]?.messages.at(-1)?.content ?? '';
      const options = (correctionMessage.match(/Opções válidas: ([^.]+)\./)?.[1] ?? '').split(', ');
      expect(options.filter(Boolean).length).toBeGreaterThan(0);
      expect(options).not.toContain(vetoed);
      for (const id of options.filter(Boolean)) {
        expect(EXERCISE_BY_ID.get(id)?.pattern).toBe('HINGE');
        expect(EXERCISE_BY_ID.get(id)?.contraindicatedFor).not.toContain('KNEE');
        expect(calls[0]?.system).toContain(`- ${id} | `);
      }
    });

    it('retry de JSON malformado vai por último, depois da correção', async () => {
      const { service, calls } = makeService(['lixo', validProtocolJson()]);
      const result = await service.generate({ ...command, correction });
      expect(result.malformedRetries).toBe(1);
      const roles = calls[1]?.messages.map((m) => m.role);
      expect(roles).toEqual(['user', 'assistant', 'user', 'user']);
      expect(calls[1]?.messages.at(-1)?.content).toContain('JSON válido');
      expect(calls[1]?.messages.at(-2)?.content).toMatch(/^CORREÇÃO OBRIGATÓRIA:/);
    });

    it('sem correção: só a mensagem do aluno (e evidências), sem turno assistant', async () => {
      const { service, calls } = makeService([validProtocolJson()]);
      const result = await service.generate(command);
      expect(calls[0]?.messages.map((m) => m.role)).toEqual(['user']);
      expect(result.malformedRetries).toBe(0);
    });
  });
});

// Achado 2026-09-26: favoritos do RT CREF no painel "Exercícios" viram PREFERÊNCIA de
// prescrição (critério primário da ORDEM desde 2026-09-29), nunca eixo de segurança — o
// filtro da base não muda.
describe('favoritos do RT na BASE DE REFERÊNCIA (achado 2026-09-26)', () => {
  const FAVORITE_MARKER = 'preferido pelo profissional CREF: sim';
  const FAVORITE_BLOCK_HEADER = 'PREFERÊNCIA DE PRESCRIÇÃO DO PROFISSIONAL CREF';
  const BASE_HEADER = 'BASE DE REFERÊNCIA (use SOMENTE';

  const baseConstraints: UserConstraints = {
    ...constraints,
    location: 'FULL_GYM',
    level: 'INICIANTE',
    injuryTags: [],
    injuriesRaw: [],
  };

  /** Catálogo estático com `isFavorite` explícito (true nos ids dados, false no resto). */
  function catalogWithFavorites(favoriteIds: readonly string[]): ExerciseCatalogProvider {
    for (const id of favoriteIds) {
      // Um id digitado errado faria o teste passar sem testar nada.
      if (!EXERCISE_BY_ID.has(id)) throw new Error(`id de teste fora do catálogo: ${id}`);
    }
    const favorites = new Set(favoriteIds);
    const entries = EXERCISE_CATALOG.map((e) => ({ ...e, isFavorite: favorites.has(e.id) }));
    const byId = new Map(entries.map((e) => [e.id, e]));
    return {
      getAll: () => entries,
      getById: (id: string) => byId.get(id),
      isKnown: (id: string) => byId.has(id),
    } as unknown as ExerciseCatalogProvider;
  }

  /** `system` prompt real enviado ao LLM. Sem `catalog`: bootstrap (`isFavorite` undefined). */
  async function systemPromptFor(
    c: UserConstraints,
    catalog?: ExerciseCatalogProvider,
  ): Promise<string> {
    const { service, calls } = makeService([validProtocolJson()], undefined, catalog);
    await service.generate({ ...command, constraints: c });
    const system = calls[0]?.system;
    if (!system) throw new Error('esperava uma chamada ao LLM');
    return system;
  }

  /** Linhas de exercício ("- id | ...") da seção BASE DE REFERÊNCIA, na ordem do prompt. */
  function referenceBaseLines(system: string): string[] {
    const lines = system.split('\n');
    const start = lines.findIndex((line) => line.startsWith(BASE_HEADER));
    const end = lines.indexOf('SCHEMA DO JSON DE SAÍDA:');
    if (start === -1 || end <= start) throw new Error('seção BASE DE REFERÊNCIA não encontrada');
    return lines.slice(start + 1, end).filter((line) => line.startsWith('- '));
  }

  const lineId = (line: string): string => line.slice(2).split(' | ', 1)[0] ?? '';

  /** Blocos por grupo muscular da BASE (cada um com seus ids, na ordem do prompt). */
  function referenceBaseBlocks(system: string): string[][] {
    const lines = system.split('\n');
    const start = lines.findIndex((line) => line.startsWith(BASE_HEADER));
    const end = lines.indexOf('SCHEMA DO JSON DE SAÍDA:');
    const blocks: string[][] = [];
    for (const line of lines.slice(start + 1, end)) {
      if (line.startsWith('## ')) blocks.push([]);
      else if (line.startsWith('- ')) blocks[blocks.length - 1]?.push(lineId(line));
    }
    return blocks;
  }

  /** O que o prompt faz com uma lista de ids: agrupa por 1º grupo muscular (ordem de 1ª aparição). */
  function groupedLikePrompt(ids: readonly string[]): string[] {
    const groupOf = (id: string): string => EXERCISE_BY_ID.get(id)?.muscleGroups[0] ?? 'outros';
    return [...new Set(ids.map(groupOf))].flatMap((group) =>
      ids.filter((id) => groupOf(id) === group),
    );
  }

  /** Ordem ANTERIOR a esta mudança (filtro + sort estável só por equipamento), congelada. */
  function legacyOrderIds(c: UserConstraints): string[] {
    const filtered = EXERCISE_CATALOG.filter(
      (e) =>
        servesLocation(e, c.location) &&
        // Critério LEGADO ("a partir do nível mínimo"): com o seed/backfill (níveis contíguos
        // até AVANCADO) a oferta estrita por `levels` tem de dar exatamente a mesma base.
        LEVEL_ORDER[lowestLevel(e.levels)] <= LEVEL_ORDER[c.level] &&
        !e.contraindicatedFor.some((tag) => c.injuryTags.includes(tag)),
    );
    const equipmentFirst = c.location === 'FULL_GYM' || c.location === 'CONDO_GYM';
    const ordered = equipmentFirst
      ? [...filtered].sort(
          (a, b) => Number(b.equipment.length > 0) - Number(a.equipment.length > 0),
        )
      : filtered;
    return ordered.map((e) => e.id);
  }

  // 2026-09-29 (decisão do fundador): oferta ESTRITA — só os níveis marcados.
  it('oferta estrita por nível: exercício só "Iniciante" some da base de aluno avançado', async () => {
    const target = 'supino_reto_halter';
    const entries = EXERCISE_CATALOG.map((e) =>
      e.id === target ? { ...e, levels: ['INICIANTE' as const] } : e,
    );
    const byId = new Map(entries.map((e) => [e.id, e]));
    const catalog = {
      getAll: () => entries,
      getById: (id: string) => byId.get(id),
      isKnown: (id: string) => byId.has(id),
    } as unknown as ExerciseCatalogProvider;
    const beginner = referenceBaseLines(await systemPromptFor(baseConstraints, catalog));
    const advanced = referenceBaseLines(
      await systemPromptFor({ ...baseConstraints, level: 'AVANCADO' }, catalog),
    );
    expect(beginner.map(lineId)).toContain(target);
    expect(advanced.map(lineId)).not.toContain(target);
    // Controle: com os 3 níveis marcados (seed), o avançado recebe o exercício.
    expect(
      referenceBaseLines(await systemPromptFor({ ...baseConstraints, level: 'AVANCADO' })).map(
        lineId,
      ),
    ).toContain(target);
  });

  it('único favorito sai da base POR NÍVEL (marcado só Iniciante, aluno Avançado): some o bloco', async () => {
    const target = 'supino_reto_halter';
    const entries = EXERCISE_CATALOG.map((e) => ({
      ...e,
      isFavorite: e.id === target,
      ...(e.id === target ? { levels: ['INICIANTE' as const] } : {}),
    }));
    const byId = new Map(entries.map((e) => [e.id, e]));
    const catalog = {
      getAll: () => entries,
      getById: (id: string) => byId.get(id),
      isKnown: (id: string) => byId.has(id),
    } as unknown as ExerciseCatalogProvider;
    const beginner = await systemPromptFor(baseConstraints, catalog);
    expect(beginner).toContain(FAVORITE_BLOCK_HEADER);
    const advanced = await systemPromptFor({ ...baseConstraints, level: 'AVANCADO' }, catalog);
    expect(advanced).not.toContain(FAVORITE_BLOCK_HEADER);
    expect(advanced).not.toContain(FAVORITE_MARKER);
    expect(referenceBaseLines(advanced).map(lineId)).not.toContain(target);
  });

  it('zero favoritos na base: prompt byte a byte igual ao do catálogo sem favoritos, sem o bloco', async () => {
    const baseline = await systemPromptFor(baseConstraints); // bootstrap: isFavorite undefined
    const allFalse = await systemPromptFor(baseConstraints, catalogWithFavorites([]));

    expect(allFalse).toBe(baseline);
    expect(baseline).not.toContain(FAVORITE_BLOCK_HEADER);
    expect(baseline).not.toContain(FAVORITE_MARKER);
    // Sort estável: sem favoritos, a ordem é a MESMA de antes desta mudança — inclusive em
    // HOME, onde antes não havia sort nenhum.
    for (const c of [baseConstraints, { ...baseConstraints, location: 'HOME' as const }]) {
      expect(referenceBaseLines(await systemPromptFor(c)).map(lineId)).toEqual(
        groupedLikePrompt(legacyOrderIds(c)),
      );
    }
  });

  it('FULL_GYM: favorito é critério primário, equipamento é o segundo (revisão 2026-09-29)', async () => {
    const favorites = ['supino_reto_halter', 'roda_abdominal']; // com equip / sem equip
    const system = await systemPromptFor(baseConstraints, catalogWithFavorites(favorites));
    const blocks = referenceBaseBlocks(system);
    const rank = (id: string): number => {
      const exercise = EXERCISE_BY_ID.get(id);
      if (!exercise) throw new Error(`id fora do catálogo no prompt: ${id}`);
      return 2 * Number(favorites.includes(id)) + Number(exercise.equipment.length > 0);
    };
    // A base é apresentada por grupo muscular; DENTRO de cada bloco vale a prioridade:
    // [fav+equip] > [fav sem equip] > [equip] > [sem equip] — ordem não-crescente.
    for (const block of blocks) {
      const ranks = block.map(rank);
      expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
    }
    expect(new Set(blocks.flat().map(rank))).toEqual(new Set([3, 2, 1, 0]));
    const blockOf = (id: string): string[] => blocks.find((block) => block.includes(id)) ?? [];
    expect(blockOf('supino_reto_halter')[0]).toBe('supino_reto_halter');
    expect(blockOf('roda_abdominal')[0]).toBe('roda_abdominal');
    // Não favoritos mantêm a ordem anterior (sort estável): equipamento antes, depois o resto.
    const legacy = legacyOrderIds(baseConstraints).filter((id) => !favorites.includes(id));
    for (const block of blocks) {
      expect(block.filter((id) => !favorites.includes(id))).toEqual(
        legacy.filter((id) => block.includes(id)),
      );
    }
    // Bloco presente, depois da DURAÇÃO DO MESOCICLO e imediatamente antes da BASE.
    expect(system).toContain(`${rtFavoritePreferenceBlock()}\n\n${BASE_HEADER}`);
    expect(system.indexOf('DURAÇÃO DO MESOCICLO')).toBeLessThan(
      system.indexOf(FAVORITE_BLOCK_HEADER),
    );
  });

  it('caso do fundador: cadeira_flexora_maquina favoritada, aluno HOME + KNEE — some do prompt, sem bloco', async () => {
    // Só serve FULL_GYM e é contraindicada para KNEE: vetada por local (e por contraindicação).
    const c: UserConstraints = { ...baseConstraints, location: 'HOME', injuryTags: ['KNEE'] };
    const baseline = await systemPromptFor(c);
    const system = await systemPromptFor(c, catalogWithFavorites(['cadeira_flexora_maquina']));

    expect(system).not.toContain('cadeira_flexora_maquina');
    expect(system).not.toContain(FAVORITE_BLOCK_HEADER);
    expect(system).toBe(baseline);
  });

  it('HOME: favorito remada_invertida vira a PRIMEIRA linha, com o marcador no fim e o id intacto', async () => {
    const c: UserConstraints = { ...baseConstraints, location: 'HOME' };
    const baselineLine = referenceBaseLines(await systemPromptFor(c)).find(
      (line) => lineId(line) === 'remada_invertida',
    );
    const system = await systemPromptFor(c, catalogWithFavorites(['remada_invertida']));
    const first = referenceBaseLines(system)[0] ?? '';

    expect(lineId(first)).toBe('remada_invertida');
    expect(first.startsWith('- remada_invertida | ')).toBe(true);
    expect(first.endsWith(` | ${FAVORITE_MARKER}`)).toBe(true);
    // Resto da linha idêntico ao de antes: o marcador é só um sufixo.
    expect(first).toBe(`${baselineLine} | ${FAVORITE_MARKER}`);
    expect(system).toContain(FAVORITE_BLOCK_HEADER);
  });

  it('favorito eliminado SÓ por contraindicação (supino_reto_halter, FULL_GYM + SHOULDER) não aparece', async () => {
    const catalog = catalogWithFavorites(['supino_reto_halter']);
    // Controle: mesmo local e nível, sem a tag — aparece. Prova que local/nível não o excluem.
    const control = await systemPromptFor(baseConstraints, catalog);
    expect(referenceBaseLines(control).map(lineId)).toContain('supino_reto_halter');

    const c: UserConstraints = { ...baseConstraints, injuryTags: ['SHOULDER'] };
    const system = await systemPromptFor(c, catalog);

    expect(system).not.toContain('supino_reto_halter');
    expect(system).not.toContain(FAVORITE_BLOCK_HEADER);
    expect(system).toBe(await systemPromptFor(c));
  });

  it('o marcador aparece só nas linhas favoritadas que sobreviveram ao filtro', async () => {
    // FULL_GYM + KNEE: supino_reto_halter e roda_abdominal sobrevivem; cadeira_flexora_maquina
    // sai por KNEE; remada_invertida sai por local (não serve FULL_GYM).
    const c: UserConstraints = { ...baseConstraints, injuryTags: ['KNEE'] };
    const system = await systemPromptFor(
      c,
      catalogWithFavorites([
        'supino_reto_halter',
        'roda_abdominal',
        'cadeira_flexora_maquina',
        'remada_invertida',
      ]),
    );
    const marked = referenceBaseLines(system)
      .filter((line) => line.includes(FAVORITE_MARKER))
      .map(lineId);
    const section = system.slice(
      system.indexOf(BASE_HEADER),
      system.indexOf('SCHEMA DO JSON DE SAÍDA:'),
    );

    expect(marked.sort()).toEqual(['roda_abdominal', 'supino_reto_halter']);
    expect(section.split(FAVORITE_MARKER).length - 1).toBe(2);
  });

  it('guardrail de linguagem: o bloco não usa termos vetados e mantém a IA como ferramenta do CREF', () => {
    const block = rtFavoritePreferenceBlock();

    expect(block).not.toMatch(/diagnóstic/i);
    expect(block).not.toMatch(/tratamento/i);
    expect(block).not.toMatch(/\bcura\b/i);
    expect(block).not.toMatch(/garantid/i);
    expect(block).toContain('Você atua como ferramenta desse profissional');
  });

  it('favoriteUsage(): favoritos na base filtrada, favoritos prescritos e total de slots', () => {
    const catalog = catalogWithFavorites([
      'supino_reto_halter',
      'roda_abdominal',
      'cadeira_flexora_maquina', // vetada por KNEE: não conta como "na base"
    ]);
    const { service } = makeService([], undefined, catalog);
    const structure = {
      sessions: [
        { exercises: [{ exerciseId: 'supino_reto_halter' }, { exerciseId: 'roda_abdominal' }] },
        { exercises: [{ exerciseId: 'agachamento_barra' }, { exerciseId: 'supino_reto_halter' }] },
      ],
    } as unknown as Parameters<typeof service.favoriteUsage>[1];

    expect(service.favoriteUsage({ ...baseConstraints, injuryTags: ['KNEE'] }, structure)).toEqual({
      favoritesInBase: 2,
      favoritesPrescribed: 3,
      slots: 4,
    });
    // Sem favoritos (bootstrap, `isFavorite` undefined): tudo zero, menos os slots.
    expect(makeService([]).service.favoriteUsage(baseConstraints, structure)).toEqual({
      favoritesInBase: 0,
      favoritesPrescribed: 0,
      slots: 4,
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

describe('planejamento antes das sessões (achado 2026-10-21)', () => {
  const planning = {
    divisao: 'Upper/Lower: cada grupo 2x na semana',
    seriesSemanais: { peito: 12, costas: 12 },
    sessoes: [{ dia: 'MON', grupos: ['peito', 'costas'], minutosEstimados: 55 }],
  };
  const withPlanning = (): string =>
    JSON.stringify({ planejamento: planning, ...JSON.parse(validProtocolJson()) });

  it('o prompt pede o planejamento ANTES de sessions e o schema o declara primeiro', async () => {
    const { service, calls } = makeService([withPlanning()]);
    await service.generate(command);
    const system = calls[0]?.system ?? '';
    expect(system).toContain('PLANEJAMENTO (campo "planejamento", escrito ANTES de "sessions"');
    expect(system.indexOf('"planejamento": {')).toBeLessThan(
      system.indexOf('"goal": "GAIN_MUSCLE"'),
    );
    // o conteúdo certo (números, ordem dos grupos) é da metodologia, não do código
    expect(system).toContain('aplicando o que a metodologia diz sobre ordem');
  });

  it('extrai o planejamento do JSON: não entra no protocolo, volta no resultado', async () => {
    const { service } = makeService([withPlanning()]);
    const result = await service.generate(command);
    expect(result.planning).toEqual(planning);
    expect(JSON.stringify(result.structure)).not.toContain('planejamento');
  });

  it('sem planejamento na saída, o protocolo segue válido (campo opcional)', async () => {
    const { service } = makeService([validProtocolJson()]);
    const result = await service.generate(command);
    expect(result.planning).toBeUndefined();
  });

  it('a rodada de correção devolve o planejamento no turno do assistente', async () => {
    const { service, calls } = makeService([withPlanning(), validProtocolJson()]);
    const first = await service.generate(command);
    await service.generate({
      ...command,
      correction: {
        previous: first.structure,
        ...(first.planning ? { planning: first.planning } : {}),
        violations: [],
        round: 1,
      },
    });
    const assistant = calls[1]?.messages.find((m) => m.role === 'assistant');
    expect(assistant?.content.startsWith('{"planejamento":')).toBe(true);
  });

  it('correção de qualidade leva as medições do rascunho, como fato e não como regra', async () => {
    const { service, calls } = makeService([validProtocolJson(), validProtocolJson()]);
    const first = await service.generate(command);
    await service.generate({
      ...command,
      correction: {
        previous: first.structure,
        violations: [],
        round: 1,
        quality: {
          summary: {
            version: 'contextual-quality-2026-10-v2',
            status: 'GAPS',
            checks: [{ criterion: 'SESSION_SEQUENCING', status: 'GAP' }],
            missingEmphasisCount: 0,
          },
          review: Object.fromEntries(
            QUALITY_CRITERIA.map((criterion) => [
              criterion,
              {
                status: criterion === 'SESSION_SEQUENCING' ? 'GAP' : 'MET',
                methodologyExcerpt: METHODOLOGY_GUIDELINES.slice(0, 80).trim(),
                observation: 'Grupos intercalados.',
                adjustment: criterion === 'SESSION_SEQUENCING' ? 'Agrupe por músculo.' : null,
              },
            ]),
          ) as never,
        },
      },
    });
    const text = calls[1]?.messages.map((m) => m.content).join('\n') ?? '';
    expect(text).toContain('MEDIÇÕES DO SEU RASCUNHO (fatos calculados, não regras');
    expect(text).toContain('grupos em sequência =');
  });
});

describe('base de referência por grupo muscular (achado 2026-10-21)', () => {
  async function system(c: UserConstraints): Promise<string> {
    const { service, calls } = makeService([validProtocolJson()]);
    await service.generate({ ...command, constraints: c });
    return calls[0]?.system ?? '';
  }
  const gym: UserConstraints = {
    ...constraints,
    level: 'INTERMEDIARIO',
    injuryTags: [],
    injuriesRaw: [],
  };

  it('cada grupo tem seu bloco com a contagem, e a ênfase do aluno vem primeiro', async () => {
    const text = await system({ ...gym, emphasis: ['costas'] });
    const headings = text.split('\n').filter((line) => line.startsWith('## grupo: '));
    expect(headings[0]).toMatch(/^## grupo: costas \(\d+\)$/);
    expect(headings.length).toBeGreaterThan(5);
    expect(new Set(headings).size).toBe(headings.length);
  });

  it('cada exercício aparece uma vez e dentro do bloco do seu grupo', async () => {
    const text = await system(gym);
    let group = '';
    const seen = new Set<string>();
    for (const line of text.split('\n')) {
      if (line.startsWith('## grupo: ')) group = line.slice(10).replace(/ \(\d+\)$/, '');
      else if (line.startsWith('- ') && line.includes(' | grupos: ')) {
        const id = line.slice(2).split(' | ', 1)[0] ?? '';
        expect(seen.has(id)).toBe(false);
        seen.add(id);
        expect(EXERCISE_BY_ID.get(id)?.muscleGroups[0]).toBe(group);
      }
    }
    expect(seen.size).toBeGreaterThan(100);
  });
});

describe('dor sem veto no gerador (política de 2026-10-21)', () => {
  const knee: UserConstraints = {
    ...constraints,
    level: 'INTERMEDIARIO',
    injuryTags: ['KNEE'],
    injuriesRaw: ['Dor em Joelho (intensidade 3/10)'],
  };
  async function system(c: UserConstraints): Promise<string> {
    const { service, calls } = makeService([validProtocolJson()]);
    await service.generate({ ...command, constraints: c });
    return calls[0]?.system ?? '';
  }
  async function userMessage(c: UserConstraints): Promise<string> {
    const { service, calls } = makeService([validProtocolJson()]);
    await service.generate({ ...command, constraints: c });
    return calls[0]?.messages[0]?.content ?? '';
  }

  it('a mensagem do aluno separa o que veta do que é só cautela', async () => {
    const text = await userMessage({ ...knee, cautionTags: ['KNEE'] });
    expect(text).toContain('Restrições a evitar (tags de lesão): nenhuma');
    expect(text).toContain('Dor relatada com cautela, SEM veto');
    expect(await userMessage(knee)).toContain('Restrições a evitar (tags de lesão): KNEE');
  });

  it('como veto (sem cautionTags) o agachamento some da base, como sempre', async () => {
    const text = await system(knee);
    expect(text).not.toContain('- agachamento_barra |');
    expect(text).not.toContain('CAUTELA POR DOR RELATADA');
  });

  it('como cautela o agachamento fica na base, marcado, e o prompt explica o que fazer', async () => {
    const text = await system({ ...knee, cautionTags: ['KNEE'] });
    const line = text.split('\n').find((l) => l.startsWith('- agachamento_barra |')) ?? '';
    expect(line).toContain('| cautela: KNEE');
    expect(text).toContain('CAUTELA POR DOR RELATADA (regiões: KNEE):');
    expect(text).toContain('Não retire um padrão de movimento nem um grupo muscular');
    // guardrail de linguagem sobre o texto exato do bloco (mesmo critério do bloco de favoritos)
    expect(painCautionBlock(['KNEE'])).not.toMatch(/diagn[óo]stic|tratament|\bcura\b|garantid/i);
  });

  it('a mesma tag no PAR-Q continua vetando mesmo com cautela na dor', async () => {
    const text = await system({ ...knee, cautionTags: ['KNEE'], parqTags: ['KNEE'] });
    // parqTags entra em injuryTags na montagem real; aqui a tag de cautela já saiu de cautionTags
    // pelo `constraintsFromAnamnesis` — o teste do contexto cobre isso; a base honra cautionTags.
    expect(text).toContain('- agachamento_barra |');
  });

  it('sem exercício marcado na base, o bloco de cautela não aparece', async () => {
    const text = await system({
      ...knee,
      location: 'HOME',
      cautionTags: ['KNEE'],
      injuryTags: ['KNEE'],
    });
    const marked = text.split('\n').filter((l) => l.includes('| cautela:'));
    if (marked.length === 0) expect(text).not.toContain('CAUTELA POR DOR RELATADA');
    else expect(text).toContain('CAUTELA POR DOR RELATADA');
  });
});

describe('juiz contextual tolerante (achado 2026-10-21)', () => {
  const excerpt = METHODOLOGY_GUIDELINES.slice(0, 80).trim();
  const review = (over: Record<string, string> = {}): string => {
    const parsed = JSON.parse(reviewJson('MET', excerpt));
    for (const [criterion, value] of Object.entries(over))
      parsed[criterion].methodologyExcerpt = value;
    return JSON.stringify(parsed);
  };

  it('aceita citação com caixa, pontuação e espaço diferentes do original', async () => {
    const sloppy = excerpt.toUpperCase().replace(/ /g, '  ');
    const { service } = makeService([validProtocolJson(), review({ GOAL_STRATEGY: sloppy })]);
    const quality = await service.assessQuality(command, await service.generate(command));
    expect(quality.summary.status).toBe('PASS');
  });

  it('citação não literal faz o juiz refazer UMA vez, dizendo qual critério errou', async () => {
    const { service, calls } = makeService([
      validProtocolJson(),
      review({ SESSION_SEQUENCING: 'Paráfrase que não está na metodologia publicada.' }),
      review(),
    ]);
    const quality = await service.assessQuality(command, await service.generate(command));
    expect(quality.summary.status).toBe('PASS');
    const retry = calls[2];
    expect(retry?.messages.at(-1)?.content).toContain('SESSION_SEQUENCING');
    expect(retry?.messages.at(-1)?.content).toContain('caractere por caractere');
  });

  it('se o segundo parecer também for inválido, segue UNAVAILABLE (sem 3ª chamada)', async () => {
    const bad = review({ SESSION_SEQUENCING: 'Outra paráfrase inventada pelo juiz do teste.' });
    const { service, calls } = makeService([validProtocolJson(), bad, bad, review()]);
    const quality = await service.assessQuality(command, await service.generate(command));
    expect(quality).toEqual(qualityUnavailable('INVALID_REVIEW'));
    expect(calls).toHaveLength(3);
  });

  it('o juiz recebe as medições e o critério de sequenciamento', async () => {
    const { service, calls } = makeService([validProtocolJson(), review()]);
    await service.assessQuality(command, await service.generate(command));
    const request = calls[1];
    expect(request?.system).toContain('SESSION_SEQUENCING');
    expect(request?.system).toContain('facts.measurements');
    expect(request?.messages[1]?.content).toContain('weeklySetsByGroup');
    expect(request?.messages[1]?.content).toContain('groupSequence');
  });
});
