import { describe, expect, it } from 'vitest';

import {
  declaredFoodPreferences,
  mergeFoodPreferences,
} from '../nutrition/food-candidates.service';
import { foodPreferenceKey, setLabel, unsupportedMessage } from './record-update.service';
import {
  numbersMentioned,
  recordUpdateCases,
  recordUpdateTask,
  recordUpdateValidators,
  type RecordUpdateInput,
  type RecordUpdateOutput,
} from './record-update-task';
import { classifyTask } from './tasks';

const input = (message: string): RecordUpdateInput => ({
  message,
  today: '2026-11-11',
  workouts: [
    {
      ref: 'T1',
      date: '2026-11-10',
      title: 'Treino A',
      modality: 'STRENGTH',
      rpe: 7,
      durationMinutes: 55,
      exercises: [
        {
          exerciseId: 'supino_reto_barra',
          name: 'Supino reto com barra',
          sets: [
            { setNumber: 1, reps: 10, loadKg: 30, rir: 2 },
            { setNumber: 2, reps: 10, loadKg: 30, rir: 2 },
            { setNumber: 3, reps: 8, loadKg: 30, rir: 1 },
          ],
        },
      ],
    },
  ],
  dailyCheckIns: [],
  weights: [{ ref: 'P1', date: '2026-11-08', kg: 85 }],
  profile: null,
  foodPreferences: [],
  knownExercises: [{ exerciseId: 'supino_reto_barra', name: 'Supino reto com barra' }],
});

const output = (
  operations: RecordUpdateOutput['operations'],
  rest: Partial<RecordUpdateOutput> = {},
): RecordUpdateOutput => ({ operations, clarification: null, unsupported: null, ...rest });

const violationsOf = async (given: RecordUpdateInput, out: RecordUpdateOutput) =>
  (await Promise.all(recordUpdateValidators.map((v) => v(given, out, {} as never)))).flat();

const setOp = (over: object = {}) =>
  ({
    type: 'WORKOUT_SET',
    workoutRef: 'T1',
    exerciseId: 'supino_reto_barra',
    setNumber: 3,
    loadKg: 40,
    ...over,
  }) as RecordUpdateOutput['operations'][number];

describe('conversation.plan_record_update · validadores', () => {
  const message = 'marquei errado a última série do supino, ao invés de 30 kg foram 40';

  it('aceita a correção de carga que o aluno escreveu', async () => {
    expect(await violationsOf(input(message), output([setOp()]))).toEqual([]);
  });

  it('recusa valor que não está na mensagem: o agente não deduz carga', async () => {
    const found = await violationsOf(input(message), output([setOp({ loadKg: 42.5 })]));
    expect(found.some((v) => v.message.includes('não está escrito na mensagem'))).toBe(true);
  });

  it('lê decimal com vírgula ou ponto', () => {
    expect(numbersMentioned('foram 42,5 kg e 8 repetições, não 40.5')).toEqual([42.5, 8, 40.5]);
  });

  it('recusa treino, exercício ou série que não existem no retrato', async () => {
    const paths = async (op: object) =>
      (await violationsOf(input(message), output([setOp(op)]))).map((v) => v.path);
    expect(await paths({ workoutRef: 'T9' })).toContain('operations.0.workoutRef');
    expect(await paths({ exerciseId: 'agachamento' })).toContain('operations.0.exerciseId');
    expect(await paths({ setNumber: 7 })).toContain('operations.0.setNumber');
    // A série seguinte à última pode ser acrescentada ("esqueci de marcar a quarta").
    expect(await paths({ setNumber: 4 })).toEqual([]);
  });

  it('recusa operação vazia e saída sem nada', async () => {
    expect(
      (await violationsOf(input(message), output([setOp({ loadKg: null })]))).length,
    ).toBeGreaterThan(0);
    expect((await violationsOf(input(message), output([]))).length).toBe(1);
    expect(
      await violationsOf(input(message), output([], { clarification: 'Qual série foi?' })),
    ).toEqual([]);
  });

  it('peso, check-in e gosto de exercício só apontam para o que existe', async () => {
    const weight = (weightRef: string | null) =>
      violationsOf(input('meu peso é 82, não 85'), output([{ type: 'WEIGHT', weightRef, kg: 82 }]));
    expect(await weight('P1')).toEqual([]);
    expect(await weight(null)).toEqual([]);
    expect((await weight('P7')).map((v) => v.path)).toEqual(['operations.0.weightRef']);

    const checkIn = (date: string) =>
      violationsOf(
        input('dormi bem, pode por sono 5'),
        output([{ type: 'DAILY_CHECKIN', date, sleep: 5 }]),
      );
    expect(await checkIn('2026-11-10')).toEqual([]);
    expect((await checkIn('2026-10-01')).length).toBe(1);
    expect((await checkIn('2026-11-12')).length).toBe(1);

    expect(
      (
        await violationsOf(
          input('odeio burpee'),
          output([{ type: 'EXERCISE_PREFERENCE', exerciseId: 'burpee', value: 'DISLIKES' }]),
        )
      ).map((v) => v.path),
    ).toEqual(['operations.0.exerciseId']);
  });

  it('os casos de avaliação têm entrada válida e os de segurança estão marcados', () => {
    for (const evalCase of recordUpdateCases) {
      expect(recordUpdateTask.input.safeParse(evalCase.input).success, evalCase.id).toBe(true);
    }
    expect(recordUpdateCases.filter((c) => c.safetyCritical).map((c) => c.id)).toEqual([
      'sem-valor-nao-deduz',
      'saude-nao-e-alterada-aqui',
    ]);
  });

  it('a regra deixa saúde de fora e a recepção sabe encaminhar o pedido', () => {
    expect(recordUpdateTask.instructions).toMatch(/NUNCA são alterados aqui/);
    expect(classifyTask.instructions).toMatch(/RECORD_UPDATE: pede EXPLICITAMENTE/);
    expect(classifyTask.input.safeParse({ message: 'oi', todayWeekday: 'WED' }).success).toBe(true);
  });
});

describe('atualização de registros · textos e preferências', () => {
  it('mostra o antes e o depois de uma série', () => {
    expect(setLabel({ loadKg: 30, reps: 8 })).toBe('30 kg × 8 repetições');
    expect(setLabel({ loadKg: 42.5, reps: null })).toBe('42,5 kg');
    expect(setLabel({ loadKg: null, reps: null })).toBe('sem registro');
  });

  it('a chave da preferência de comida é estável', () => {
    expect(foodPreferenceKey('Pão Integral')).toBe('food:pao_integral');
    expect(foodPreferenceKey(' brócolis ')).toBe('food:brocolis');
  });

  it('o que o chat não altera vai para a equipe, e o aluno fica sabendo', () => {
    expect(unsupportedMessage('o seu objetivo')).toMatch(/passei o seu pedido para a equipe/);
  });

  it('o que o aluno declara no chat entra no filtro do cardápio e vence a anamnese', () => {
    const declared = declaredFoodPreferences([
      { domain: 'FOOD', key: 'food:peixe', value: 'DISLIKES' },
      { domain: 'FOOD', key: 'food:figado', value: 'LIKES' },
      { domain: 'FOOD', key: 'meals_per_day', value: 4 },
      { domain: 'EXERCISE', key: 'exercise:burpee', value: 'DISLIKES' },
    ]);
    expect(declared).toEqual({ liked: ['figado'], disliked: ['peixe'] });
    expect(
      mergeFoodPreferences({ liked: 'frango, peixe e ovos', disliked: 'fígado, jiló' }, declared),
    ).toEqual({ likedFoods: 'frango, ovos, figado', dislikedFoods: 'jiló, peixe' });
    expect(
      mergeFoodPreferences({ liked: null, disliked: null }, { liked: [], disliked: [] }),
    ).toEqual({ likedFoods: null, dislikedFoods: null });
  });
});
