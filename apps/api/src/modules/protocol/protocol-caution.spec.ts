import { describe, expect, it } from 'vitest';
import type { ProtocolStructure } from '@movivo/shared';

import { EXERCISE_BY_ID } from './exercise-catalog';
import { cautionNotices, countCautionExercises } from './protocol-caution';

const catalog = { getById: (id: string) => EXERCISE_BY_ID.get(id) };
const structure = (ids: string[]): ProtocolStructure => ({
  promptVersion: 't',
  goal: 'GAIN_MUSCLE',
  phase: 'HIPERTROFIA',
  phaseDurationWeeks: 4,
  weeklyFrequency: 1,
  sessions: [
    {
      dayLabel: 'A',
      focus: 'x',
      exercises: ids.map((exerciseId) => ({
        exerciseId,
        name: exerciseId,
        sets: 3,
        reps: { min: 8, max: 12 },
        loadStrategy: 'DOUBLE_PROGRESSION' as const,
        restSeconds: 60,
      })),
    },
  ],
});

describe('cautionNotices — avisos ao profissional sobre dor sem veto', () => {
  it('sem tags de cautela ou sem exercício que as carregue, não há aviso', () => {
    expect(cautionNotices(structure(['agachamento_barra']), undefined, catalog)).toEqual([]);
    expect(cautionNotices(structure(['agachamento_barra']), [], catalog)).toEqual([]);
    expect(cautionNotices(structure(['prancha']), ['KNEE'], catalog)).toEqual([]);
  });

  it('um aviso por região, nomeando os exercícios do rascunho que a carregam', () => {
    const [notice, ...rest] = cautionNotices(
      structure(['agachamento_barra', 'leg_press_45_maquina', 'prancha']),
      ['KNEE'],
      catalog,
    );
    expect(rest).toEqual([]);
    expect(notice).toContain('Dor relatada em joelho');
    expect(notice).toContain('Agachamento');
    expect(notice).not.toMatch(/diagn[óo]stic|tratament|cura|garantid/i);
  });
});

describe('countCautionExercises — decide a urgência de revisão', () => {
  it('conta os exercícios que carregam alguma região de cautela', () => {
    const s = structure(['agachamento_barra', 'leg_press_45_maquina', 'prancha']);
    expect(countCautionExercises(s, ['KNEE'], catalog)).toBe(2);
    expect(countCautionExercises(s, undefined, catalog)).toBe(0);
    expect(countCautionExercises(s, [], catalog)).toBe(0);
    expect(countCautionExercises(structure(['prancha']), ['KNEE'], catalog)).toBe(0);
  });
});
