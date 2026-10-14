import { protocolStructureSchema } from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import {
  MODEL_OUTPUT_PROMPT_VERSION_PLACEHOLDER,
  normalizeModelOutput,
} from './model-output-normalizer';

const exercise = {
  exerciseId: 'agachamento_barra',
  name: 'Agachamento',
  sets: 3,
  reps: { min: 8, max: 12 },
  loadStrategy: 'DOUBLE_PROGRESSION',
  restSeconds: 90,
};

const cardio = {
  exerciseId: 'esteira_continua',
  name: 'Esteira',
  durationSeconds: 900,
  loadStrategy: 'BODYWEIGHT',
  restSeconds: 0,
};

function protocol(overrides: Record<string, unknown> = {}) {
  return {
    goal: 'LOSE_FAT',
    phase: 'HIPERTROFIA',
    phaseDurationWeeks: 6,
    weeklyFrequency: 1,
    sessions: [{ dayLabel: 'Dia A', focus: 'Corpo inteiro', exercises: [exercise] }],
    ...overrides,
  };
}

describe('normalizeModelOutput', () => {
  it('preenche promptVersion ausente (campo nosso, sobrescrito depois do parse)', () => {
    const result = protocolStructureSchema.safeParse(normalizeModelOutput(protocol()));
    expect(result.success).toBe(true);
    expect(result.data?.promptVersion).toBe(MODEL_OUTPUT_PROMPT_VERSION_PLACEHOLDER);
  });

  it('preserva promptVersion informado pelo modelo', () => {
    const result = normalizeModelOutput(protocol({ promptVersion: 'v1' }));
    expect(result).toMatchObject({ promptVersion: 'v1' });
  });

  it('assume sets = 1 em exercício de duração (cardio) sem sets', () => {
    const raw = protocol({
      sessions: [{ dayLabel: 'A', focus: 'F', exercises: [exercise, cardio] }],
    });
    const result = protocolStructureSchema.safeParse(normalizeModelOutput(raw));
    expect(result.success).toBe(true);
    expect(result.data?.sessions[0]?.exercises[1]?.sets).toBe(1);
  });

  it('NÃO inventa sets para exercício de repetições', () => {
    const { sets: _sets, ...withoutSets } = exercise;
    const raw = protocol({
      sessions: [{ dayLabel: 'A', focus: 'F', exercises: [withoutSets] }],
    });
    expect(protocolStructureSchema.safeParse(normalizeModelOutput(raw)).success).toBe(false);
  });

  it('corta texto livre acima do limite do schema', () => {
    const raw = protocol({
      generalNotes: 'g'.repeat(1500),
      sessions: [
        {
          dayLabel: 'd'.repeat(90),
          focus: 'f'.repeat(200),
          exercises: [{ ...exercise, name: 'n'.repeat(150), notes: 'x'.repeat(500) }],
        },
      ],
    });
    const result = protocolStructureSchema.safeParse(normalizeModelOutput(raw));
    expect(result.success).toBe(true);
    expect(result.data?.sessions[0]?.focus).toHaveLength(120);
    expect(result.data?.sessions[0]?.dayLabel).toHaveLength(60);
    expect(result.data?.sessions[0]?.exercises[0]?.notes).toHaveLength(400);
    expect(result.data?.generalNotes).toHaveLength(1000);
  });

  it('não altera o que já é válido nem muda decisão de treino', () => {
    const raw = { ...protocol({ promptVersion: 'v1' }) };
    expect(normalizeModelOutput(raw)).toEqual(raw);
  });

  it('devolve entrada que não é objeto como veio (o schema rejeita)', () => {
    expect(normalizeModelOutput('texto')).toBe('texto');
    expect(normalizeModelOutput(null)).toBeNull();
    expect(normalizeModelOutput([1])).toEqual([1]);
  });
});
