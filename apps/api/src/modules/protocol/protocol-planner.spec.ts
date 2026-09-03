import { describe, expect, it, vi } from 'vitest';
import type { ProtocolStructure } from '@movivo/shared';

import type { GenerateProtocolResult } from './protocol-generator.service';
import { planProtocol, type ProtocolGenerator } from './protocol-planner';
import { FALLBACK_TEMPLATE_VERSION } from './validation/fallback-template';
import type { ValidationService } from './validation/validation.service';
import type { ValidationVerdict } from './validation/validation.service';
import type { UserConstraints } from './user-constraints';

const constraints: UserConstraints = {
  goal: 'GAIN_MUSCLE',
  level: 'INICIANTE',
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

function structure(): ProtocolStructure {
  return {
    promptVersion: 'v1',
    goal: 'GAIN_MUSCLE',
    phase: 'ADAPTACAO',
    phaseDurationWeeks: 3,
    weeklyFrequency: 3,
    sessions: [
      {
        dayLabel: 'A',
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

function fakeGenerator(results: GenerateProtocolResult[]): ProtocolGenerator {
  const queue = [...results];
  return { generate: vi.fn(async () => queue.shift() ?? genResult()) };
}

function fakeValidation(verdicts: ValidationVerdict['action'][]): ValidationService {
  const queue = [...verdicts];
  const validate = vi.fn((): ValidationVerdict => {
    const action = queue.shift() ?? 'PASS';
    const code = action === 'PASS' ? 'PASS' : action === 'BLOCK_FALLBACK' ? 'BLOCK' : 'FLAG';
    return { action, code, humanReviewRequired: action !== 'PASS', violations: [] };
  });
  return { validate } as unknown as ValidationService;
}

const cmd = { userId: 'u1', user: {}, constraints };

// Decisão do fundador (2026-08-18): PASS/FLAG/BLOCK persistente entregam o MESMO
// `PlanResult` (sem approvalStatus/autoApproved/humanReviewRequired/reviewUrgency —
// isso é constante pra todo mundo agora e vive no Worker, não no planner). O que varia
// entre os três é só a origem/rastreabilidade: `generatedBy`, `validationAction`,
// `usedFallbackTemplate`, `violations`.
describe('planProtocol (US-2.4)', () => {
  it('PASS limpo → origem da geração real, sem violações', async () => {
    const plan = await planProtocol(fakeGenerator([genResult()]), fakeValidation(['PASS']), cmd);
    expect(plan.generatedBy).toBe('OPENAI_GPT41');
    expect(plan.modelVersion).toBe('gpt-4.1');
    expect(plan.validationAction).toBe('PASS');
    expect(plan.usedFallbackTemplate).toBe(false);
    expect(plan.violations).toEqual([]);
  });

  // Achado 2026-08-18 (regressão real pega em E2E, não em unit): o `constraints` local
  // do planner era construído SÓ com goal/injuryTags/level — `preferredDays` nunca
  // chegava no validador de verdade, mesmo com o gerador recebendo o campo certo. A
  // regra de sessão-por-dia nunca disparava fora dos testes que chamam `validate()`
  // direto. Este teste trava o repasse pra nunca regredir silenciosamente de novo.
  it('repassa preferredDays pro validador (não só pro gerador)', async () => {
    const validation = fakeValidation(['PASS']);
    await planProtocol(fakeGenerator([genResult()]), validation, cmd);
    expect(validation.validate).toHaveBeenCalledWith(
      expect.objectContaining({
        constraints: expect.objectContaining({ preferredDays: constraints.preferredDays }),
      }),
    );
  });

  it('BLOCK → regenera e, se limpar na 2ª tentativa, usa a origem da regeração', async () => {
    const gen = fakeGenerator([genResult(), genResult({ model: 'claude-sonnet-4-5' })]);
    const plan = await planProtocol(gen, fakeValidation(['BLOCK_FALLBACK', 'PASS']), cmd);
    expect(plan.modelVersion).toBe('claude-sonnet-4-5');
    expect(plan.usedFallbackTemplate).toBe(false);
    expect(gen.generate).toHaveBeenCalledTimes(2);
  });

  it('BLOCK persistente (2 tentativas) → cai no template pré-aprovado do RT', async () => {
    const plan = await planProtocol(
      fakeGenerator([genResult(), genResult()]),
      fakeValidation(['BLOCK_FALLBACK', 'BLOCK_FALLBACK']),
      cmd,
    );
    expect(plan.usedFallbackTemplate).toBe(true);
    expect(plan.generatedBy).toBe('FALLBACK_TEMPLATE');
    expect(plan.promptVersion).toBe(FALLBACK_TEMPLATE_VERSION);
    expect(plan.validationAction).toBe('BLOCK');
  });

  it('FLAG → mantém o conteúdo gerado (sem template), com as violações do validador', async () => {
    const plan = await planProtocol(
      fakeGenerator([genResult()]),
      fakeValidation(['FLAG_HUMAN_REVIEW']),
      cmd,
    );
    expect(plan.usedFallbackTemplate).toBe(false);
    expect(plan.generatedBy).toBe('OPENAI_GPT41');
    expect(plan.validationAction).toBe('FLAG');
  });
});
