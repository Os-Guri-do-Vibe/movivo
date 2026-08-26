import { describe, expect, it } from 'vitest';

import { protocolStructureSchema, repsRangeSchema } from './protocol.schema';

const validExercise = {
  exerciseId: 'goblet_squat',
  name: 'Agachamento goblet com halter',
  sets: 3,
  reps: { min: 8, max: 12 },
  loadStrategy: 'DOUBLE_PROGRESSION',
  restSeconds: 90,
};

/** Sessão com um exercício; `over` sobrescreve o exercício (splitType/technique da v2). */
function sessionWith(over: Record<string, unknown> = {}) {
  return {
    dayLabel: 'Dia A',
    focus: 'Corpo inteiro',
    exercises: [{ ...validExercise, ...over }],
  };
}

const validStructure = {
  promptVersion: 'methodology-2026-08-v2+catalog-2026-08-v2',
  goal: 'GAIN_MUSCLE',
  phase: 'ADAPTACAO',
  weeklyFrequency: 3,
  sessions: [sessionWith()],
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

  // Achado 2026-08-18: exercício isométrico/cardio contínuo (prancha, caminhada) é prescrito
  // por tempo, não por reps — sem essa exclusividade, o schema aceitava (e a IA era forçada a
  // inventar) um "reps" pra prancha, que o ValidationService rejeitava com razão.
  it('aceita exercício de duração no lugar de reps', () => {
    const structure = {
      ...validStructure,
      sessions: [sessionWith({ reps: undefined, durationSeconds: 40 })],
    };
    expect(protocolStructureSchema.safeParse(structure).success).toBe(true);
  });

  it('rejeita exercício sem reps nem durationSeconds', () => {
    const structure = { ...validStructure, sessions: [sessionWith({ reps: undefined })] };
    expect(protocolStructureSchema.safeParse(structure).success).toBe(false);
  });

  it('rejeita exercício com reps E durationSeconds ao mesmo tempo', () => {
    const structure = {
      ...validStructure,
      sessions: [sessionWith({ durationSeconds: 40 })],
    };
    expect(protocolStructureSchema.safeParse(structure).success).toBe(false);
  });

  it('aceita splitType e technique da metodologia v2', () => {
    const withSplit = {
      ...validStructure,
      splitType: 'PUSH_PULL_LEGS',
      sessions: [sessionWith({ technique: 'DROP_SET' })],
    };
    expect(protocolStructureSchema.safeParse(withSplit).success).toBe(true);
  });

  it('splitType e technique são opcionais (protocolos anteriores à v2 seguem válidos)', () => {
    const parsed = protocolStructureSchema.parse(validStructure);
    expect(parsed.splitType).toBeUndefined();
    expect(parsed.sessions[0]?.exercises[0]?.technique).toBeUndefined();
  });

  it('rejeita splitType e technique fora do enum', () => {
    expect(
      protocolStructureSchema.safeParse({ ...validStructure, splitType: 'ABCDEF' }).success,
    ).toBe(false);
    const badTechnique = {
      ...validStructure,
      sessions: [sessionWith({ technique: 'SUPER_SERIE' })],
    };
    expect(protocolStructureSchema.safeParse(badTechnique).success).toBe(false);
  });

  // Achado 2026-08-22 (item 8): séries de aquecimento com range próprio, aditivo à série
  // válida (`sets`/`reps` no topo do exercício, que continuam representando só as válidas).
  describe('warmupBlocks', () => {
    it('protocolo sem warmupBlocks continua válido (aditivo, sem migração)', () => {
      const parsed = protocolStructureSchema.parse(validStructure);
      expect(parsed.sessions[0]?.exercises[0]?.warmupBlocks).toBeUndefined();
    });

    it('aceita exercício com blocos de aquecimento por reps e por duração', () => {
      const structure = {
        ...validStructure,
        sessions: [
          sessionWith({
            warmupBlocks: [
              { sets: 1, reps: { min: 15, max: 15 }, restSeconds: 30 },
              { sets: 1, durationSeconds: 20 },
            ],
          }),
        ],
      };
      expect(protocolStructureSchema.safeParse(structure).success).toBe(true);
    });

    it('rejeita bloco de aquecimento com reps E durationSeconds ao mesmo tempo', () => {
      const structure = {
        ...validStructure,
        sessions: [
          sessionWith({
            warmupBlocks: [{ sets: 1, reps: { min: 10, max: 12 }, durationSeconds: 20 }],
          }),
        ],
      };
      expect(protocolStructureSchema.safeParse(structure).success).toBe(false);
    });

    it('rejeita bloco de aquecimento sem reps nem durationSeconds', () => {
      const structure = {
        ...validStructure,
        sessions: [sessionWith({ warmupBlocks: [{ sets: 1 }] })],
      };
      expect(protocolStructureSchema.safeParse(structure).success).toBe(false);
    });

    it('rejeita mais de 4 blocos de aquecimento', () => {
      const structure = {
        ...validStructure,
        sessions: [
          sessionWith({
            warmupBlocks: Array.from({ length: 5 }, () => ({
              sets: 1,
              reps: { min: 10, max: 12 },
            })),
          }),
        ],
      };
      expect(protocolStructureSchema.safeParse(structure).success).toBe(false);
    });

    it('restSeconds do bloco de aquecimento é opcional', () => {
      const structure = {
        ...validStructure,
        sessions: [sessionWith({ warmupBlocks: [{ sets: 1, reps: { min: 10, max: 12 } }] })],
      };
      expect(protocolStructureSchema.safeParse(structure).success).toBe(true);
    });
  });
});
