import { describe, expect, it } from 'vitest';

import type { ValidationContext } from '../../core/agents/agent-task';
import {
  workoutFeedbackValidators,
  workoutReviewValidators,
  type WorkoutFeedback,
  type WorkoutFeedbackInput,
  type WorkoutReview,
  type WorkoutReviewInput,
} from './workout-feedback-tasks';

const ctx: ValidationContext = { state: {}, methodology: {} };

const input = (over: Partial<WorkoutReviewInput> = {}): WorkoutReviewInput => ({
  modality: 'STRENGTH',
  title: 'Força A',
  status: 'COMPLETED',
  rpe: 8,
  durationMinutes: 55,
  load: 440,
  enjoyment: 4,
  planned: { minutes: 55, load: 420, kind: null },
  strength: {
    exercises: [
      {
        exerciseId: 'agachamento',
        name: 'Agachamento livre',
        plannedSets: 3,
        plannedReps: '6-10',
        plannedRir: 2,
        doneSets: 3,
        repsBySet: [8, 7, 6],
        topLoadKg: 62.5,
        avgRir: 1,
        tonnageKg: 1312,
        versusRange: 'IN',
        repDropOff: 2,
        previous: { date: '2026-10-27', topLoadKg: 60, repsAtTop: 8 },
        change: 'LOAD_UP',
      },
    ],
    skippedExercises: [],
    setsPlanned: 3,
    setsDone: 3,
    setsNearFailure: 3,
    totalTonnageKg: 1312,
    previousTonnageKg: 1200,
  },
  endurance: null,
  recent: { sessions28d: 10, avgRpe28d: 7 },
  checkIn: null,
  loadMetrics: null,
  sessionComparison: null,
  ...over,
});

const review = (over: Partial<WorkoutReview> = {}): WorkoutReview => ({
  verdict: 'AS_PLANNED',
  strengths: [
    {
      focus: 'LOAD',
      statement:
        'No Agachamento livre você subiu de 60 para 62,5 kg e manteve 8 repetições na primeira série.',
    },
  ],
  attention: [],
  nextFocus:
    'Se as repetições fecharem com folga em todas as séries, vale subir um pouco na próxima.',
  recoveryNote: null,
  ...over,
});

const violationsOf = async (i: WorkoutReviewInput, o: WorkoutReview) =>
  (await Promise.all(workoutReviewValidators.map((v) => v(i, o, ctx)))).flat();

describe('workoutReviewValidators', () => {
  it('aceita a leitura específica', async () => {
    expect(await violationsOf(input(), review())).toEqual([]);
  });

  it('sessão parcial não supera o previsto', async () => {
    const violations = await violationsOf(
      input({ status: 'PARTIAL' }),
      review({ verdict: 'ABOVE_PLAN' }),
    );
    expect(violations.map((v) => v.path)).toContain('verdict');
  });
});

describe('workoutFeedbackValidators', () => {
  const feedbackInput: WorkoutFeedbackInput = {
    firstName: 'Ana',
    modality: 'STRENGTH',
    title: 'Força A',
    status: 'COMPLETED',
    review: review(),
  };
  const run = async (messages: string[]) =>
    (
      await Promise.all(
        workoutFeedbackValidators.map((v) =>
          v(feedbackInput, { messages } as WorkoutFeedback, ctx),
        ),
      )
    ).flat();

  it('aceita retorno com número, critério e tentativa de carga', async () => {
    expect(
      await run([
        'Ana, no agachamento você foi de 60 para 62,5 kg e ainda segurou 8 repetições. Isso mostra força nova.',
        'Na próxima, tenta 2 kg a mais; se as repetições caírem muito, volta à carga de hoje.',
      ]),
    ).toEqual([]);
  });

  it('recusa promessa de resultado e remédio', async () => {
    const violations = await run([
      'Ana, com isso você garante o resultado.',
      'Tome um anti-inflamatório.',
    ]);
    expect(violations.length).toBeGreaterThan(0);
  });
});
