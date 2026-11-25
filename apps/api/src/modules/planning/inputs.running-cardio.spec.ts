import { describe, expect, it } from 'vitest';

import type { ModalityExperience } from '@movivo/shared';

import { runningRules } from './calc/params';
import { devMethodologyParameters } from '../../core/database/seed-methodology';
import { EVAL_TODAY, persona, view } from './cases/personas';
import { runningInputOf, selectCardioCandidates, strengthInputOf } from './inputs';

const strength: ModalityExperience = {
  modality: 'STRENGTH',
  level: 'ADVANCED',
  monthsPracticing: 60,
  wantsToStart: false,
  venue: 'FULL_GYM',
};
const running = (over: Partial<ModalityExperience> = {}): ModalityExperience => ({
  modality: 'RUNNING',
  level: 'BEGINNER',
  wantsToStart: false,
  weeklyKm: 9,
  recent5kSeconds: 2_571,
  venue: 'FULL_GYM',
  ...over,
});

const windowOf = (weekday: 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT', maxMinutes: number) => ({
  weekday,
  slot: 'EVENING' as const,
  maxMinutes,
});

/** O aluno do relato: emagrecer, hipertrofia e correr melhor, na academia, `minutes` min por dia. */
const rodrigo = (
  modalities: ModalityExperience[],
  secondary = ['HYPERTROPHY', 'RUNNING_PERFORMANCE'],
  minutes = 45,
) =>
  view(
    persona({
      id: 'p90',
      age: 34,
      sex: 'MALE',
      heightCm: 178,
      weightKg: 90,
      goal: { primary: 'FAT_LOSS', secondary: secondary as never, emphasis: 'AESTHETICS' },
      modalities,
      venues: ['FULL_GYM'],
      windows: [
        windowOf('MON', minutes),
        windowOf('TUE', minutes),
        windowOf('WED', minutes),
        windowOf('FRI', minutes),
        windowOf('SAT', minutes),
      ],
      maxSessionsPerWeek: 5,
    }),
  );

const RUNNING_PARAMS = devMethodologyParameters('RUNNING');

describe('treino de corrida estruturado', () => {
  const input = () =>
    runningInputOf(rodrigo([strength, running()]), {
      sessions: 3,
      priority: 2,
      today: EVAL_TODAY,
      params: RUNNING_PARAMS,
    });

  it('correr melhor como objetivo secundário também é desempenho, não "complemento"', () => {
    expect(input()?.goal).toBe('PERFORMANCE');
    const semDesempenho = runningInputOf(rodrigo([strength, running()], ['HYPERTROPHY']), {
      sessions: 3,
      priority: 2,
      today: EVAL_TODAY,
      params: RUNNING_PARAMS,
    });
    expect(semDesempenho?.goal).toBe('FITNESS');
  });

  it('a semana tem qualidade, longão e base, e o iniciante começa na base aeróbia', () => {
    const result = input();
    expect(result?.phase).toBe('BASE');
    expect(result?.starter).toBe(false);
    expect(result?.weekRoles).toEqual(['QUALITY', 'LONG', 'EASY']);
    expect(
      runningRules(RUNNING_PARAMS, 'BEGINNER').qualitySessionsPerWeekMax,
    ).toBeGreaterThanOrEqual(1);
  });

  it('o catálogo elegível respeita nível, fase, local e a falta de prova', () => {
    const types = (input()?.workouts ?? []).map((w) => w.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'FARTLEK',
        'HILL_REPEATS',
        'STRIDES',
        'LONG_RUN',
        'EASY_RUN',
        'AEROBIC_INTERVALS',
      ]),
    );
    // Esteira (academia) entra; trilha e areia, que pedem rua, não.
    expect(types).toContain('TREADMILL_RUN');
    expect(types).not.toContain('TRAIL_RUN');
    expect(types).not.toContain('SAND_RUN');
    expect(types).not.toContain('DOWNHILL_RUN');
    // Nível e fase: nada de VO₂máx, velocidade máxima ou treino de prova para o iniciante na base.
    for (const blocked of [
      'VO2MAX_INTERVALS',
      'TOP_SPEED',
      'REPETITION_TRAINING',
      'LACTATE_THRESHOLD',
    ]) {
      expect(types).not.toContain(blocked);
    }
    // Sem prova marcada, nada de ritmo de prova nem simulado.
    for (const blocked of ['RACE_SIMULATION', 'RACE_PACE_RUN', 'RACE_PACE_REPEATS']) {
      expect(types).not.toContain(blocked);
    }
    // Treino de HYROX é do bloco de HYROX.
    expect(types).not.toContain('HYROX_TRANSITION');
  });

  it('quem já corre bem entra na fase de construção e ganha limiar e intervalado', () => {
    const result = runningInputOf(
      rodrigo([strength, running({ level: 'INTERMEDIATE', weeklyKm: 30 })]),
      { sessions: 4, priority: 2, today: EVAL_TODAY, params: RUNNING_PARAMS },
    );
    expect(result?.phase).toBe('BUILD');
    const types = (result?.workouts ?? []).map((w) => w.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'TEMPO_RUN',
        'LACTATE_THRESHOLD',
        'CRUISE_INTERVALS',
        'VO2MAX_INTERVALS',
      ]),
    );
  });

  it('quem está começando a correr faz só base aeróbia, sem treino intenso', () => {
    const result = runningInputOf(rodrigo([strength, running({ weeklyKm: 0 })]), {
      sessions: 3,
      priority: 2,
      today: EVAL_TODAY,
      params: RUNNING_PARAMS,
    });
    expect(result?.starter).toBe(true);
    expect(result?.weekRoles).toEqual(['EASY', 'EASY', 'LONG']);
    expect((result?.workouts ?? []).every((w) => w.intensity !== 'HARD')).toBe(true);
  });
});

describe('cardio da musculação (OMS)', () => {
  it('usa os exercícios de cardio já cadastrados, sem corrida, natação ou esportes', () => {
    const ids = selectCardioCandidates(rodrigo([strength]), 'INTERMEDIATE').map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['esteira', 'eliptico', 'bicicleta_horizontal']));
    expect(ids.some((id) => id.startsWith('simulador_de_escadas'))).toBe(true);
    for (const outro of ['corrida', 'natacao', 'boxe', 'escalada', 'empurrar_o_treno']) {
      expect(ids).not.toContain(outro);
    }
  });

  it('iniciante só recebe cardio moderado', () => {
    const candidates = selectCardioCandidates(rodrigo([strength]), 'BEGINNER');
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => c.intensity === 'MODERATE')).toBe(true);
  });

  const options = { sessions: 2, priority: 1, strengthIsPrimary: false };

  it('desconta a corrida da meta e reparte o resto nas sessões de musculação', () => {
    const input = strengthInputOf(
      rodrigo([strength, running()], undefined, 60),
      devMethodologyParameters('STRENGTH'),
      {
        ...options,
        catalog: undefined,
        otherCardio: { runningSessions: 3, externalMinutesPerWeek: 0 },
      },
    );
    // Perder gordura: meta de 200 min/semana; 3 corridas de 40 min cobrem 120; faltam 80.
    expect(input?.cardio).toMatchObject({
      targetMinutes: 200,
      coveredMinutes: 120,
      // 60 min por sessão: 40 ficam para a força, então cabem 20 min de cardio por sessão.
      weeklyMinutes: 40,
      perSessionMinutes: { min: 10, max: 20 },
      leftoverMinutes: 40,
    });
    expect(input?.cardio?.candidates.length).toBeGreaterThan(0);
  });

  it('só musculação: o cardio da semana é prescrito e o que não cabe vira caminhada diária', () => {
    const input = strengthInputOf(
      rodrigo([strength], ['HYPERTROPHY'], 60),
      devMethodologyParameters('STRENGTH'),
      options,
    );
    expect(input?.cardio).toMatchObject({
      targetMinutes: 200,
      coveredMinutes: 0,
      weeklyMinutes: 40,
    });
    expect(input?.cardio?.leftoverMinutes).toBe(160);
    expect(input?.dailyActivityMinutes).toBeUndefined();
  });

  it('sessão de 45 min: a força vem primeiro, sem cardio dentro; a meta vira atividade no dia a dia', () => {
    const input = strengthInputOf(
      rodrigo([strength, running()]),
      devMethodologyParameters('STRENGTH'),
      {
        ...options,
        otherCardio: { runningSessions: 3, externalMinutesPerWeek: 0 },
      },
    );
    expect(input?.cardio).toBeUndefined();
    // Meta de 200 min (emagrecer) − 120 min das corridas = 80 min fora da academia.
    expect(input?.dailyActivityMinutes).toBe(80);
  });

  it('com corrida e esporte já cobrindo a meta, não há cardio extra na musculação', () => {
    const input = strengthInputOf(
      rodrigo([strength, running()]),
      devMethodologyParameters('STRENGTH'),
      {
        ...options,
        otherCardio: { runningSessions: 4, externalMinutesPerWeek: 60 },
      },
    );
    expect(input?.cardio).toBeUndefined();
    expect(input?.dailyActivityMinutes).toBeUndefined();
  });
});
