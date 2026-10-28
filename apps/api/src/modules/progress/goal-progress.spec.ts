import { describe, expect, it } from 'vitest';

import { evaluateMilestone, measurementOf, taskProgress, taskStatus } from './goal-progress';

const counts = {
  executionsDone: 3,
  keySessionsDone: 1,
  foodLogDays: 5,
  proteinDays: 4,
  measurements: 2,
  photos: 0,
  checkInsAnswered: 1,
};

describe('taskProgress', () => {
  it('mede por evento, e tipos subjetivos não são verificáveis', () => {
    expect(taskProgress('COMPLETE_SESSIONS', counts)).toBe(3);
    expect(taskProgress('HIT_PROTEIN', counts)).toBe(4);
    expect(taskProgress('ANSWER_CHECK_IN', counts)).toBe(1);
    expect(taskProgress('SLEEP_ROUTINE', counts)).toBeNull();
    expect(taskProgress('CUSTOM', counts)).toBeNull();
  });
});

describe('taskStatus', () => {
  it('conclui ao bater o alvo, mesmo antes de a janela acabar', () => {
    expect(taskStatus(3, 3, '2026-11-08', '2026-11-04')).toBe('DONE');
  });
  it('fica aberta dentro da janela e vira perdida só depois dela', () => {
    expect(taskStatus(2, 3, '2026-11-08', '2026-11-08')).toBe('OPEN');
    expect(taskStatus(2, 3, '2026-11-08', '2026-11-09')).toBe('MISSED');
  });
});

describe('evaluateMilestone', () => {
  const due = '2026-11-30';
  it('atinge assim que a condição é satisfeita, antes do prazo', () => {
    expect(
      evaluateMilestone(
        { kind: 'AT_LEAST', value: 9 },
        { current: 9, baseline: 0 },
        due,
        '2026-11-10',
      ),
    ).toBe('ACHIEVED');
    expect(
      evaluateMilestone(
        { kind: 'AT_MOST', value: 80 },
        { current: 79.5, baseline: 82 },
        due,
        '2026-11-10',
      ),
    ).toBe('ACHIEVED');
  });
  it('só perde depois do prazo', () => {
    const reading = { current: 5, baseline: 0 };
    expect(evaluateMilestone({ kind: 'AT_LEAST', value: 9 }, reading, due, '2026-11-30')).toBe(
      'PENDING',
    );
    expect(evaluateMilestone({ kind: 'AT_LEAST', value: 9 }, reading, due, '2026-12-01')).toBe(
      'MISSED',
    );
  });
  it('mudança em relação ao início, para cima ou para baixo', () => {
    expect(
      evaluateMilestone(
        { kind: 'CHANGE_BY', delta: -2 },
        { current: 78, baseline: 80.5 },
        due,
        '2026-11-10',
      ),
    ).toBe('ACHIEVED');
    expect(
      evaluateMilestone(
        { kind: 'CHANGE_BY', delta: 2 },
        { current: 80.5, baseline: 80 },
        due,
        '2026-12-05',
      ),
    ).toBe('MISSED');
    expect(
      evaluateMilestone(
        { kind: 'CHANGE_BY', delta: 2 },
        { current: 82, baseline: null },
        due,
        '2026-12-05',
      ),
    ).toBe('PENDING');
  });
  it('manual ou sem leitura fica com o profissional', () => {
    expect(
      evaluateMilestone({ kind: 'MANUAL' }, { current: 1, baseline: 0 }, due, '2027-01-01'),
    ).toBe('PENDING');
    expect(
      evaluateMilestone(
        { kind: 'AT_LEAST', value: 1 },
        { current: null, baseline: null },
        due,
        '2027-01-01',
      ),
    ).toBe('PENDING');
  });
});

describe('measurementOf', () => {
  it('liga o indicador corporal à medida pela chave', () => {
    const base = { label: 'x', direction: 'DECREASE' as const };
    expect(measurementOf({ ...base, key: 'weight_kg', source: 'BODY' })).toBe('WEIGHT');
    expect(measurementOf({ ...base, key: 'waist_cm', source: 'BODY' })).toBe('WAIST');
    expect(measurementOf({ ...base, key: 'sessions', source: 'ADHERENCE' })).toBeNull();
    expect(measurementOf({ ...base, key: 'humor', source: 'BODY' })).toBeNull();
  });
});
