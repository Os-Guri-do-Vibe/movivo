import { describe, expect, it } from 'vitest';

import { protocolStructureSchema, repsRangeSchema } from './protocol.schema';

const validStructure = {
  promptVersion: 'methodology-2026-07-draft-v1+catalog-2026-07-draft-v1',
  goal: 'GAIN_MUSCLE',
  phase: 'ADAPTACAO',
  weeklyFrequency: 3,
  sessions: [
    {
      dayLabel: 'Dia A',
      focus: 'Corpo inteiro',
      exercises: [
        {
          exerciseId: 'goblet_squat',
          name: 'Agachamento goblet com halter',
          sets: 3,
          reps: { min: 8, max: 12 },
          loadStrategy: 'DOUBLE_PROGRESSION',
          restSeconds: 90,
        },
      ],
    },
  ],
};

describe('protocolStructureSchema', () => {
  it('aceita um protocolo bem-formado', () => {
    expect(protocolStructureSchema.safeParse(validStructure).success).toBe(true);
  });

  it('rejeita repsRange com min maior que max', () => {
    expect(repsRangeSchema.safeParse({ min: 12, max: 8 }).success).toBe(false);
  });

  it('rejeita fase fora do enum', () => {
    const bad = { ...validStructure, phase: 'BULKING' };
    expect(protocolStructureSchema.safeParse(bad).success).toBe(false);
  });

  it('rejeita sessão sem exercícios', () => {
    const bad = { ...validStructure, sessions: [{ dayLabel: 'A', focus: 'x', exercises: [] }] };
    expect(protocolStructureSchema.safeParse(bad).success).toBe(false);
  });

  it('rejeita frequência semanal fora de 1..7', () => {
    expect(
      protocolStructureSchema.safeParse({ ...validStructure, weeklyFrequency: 9 }).success,
    ).toBe(false);
  });
});
