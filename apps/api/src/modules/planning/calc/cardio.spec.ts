import { describe, expect, it } from 'vitest';

import { cardioPrescription, CARDIO_PROFILE, weeklyCardioTarget, WHO_CARDIO } from './cardio';

const base = {
  goals: ['HYPERTROPHY'],
  beginner: false,
  strengthSessions: 3,
  minutesPerSession: 60,
  runningMinutesPerWeek: 0,
  externalMinutesPerWeek: 0,
};

describe('meta de cardio (OMS)', () => {
  it('parte dos 150 min/semana da OMS; emagrecer pede a parte alta da faixa; iniciante começa menor', () => {
    expect(weeklyCardioTarget({ goals: ['HYPERTROPHY'], beginner: false })).toBe(
      WHO_CARDIO.moderateMinutesMin,
    );
    expect(weeklyCardioTarget({ goals: ['FAT_LOSS'], beginner: false })).toBe(200);
    expect(weeklyCardioTarget({ goals: ['BODY_DEFINITION', 'HYPERTROPHY'], beginner: false })).toBe(
      200,
    );
    expect(weeklyCardioTarget({ goals: ['FAT_LOSS'], beginner: true })).toBe(100);
    expect(weeklyCardioTarget({ goals: ['FAT_LOSS'], beginner: false })).toBeLessThanOrEqual(
      WHO_CARDIO.moderateMinutesMax,
    );
  });

  it('só musculação: distribui o que cabe nas sessões e deixa o resto para o dia a dia', () => {
    const result = cardioPrescription(base);
    expect(result.targetMinutes).toBe(150);
    // 60 min por sessão: a força fica com 40, sobram 20 para o cardio.
    expect(result.perSession).toEqual({ min: 10, max: 20 });
    expect(result.weeklyMinutes).toBe(60);
    expect(result.leftoverMinutes).toBe(90);
  });

  it('a corrida e o esporte externo contam: só falta o que eles não cobrem', () => {
    const result = cardioPrescription({
      ...base,
      runningMinutesPerWeek: 80,
      externalMinutesPerWeek: 30,
    });
    expect(result.coveredMinutes).toBe(110);
    expect(result.weeklyMinutes).toBe(40);
    expect(result.leftoverMinutes).toBe(0);
  });

  it('meta já coberta ou sessão curta demais não prescreve cardio dentro da musculação', () => {
    expect(cardioPrescription({ ...base, runningMinutesPerWeek: 200 }).weeklyMinutes).toBe(0);
    const curta = cardioPrescription({ ...base, minutesPerSession: 30 });
    expect(curta.weeklyMinutes).toBe(0);
    expect(curta.leftoverMinutes).toBe(150);
  });

  it('a força vem primeiro: em sessão de 45 min não sobra tempo para cardio dentro dela', () => {
    const result = cardioPrescription({ ...base, minutesPerSession: 45 });
    expect(result.weeklyMinutes).toBe(0);
    expect(result.perSession).toEqual({ min: 0, max: 0 });
    expect(result.leftoverMinutes).toBe(150);
    // Com 50 min sobram só 10 por sessão (o mínimo útil): entra, sem tirar da força.
    expect(cardioPrescription({ ...base, minutesPerSession: 50 }).perSession.max).toBe(10);
  });

  it('só usa cardio de academia, casa e rua que já existe no catálogo (sem corrida nem esportes)', () => {
    expect(Object.keys(CARDIO_PROFILE)).toEqual(
      expect.arrayContaining(['esteira', 'eliptico', 'bicicleta_horizontal', 'hiit']),
    );
    for (const fora of ['corrida', 'natacao', 'boxe', 'sprints', 'trilha', 'escalada']) {
      expect(CARDIO_PROFILE).not.toHaveProperty(fora);
    }
  });
});
