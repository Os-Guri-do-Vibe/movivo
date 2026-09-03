import { describe, expect, it } from 'vitest';
import type { ProtocolStructure } from '@movivo/shared';

import { EXERCISE_BY_ID } from './exercise-catalog';
import { applySubstitution, collectProtocolExercises } from './protocol-substitution-apply';

function structure(over: Partial<ProtocolStructure> = {}): ProtocolStructure {
  return {
    promptVersion: 'test',
    goal: 'GAIN_MUSCLE',
    phase: 'ADAPTACAO',
    phaseDurationWeeks: 3,
    weeklyFrequency: 2,
    sessions: [
      {
        dayLabel: 'Dia A',
        focus: 'Peito',
        exercises: [
          {
            exerciseId: 'flexao',
            name: 'Flexão',
            sets: 3,
            reps: { min: 8, max: 12 },
            loadStrategy: 'BODYWEIGHT',
            restSeconds: 60,
          },
        ],
      },
      {
        dayLabel: 'Dia B',
        focus: 'Peito e pernas',
        exercises: [
          {
            exerciseId: 'flexao',
            name: 'Flexão',
            sets: 4,
            reps: { min: 10, max: 15 },
            loadStrategy: 'BODYWEIGHT',
            restSeconds: 45,
          },
          {
            exerciseId: 'agachamento_peso_corporal',
            name: 'Agachamento (Peso Corporal)',
            sets: 3,
            reps: { min: 10, max: 15 },
            loadStrategy: 'BODYWEIGHT',
            restSeconds: 60,
          },
        ],
      },
    ],
    ...over,
  };
}

describe('collectProtocolExercises', () => {
  it('lista exercícios distintos por exerciseId, na ordem em que aparecem', () => {
    const refs = collectProtocolExercises(structure());
    expect(refs).toEqual([
      { id: 'flexao', name: 'Flexão' },
      { id: 'agachamento_peso_corporal', name: 'Agachamento (Peso Corporal)' },
    ]);
  });
});

describe('applySubstitution', () => {
  it('substitui TODAS as ocorrências do exercício-alvo, em toda sessão da semana', () => {
    const substitute = EXERCISE_BY_ID.get('flexao_diamante');
    if (!substitute) throw new Error('fixture: "flexao_diamante" ausente do catálogo');

    const result = applySubstitution(structure(), 'flexao', substitute);

    expect(result.sessionsAffected).toEqual(['Dia A', 'Dia B']);
    const idsInContent = result.content.sessions.flatMap((s) =>
      s.exercises.map((e) => e.exerciseId),
    );
    expect(idsInContent).not.toContain('flexao');
    expect(idsInContent.filter((id) => id === substitute.id)).toHaveLength(2);
    // Não mexe no que não é o alvo.
    expect(
      result.content.sessions[1]?.exercises.find(
        (e) => e.exerciseId === 'agachamento_peso_corporal',
      ),
    ).toBeDefined();
  });

  it('preserva volume/descanso/RIR/técnica do exercício original ao trocar', () => {
    const substitute = EXERCISE_BY_ID.get('flexao_diamante');
    if (!substitute) throw new Error('fixture');
    const result = applySubstitution(structure(), 'flexao', substitute);
    const swapped = result.content.sessions[0]?.exercises[0];
    expect(swapped).toMatchObject({ sets: 3, reps: { min: 8, max: 12 }, restSeconds: 60 });
  });

  it('sessão sem o exercício-alvo não entra em `sessionsAffected` e fica intacta', () => {
    const substitute = EXERCISE_BY_ID.get('flexao_diamante');
    if (!substitute) throw new Error('fixture');
    const onlyDayB = structure({
      sessions: [
        {
          dayLabel: 'Dia Único',
          focus: 'Pernas',
          exercises: [
            {
              exerciseId: 'agachamento_peso_corporal',
              name: 'Agachamento (Peso Corporal)',
              sets: 3,
              reps: { min: 10, max: 15 },
              loadStrategy: 'BODYWEIGHT',
              restSeconds: 60,
            },
          ],
        },
      ],
    });
    const result = applySubstitution(onlyDayB, 'flexao', substitute);
    expect(result.sessionsAffected).toEqual([]);
    expect(result.content).toEqual(onlyDayB);
  });

  it('troca para um exercício de medida DURATION reescreve reps→durationSeconds', () => {
    const duration = EXERCISE_BY_ID.get('prancha');
    if (!duration) throw new Error('fixture: "prancha" ausente do catálogo');
    expect(duration.measurement).toBe('DURATION');
    const result = applySubstitution(structure(), 'flexao', duration);
    const swapped = result.content.sessions[0]?.exercises[0];
    expect(swapped?.reps).toBeUndefined();
    expect(swapped?.durationSeconds).toBeDefined();
  });
});
