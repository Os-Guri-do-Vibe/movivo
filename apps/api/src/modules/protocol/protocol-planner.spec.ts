import { describe, expect, it, vi } from 'vitest';
import type { ProtocolStructure } from '@movivo/shared';

import {
  type GenerateProtocolCommand,
  type GenerateProtocolResult,
  ProtocolGenerationError,
} from './protocol-generator.service';
import {
  MAX_CORRECTION_ROUNDS,
  planProtocol,
  PROTOCOL_PIPELINE_VERSION,
  type ProtocolGenerator,
} from './protocol-planner';
import { FALLBACK_TEMPLATE_VERSION } from './validation/fallback-template';
import { VALIDATION_RULES_VERSION } from './validation/validation-rules';
import {
  ValidationService,
  type ValidationVerdict,
  type ValidationViolation,
} from './validation/validation.service';
import type { UserConstraints } from './user-constraints';

const constraints: UserConstraints = {
  goal: 'GAIN_MUSCLE',
  level: 'INICIANTE',
  trainingStatus: 'REGULAR',
  daysPerWeek: 3,
  preferredDays: ['MON', 'WED', 'FRI'],
  location: 'FULL_GYM',
  equipment: [],
  emphasis: [],
  avoid: [],
  injuryTags: [],
  injuriesRaw: [],
  requiresProfessionalReview: false,
  parqTags: [],
  parqTriggered: [],
};

function structure(tag = 'A'): ProtocolStructure {
  return {
    promptVersion: 'v1',
    goal: 'GAIN_MUSCLE',
    phase: 'ADAPTACAO',
    phaseDurationWeeks: 3,
    weeklyFrequency: 3,
    sessions: [
      {
        dayLabel: tag,
        focus: 'Corpo inteiro',
        exercises: [
          {
            exerciseId: 'goblet_squat',
            name: 'Agachamento',
            sets: 3,
            reps: { min: 8, max: 12 },
            loadStrategy: 'DOUBLE_PROGRESSION',
            restSeconds: 90,
          },
        ],
      },
    ],
  };
}

/** Protocolo REAL (ids do catálogo) que passa limpo no validador para `constraints`. */
function realStructure(technique?: 'SUPERSET'): ProtocolStructure {
  const exercises = [
    {
      exerciseId: 'agachamento_goblet',
      name: 'Agachamento Goblet',
      sets: 3,
      reps: { min: 8, max: 12 },
      loadStrategy: 'DOUBLE_PROGRESSION' as const,
      restSeconds: 60,
      ...(technique ? { technique } : {}),
    },
    {
      exerciseId: 'supino_reto_halter',
      name: 'Supino Reto (Halter)',
      sets: 3,
      reps: { min: 8, max: 12 },
      loadStrategy: 'DOUBLE_PROGRESSION' as const,
      restSeconds: 60,
      ...(technique ? { technique } : {}),
    },
  ];
  return {
    promptVersion: 'v1',
    goal: 'GAIN_MUSCLE',
    phase: 'ADAPTACAO',
    phaseDurationWeeks: 3,
    splitType: 'FULL_BODY',
    weeklyFrequency: 3,
    sessions: (['MON', 'WED', 'FRI'] as const).map((weekday, i) => ({
      dayLabel: `Treino ${i + 1}`,
      weekday,
      focus: 'Corpo inteiro',
      exercises: structuredClone(exercises),
    })),
  };
}

function genResult(over: Partial<GenerateProtocolResult> = {}): GenerateProtocolResult {
  return {
    structure: structure(),
    provider: 'OPENAI_GPT41',
    model: 'gpt-4.1',
    attempt: 1,
    costBrl: 0.01,
    promptVersion: 'methodology+catalog',
    unknownExerciseIds: [],
    ...over,
  };
}

type GenStep = GenerateProtocolResult | Error;

function fakeGenerator(steps: GenStep[]): ProtocolGenerator & {
  generate: ReturnType<typeof vi.fn>;
} {
  const queue = [...steps];
  return {
    generate: vi.fn(async (_command: GenerateProtocolCommand) => {
      const next = queue.shift() ?? genResult();
      if (next instanceof Error) throw next;
      return next;
    }),
  };
}

const violation = (rule: string, action: 'BLOCK' | 'FLAG' = 'BLOCK'): ValidationViolation => ({
  rule,
  detail: `detalhe de ${rule}`,
  action,
});

function verdictOf(
  action: ValidationVerdict['action'],
  violations: ValidationViolation[] = [],
): ValidationVerdict {
  const code = action === 'PASS' ? 'PASS' : action === 'BLOCK_FALLBACK' ? 'BLOCK' : 'FLAG';
  return { action, code, humanReviewRequired: action !== 'PASS', violations };
}

function fakeValidation(verdicts: ValidationVerdict[]): ValidationService {
  const queue = [...verdicts];
  const validate = vi.fn((): ValidationVerdict => queue.shift() ?? verdictOf('PASS'));
  return { validate, exerciseById: vi.fn(() => undefined) } as unknown as ValidationService;
}

const BLOCK_SPLIT = verdictOf('BLOCK_FALLBACK', [violation('SPLIT_LEVEL_NOT_ALLOWED')]);

const cmd = { userId: 'u1', user: {}, constraints };

// Decisão do fundador (2026-08-18): PASS/FLAG/BLOCK persistente entregam o MESMO
// `PlanResult` (sem approvalStatus/reviewUrgency — isso vive no Worker). O que varia entre
// eles é só a origem/rastreabilidade: `generatedBy`, `validationAction`,
// `usedFallbackTemplate`, `violations`, `repairs` e o rastro de tentativas.
describe('planProtocol (US-2.4)', () => {
  it('PASS limpo → origem da geração real, sem violações, 1 tentativa no rastro', async () => {
    const plan = await planProtocol(
      fakeGenerator([genResult()]),
      fakeValidation([verdictOf('PASS')]),
      cmd,
    );
    expect(plan.generatedBy).toBe('OPENAI_GPT41');
    expect(plan.modelVersion).toBe('gpt-4.1');
    expect(plan.validationAction).toBe('PASS');
    expect(plan.usedFallbackTemplate).toBe(false);
    expect(plan.violations).toEqual([]);
    expect(plan.repairs).toEqual([]);
    expect(plan.attempts).toEqual([
      { attempt: 1, kind: 'GENERATION', outcome: 'PASS', rules: [], malformedRetries: 0 },
    ]);
    expect(plan.trace).toMatchObject({
      type: 'GENERATION_TRACE',
      pipelineVersion: PROTOCOL_PIPELINE_VERSION,
      validationRulesVersion: VALIDATION_RULES_VERSION,
      corrections: 0,
      repairOutcome: 'NOT_NEEDED',
      finalAction: 'PASS',
      usedFallbackTemplate: false,
    });
  });

  // Achado 2026-08-18 (regressão real pega em E2E, não em unit): `preferredDays` nunca
  // chegava no validador de verdade. Este teste trava o repasse.
  it('repassa preferredDays pro validador (não só pro gerador)', async () => {
    const validation = fakeValidation([verdictOf('PASS')]);
    await planProtocol(fakeGenerator([genResult()]), validation, cmd);
    expect(validation.validate).toHaveBeenCalledWith(
      expect.objectContaining({
        constraints: expect.objectContaining({ preferredDays: constraints.preferredDays }),
      }),
    );
  });

  it('FLAG → mantém o conteúdo gerado (sem template), com as violações do validador', async () => {
    const plan = await planProtocol(
      fakeGenerator([genResult()]),
      fakeValidation([verdictOf('FLAG_HUMAN_REVIEW', [violation('X', 'FLAG')])]),
      cmd,
    );
    expect(plan.usedFallbackTemplate).toBe(false);
    expect(plan.generatedBy).toBe('OPENAI_GPT41');
    expect(plan.validationAction).toBe('FLAG');
  });

  describe('rodadas de correção com feedback (2026-09-29)', () => {
    it('a correção recebe o JSON anterior + as violações; limpando, usa a origem da correção', async () => {
      const first = genResult({ structure: structure('primeira') });
      const gen = fakeGenerator([first, genResult({ model: 'claude-sonnet-4-5' })]);
      const plan = await planProtocol(gen, fakeValidation([BLOCK_SPLIT, verdictOf('PASS')]), cmd);

      expect(gen.generate).toHaveBeenCalledTimes(2);
      expect(gen.generate.mock.calls[0]?.[0]).not.toHaveProperty('correction');
      expect(gen.generate.mock.calls[1]?.[0]).toMatchObject({
        userId: 'u1',
        constraints,
        correction: { previous: first.structure, violations: BLOCK_SPLIT.violations, round: 1 },
      });
      expect(plan.modelVersion).toBe('claude-sonnet-4-5');
      expect(plan.usedFallbackTemplate).toBe(false);
      expect(plan.attempts.map((a) => [a.kind, a.outcome, a.rules])).toEqual([
        ['GENERATION', 'BLOCK', ['SPLIT_LEVEL_NOT_ALLOWED']],
        ['CORRECTION', 'PASS', []],
      ]);
      expect(plan.trace.corrections).toBe(1);
    });

    it(`no máximo ${MAX_CORRECTION_ROUNDS} rodadas; a 2ª corrige a saída da 1ª correção (só o último JSON)`, async () => {
      const second = genResult({ structure: structure('segunda') });
      const gen = fakeGenerator([genResult(), second, genResult(), genResult()]);
      const plan = await planProtocol(
        gen,
        fakeValidation([BLOCK_SPLIT, BLOCK_SPLIT, BLOCK_SPLIT, BLOCK_SPLIT]),
        cmd,
      );

      expect(MAX_CORRECTION_ROUNDS).toBe(2);
      expect(gen.generate).toHaveBeenCalledTimes(1 + MAX_CORRECTION_ROUNDS);
      expect(gen.generate.mock.calls[2]?.[0].correction).toMatchObject({
        previous: second.structure,
        round: 2,
      });
      expect(plan.usedFallbackTemplate).toBe(true);
      expect(plan.generatedBy).toBe('FALLBACK_TEMPLATE');
      expect(plan.promptVersion).toBe(FALLBACK_TEMPLATE_VERSION);
      expect(plan.validationAction).toBe('BLOCK');
      expect(plan.trace.repairOutcome).toBe('NOT_ELIGIBLE');
      expect(plan.attempts).toHaveLength(3);
    });

    it('ProtocolGenerationError numa rodada de correção → segue para o fallback sem relançar', async () => {
      const gen = fakeGenerator([genResult(), new ProtocolGenerationError('malformado')]);
      const plan = await planProtocol(gen, fakeValidation([BLOCK_SPLIT]), cmd);

      expect(plan.usedFallbackTemplate).toBe(true);
      expect(gen.generate).toHaveBeenCalledTimes(2);
      expect(plan.attempts.at(-1)).toMatchObject({
        kind: 'CORRECTION',
        outcome: 'GENERATION_ERROR',
      });
      // Sem duplicar as violações da 1ª tentativa quando a correção nem gerou.
      expect(plan.violations).toEqual(BLOCK_SPLIT.violations);
    });

    it('erro de infraestrutura (não ProtocolGenerationError) numa correção continua subindo', async () => {
      const gen = fakeGenerator([genResult(), new Error('LLM indisponível')]);
      await expect(planProtocol(gen, fakeValidation([BLOCK_SPLIT]), cmd)).rejects.toThrow(
        'LLM indisponível',
      );
    });

    it('a 1ª geração mantém o contrato: ProtocolGenerationError sobe para o job', async () => {
      const gen = fakeGenerator([new ProtocolGenerationError('malformado')]);
      await expect(planProtocol(gen, fakeValidation([]), cmd)).rejects.toBeInstanceOf(
        ProtocolGenerationError,
      );
    });
  });

  describe('reparo determinístico (2026-09-29)', () => {
    const validation = new ValidationService();

    it('só depois das rodadas de correção, sobre a última saída, e sempre revalidado', async () => {
      const gen = fakeGenerator([
        genResult({ structure: realStructure('SUPERSET') }),
        genResult({ structure: realStructure('SUPERSET') }),
        genResult({ structure: realStructure('SUPERSET'), model: 'ultima' }),
      ]);
      const validate = vi.spyOn(validation, 'validate');
      const plan = await planProtocol(gen, validation, cmd);

      expect(gen.generate).toHaveBeenCalledTimes(3);
      // 3 validações das gerações + 1 revalidação do reparo.
      expect(validate).toHaveBeenCalledTimes(4);
      const revalidated = validate.mock.calls[3]?.[0].structure;
      expect(revalidated?.sessions.every((s) => s.exercises.every((e) => !e.technique))).toBe(true);
      expect(plan.usedFallbackTemplate).toBe(false);
      expect(plan.modelVersion).toBe('ultima');
      expect(plan.validationAction).toBe('PASS');
      expect(plan.repairs).toContain('STRIP_ALL_TECHNIQUES');
      expect(plan.content).toBe(revalidated);
      expect(plan.trace).toMatchObject({ repairOutcome: 'APPLIED', finalRules: [] });
      expect(plan.attempts.map((a) => a.rules)).toEqual([
        ['TECHNIQUE_LEVEL_NOT_ALLOWED', 'TECHNIQUE_OVERUSE'],
        ['TECHNIQUE_LEVEL_NOT_ALLOWED', 'TECHNIQUE_OVERUSE'],
        ['TECHNIQUE_LEVEL_NOT_ALLOWED', 'TECHNIQUE_OVERUSE'],
      ]);
      // Ids/séries/reps intactos.
      expect(plan.content.sessions[0]?.exercises.map((e) => [e.exerciseId, e.sets])).toEqual([
        ['agachamento_goblet', 3],
        ['supino_reto_halter', 3],
      ]);
      validate.mockRestore();
    });

    it('revalidação ainda BLOCK → fallback, com o motivo no rastro', async () => {
      const fake = fakeValidation([
        verdictOf('BLOCK_FALLBACK', [violation('PHASE_DURATION_OUT_OF_RANGE')]),
        verdictOf('BLOCK_FALLBACK', [violation('PHASE_DURATION_OUT_OF_RANGE')]),
        verdictOf('BLOCK_FALLBACK', [violation('PHASE_DURATION_OUT_OF_RANGE')]),
        verdictOf('BLOCK_FALLBACK', [violation('EXERCISE_UNKNOWN')]), // revalidação
      ]);
      const plan = await planProtocol(fakeGenerator([]), fake, cmd);
      expect(fake.validate).toHaveBeenCalledTimes(4);
      expect(plan.usedFallbackTemplate).toBe(true);
      expect(plan.repairs).toEqual([]);
      expect(plan.trace).toMatchObject({
        repairOutcome: 'REJECTED_BY_REVALIDATION',
        finalRules: ['EXERCISE_UNKNOWN'],
      });
    });

    it('violação de segurança não reparável → nem tenta reparar, vai ao template', async () => {
      const fake = fakeValidation([
        verdictOf('BLOCK_FALLBACK', [violation('EXERCISE_CONTRAINDICATED')]),
        verdictOf('BLOCK_FALLBACK', [violation('EXERCISE_CONTRAINDICATED')]),
        verdictOf('BLOCK_FALLBACK', [
          violation('EXERCISE_CONTRAINDICATED'),
          violation('TECHNIQUE_OVERUSE'),
        ]),
      ]);
      const plan = await planProtocol(fakeGenerator([]), fake, cmd);
      expect(fake.validate).toHaveBeenCalledTimes(3);
      expect(plan.usedFallbackTemplate).toBe(true);
      expect(plan.trace.repairOutcome).toBe('NOT_ELIGIBLE');
    });
  });

  it('loga protocol.plan.attempt por tentativa (só códigos) e protocol.plan.summary no fim', async () => {
    const logger = { info: vi.fn() };
    await planProtocol(
      fakeGenerator([genResult({ malformedRetries: 1 }), genResult()]),
      fakeValidation([BLOCK_SPLIT, verdictOf('PASS')]),
      cmd,
      logger,
    );

    const events = logger.info.mock.calls.map(([obj]) => (obj as { event: string }).event);
    expect(events).toEqual([
      'protocol.plan.attempt',
      'protocol.plan.attempt',
      'protocol.plan.summary',
    ]);
    const summary = logger.info.mock.calls.at(-1)?.[0];
    expect(summary).toMatchObject({
      userId: 'u1',
      attempts: 2,
      corrections: 1,
      malformedRetries: 1,
      deterministicRepairs: [],
      firstAttemptRules: ['SPLIT_LEVEL_NOT_ALLOWED'],
      finalRules: [],
      finalAction: 'PASS',
      usedFallbackTemplate: false,
      promptVersion: 'methodology+catalog',
      validationRulesVersion: VALIDATION_RULES_VERSION,
    });
    expect(typeof (summary as { durationMs: unknown }).durationMs).toBe('number');
    // Nunca o `detail` (pode descrever texto livre).
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('detalhe de');
  });
});
