import { describe, expect, it } from 'vitest';

import { ATTENDANCE_MIN_PLANNED, deterministicUuid, evaluateAttendance } from './attendance-alert';
import type { WorkoutDayStatus } from './workout-journal.service';

const MISSED: WorkoutDayStatus = {
  kind: 'MISSED',
  dayLabel: 'Dia A',
  focus: 'Costas',
  sessionKey: 'Dia A',
  workoutSessionId: null,
  protocolId: 'p',
  weekdayName: 'segunda-feira',
};
const DONE: WorkoutDayStatus = { kind: 'DONE' };
const REST: WorkoutDayStatus = { kind: 'REST' };

/** Monta uma janela do mais antigo ao mais recente a partir dos estados. */
const windowOf = (...statuses: WorkoutDayStatus[]) =>
  statuses.map((status, index) => ({
    date: `2026-10-${String(index + 1).padStart(2, '0')}`,
    status,
  }));

describe('evaluateAttendance: faltas seguidas', () => {
  it('3ª sessão prevista seguida sem registro abre o alerta, com o início da sequência', () => {
    const result = evaluateAttendance(windowOf(DONE, REST, MISSED, REST, MISSED, MISSED));
    expect(result).toEqual({
      reason: 'FALTAS_SEGUIDAS',
      streak: 3,
      streakStart: '2026-10-03',
    });
  });

  it('descanso entre as faltas não interrompe a sequência', () => {
    const result = evaluateAttendance(windowOf(MISSED, REST, REST, MISSED, REST, MISSED));
    expect(result).toMatchObject({ reason: 'FALTAS_SEGUIDAS', streak: 3 });
  });

  it('duas faltas seguidas ainda não alertam', () => {
    expect(evaluateAttendance(windowOf(DONE, DONE, REST, MISSED, MISSED))).toBeNull();
  });

  it('um treino feito ou em andamento interrompe a sequência (a proporção ainda pode alertar)', () => {
    // 4 faltas em 5 sessões previstas: não há 3 SEGUIDAS, mas a proporção passa de 60%.
    expect(evaluateAttendance(windowOf(MISSED, MISSED, DONE, MISSED, MISSED))?.reason).toBe(
      'FALTAS_FREQUENTES',
    );
    expect(
      evaluateAttendance(windowOf(MISSED, MISSED, { kind: 'IN_PROGRESS' }, MISSED, MISSED))?.reason,
    ).toBe('FALTAS_FREQUENTES');
    // Com mais treinos feitos, nada alerta.
    expect(
      evaluateAttendance(windowOf(DONE, MISSED, MISSED, DONE, MISSED, MISSED, DONE, DONE)),
    ).toBeNull();
  });

  it('o começo do protocolo interrompe a sequência (dias antes da entrega não contam)', () => {
    expect(evaluateAttendance(windowOf({ kind: 'BEFORE_START' }, MISSED, MISSED))).toBeNull();
  });

  it('a sequência vale mesmo quando a última sessão prevista foi há alguns dias', () => {
    const result = evaluateAttendance(windowOf(MISSED, MISSED, MISSED, REST, REST));
    expect(result).toMatchObject({ reason: 'FALTAS_SEGUIDAS', streak: 3 });
  });
});

describe('evaluateAttendance: mais de 60% das sessões', () => {
  it('4 de 6 (67%) alerta, mesmo sem 3 seguidas', () => {
    const result = evaluateAttendance(windowOf(MISSED, MISSED, DONE, MISSED, MISSED, DONE));
    expect(result).toEqual({ reason: 'FALTAS_FREQUENTES', planned: 6, missed: 4 });
  });

  it('exatamente 60% não alerta (é "mais de" 60%)', () => {
    // 3 de 5 = 60%.
    expect(evaluateAttendance(windowOf(MISSED, DONE, MISSED, DONE, MISSED))).toBeNull();
  });

  it('abaixo da amostra mínima não alerta, por mais alta que seja a proporção', () => {
    expect(ATTENDANCE_MIN_PLANNED).toBe(4);
    // 2 de 3 = 67%, mas só 3 sessões previstas.
    expect(evaluateAttendance(windowOf(MISSED, DONE, MISSED))).toBeNull();
  });

  it('treino em andamento conta como sessão feita na proporção', () => {
    expect(
      evaluateAttendance(windowOf(MISSED, { kind: 'IN_PROGRESS' }, MISSED, DONE, MISSED)),
    ).toBeNull();
  });

  it('quando as duas regras valem, a sequência vence (um alerta só)', () => {
    const result = evaluateAttendance(windowOf(MISSED, MISSED, MISSED, MISSED));
    expect(result).toMatchObject({ reason: 'FALTAS_SEGUIDAS' });
  });

  it('sem nenhuma sessão prevista, nada a alertar', () => {
    expect(evaluateAttendance(windowOf(REST, REST, REST))).toBeNull();
    expect(evaluateAttendance([])).toBeNull();
  });
});

describe('deterministicUuid', () => {
  it('é estável, tem formato de UUID e muda com a chave', () => {
    const uuid = deterministicUuid('u|FALTAS_SEGUIDAS|2026-10-03');
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(deterministicUuid('u|FALTAS_SEGUIDAS|2026-10-03')).toBe(uuid);
    expect(deterministicUuid('u|FALTAS_SEGUIDAS|2026-10-04')).not.toBe(uuid);
  });
});
