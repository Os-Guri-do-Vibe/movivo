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
  location: 'BOTH',
  equipment: [],
  injuryTags: [],
  injuriesRaw: [],
};

function structure(): ProtocolStructure {
  return {
    promptVersion: 'v1',
    goal: 'GAIN_MUSCLE',
    phase: 'ADAPTACAO',
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

describe('planProtocol (US-2.4)', () => {
  it('PASS limpo → AUTO_APPROVED com a origem da geração', async () => {
    const plan = await planProtocol(fakeGenerator([genResult()]), fakeValidation(['PASS']), cmd);
    expect(plan.autoApproved).toBe(true);
    expect(plan.approvalStatus).toBe('AUTO_APPROVED');
    expect(plan.humanReviewRequired).toBe(false);
    expect(plan.generatedBy).toBe('OPENAI_GPT41');
    expect(plan.modelVersion).toBe('gpt-4.1');
    expect(plan.usedFallbackTemplate).toBe(false);
  });

  it('BLOCK → regenera e, se limpar, AUTO_APPROVED (fallback de modelo)', async () => {
    const gen = fakeGenerator([genResult(), genResult({ model: 'claude-sonnet-4-5' })]);
    const plan = await planProtocol(gen, fakeValidation(['BLOCK_FALLBACK', 'PASS']), cmd);
    expect(plan.autoApproved).toBe(true);
    expect(plan.modelVersion).toBe('claude-sonnet-4-5');
    expect(gen.generate).toHaveBeenCalledTimes(2);
  });

  it('BLOCK persistente → template pré-aprovado + PENDING_REVIEW + revisão humana', async () => {
    const plan = await planProtocol(
      fakeGenerator([genResult(), genResult()]),
      fakeValidation(['BLOCK_FALLBACK', 'BLOCK_FALLBACK']),
      cmd,
    );
    expect(plan.autoApproved).toBe(false);
    expect(plan.approvalStatus).toBe('PENDING_REVIEW');
    expect(plan.humanReviewRequired).toBe(true);
    expect(plan.usedFallbackTemplate).toBe(true);
    expect(plan.generatedBy).toBe('FALLBACK_TEMPLATE');
    expect(plan.promptVersion).toBe(FALLBACK_TEMPLATE_VERSION);
  });

  it('FLAG → PENDING_REVIEW mantendo o conteúdo gerado (sem template)', async () => {
    const plan = await planProtocol(
      fakeGenerator([genResult()]),
      fakeValidation(['FLAG_HUMAN_REVIEW']),
      cmd,
    );
    expect(plan.autoApproved).toBe(false);
    expect(plan.approvalStatus).toBe('PENDING_REVIEW');
    expect(plan.usedFallbackTemplate).toBe(false);
    expect(plan.generatedBy).toBe('OPENAI_GPT41');
  });
});
