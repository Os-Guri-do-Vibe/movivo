import { describe, expect, it } from 'vitest';

import type { CycleReassessmentAnswers } from '@movivo/shared';

import type { CycleReview } from './reassessment-tasks';
import { renewalOf } from './renewal-instructions';

const answers: CycleReassessmentAnswers = {
  measurements: [],
  phase: {
    overall: 4,
    trainingLoad: 'TOO_EASY',
    foodPlanFit: 3,
    energy: 3,
    sleep: 2,
    stress: 4,
    recovery: 3,
  },
  whatWorked: 'Treino de manhã',
  whatDidNot: 'Jantar fora de casa',
  routine: {
    changed: true,
    daysPerWeek: 3,
    sessionMinutes: 45,
    notes: 'Mudei de turno',
    weekdays: ['MON', 'WED', 'FRI'],
    slot: 'EVENING',
  },
  goals: { stillTheSame: false, notes: 'Quero correr 10 km' },
  health: { newPainOrInjury: false, newCondition: false, notes: '' },
  nutrition: { difficulties: 'Pouco tempo para cozinhar', newRestrictions: '' },
  freeText: '',
};

const review: CycleReview = {
  summary: 'Ciclo consistente, com 85% das sessões feitas e carga bem tolerada pelo aluno.',
  achievements: ['85% das sessões feitas'],
  gaps: [],
  comparison: [],
  goalStatus: 'CHANGED',
  nextCycle: {
    training: {
      focus: 'Base aeróbia somada à força, rumo aos 10 km',
      volume: 'INCREASE',
      changes: ['Incluir duas corridas leves por semana'],
      includeDeloadMesocycle: false,
    },
    nutrition: {
      focus: 'Refeições práticas e boa ingestão de fibras',
      energy: 'MAINTAIN',
      healthFocus: ['ferro', 'fibras'],
      changes: [],
    },
  },
  professionalFlags: ['Sono médio baixo no ciclo'],
};

describe('renewalOf', () => {
  const renewal = renewalOf(review, answers);

  it('o briefing de treino leva foco, volume, rotina nova e objetivo novo', () => {
    expect(renewal.trainingInstruction).toContain('Base aeróbia');
    expect(renewal.trainingInstruction).toContain('aumentar o volume');
    expect(renewal.trainingInstruction).toContain('treina segunda, quarta, sexta');
    expect(renewal.trainingInstruction).toContain('O objetivo mudou: Quero correr 10 km');
    expect(renewal.trainingInstruction).toContain('Não incluir semana leve');
  });

  it('o briefing alimentar prioriza saúde e dificuldades relatadas', () => {
    expect(renewal.nutritionInstruction).toContain('ferro; fibras');
    expect(renewal.nutritionInstruction).toContain('Pouco tempo para cozinhar');
  });

  it('semana de recuperação só quando a análise pede', () => {
    const withDeload = renewalOf(
      {
        ...review,
        nextCycle: {
          ...review.nextCycle,
          training: { ...review.nextCycle.training, includeDeloadMesocycle: true },
        },
      },
      answers,
    );
    expect(withDeload.trainingInstruction).toContain('mesociclo de recuperação');
  });

  it('as notas da Fila trazem o resumo e os pontos de atenção', () => {
    expect(renewal.notes[0]).toContain('Ciclo consistente');
    expect(renewal.notes).toContain('Atenção do especialista: Sono médio baixo no ciclo');
  });
});
