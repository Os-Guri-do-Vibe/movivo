import { describe, expect, it, vi } from 'vitest';

import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
import { deterministicUuid } from './attendance-alert';
import { AttendanceAlertService } from './attendance-alert.service';
import type { WorkoutDayStatus, WorkoutJournalService } from './workout-journal.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TODAY = '2026-10-14';
const NOW = new Date('2026-10-14T07:00:00.000Z');

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

const windowOf = (...statuses: WorkoutDayStatus[]) =>
  statuses.map((status, index) => ({
    date: `2026-10-${String(index + 1).padStart(2, '0')}`,
    status,
  }));

function makeService(options: {
  window: ReturnType<typeof windowOf>;
  recentAlert?: boolean;
  alreadyInserted?: boolean;
}) {
  const inserted: Record<string, unknown>[] = [];
  const attendanceWindow = vi.fn(async () => options.window);
  const selectChain: Record<string, unknown> = {};
  for (const name of ['from', 'where']) selectChain[name] = () => selectChain;
  selectChain.limit = async () => (options.recentAlert ? [{ id: 'a1' }] : []);
  const tx = {
    select: () => selectChain,
    insert: () => {
      const chain = {
        values: (value: Record<string, unknown>) => {
          inserted.push(value);
          return chain;
        },
        onConflictDoNothing: () => chain,
        returning: async () => (options.alreadyInserted ? [] : [{ id: 'new-alert' }]),
      };
      return chain;
    },
  };
  const db = {
    runAsUser: vi.fn((_u: string, _r: string, cb: (value: typeof tx) => unknown) => cb(tx)),
  } as unknown as TenantDatabase;
  const emit = vi.fn();
  const service = new AttendanceAlertService(
    db,
    { attendanceWindow } as unknown as WorkoutJournalService,
    { emit } as unknown as DashboardQueueEventsService,
  );
  return { service, inserted, emit, attendanceWindow };
}

describe('AttendanceAlertService.check', () => {
  it('3ª falta seguida: abre alerta de nível ALERT para o profissional e avisa o painel', async () => {
    const { service, inserted, emit, attendanceWindow } = makeService({
      window: windowOf(DONE, MISSED, MISSED, MISSED),
    });
    const finding = await service.check(USER_ID, TODAY, NOW);

    expect(attendanceWindow).toHaveBeenCalledWith(USER_ID, TODAY, NOW, 14);
    expect(finding).toMatchObject({ reason: 'FALTAS_SEGUIDAS', streak: 3 });
    expect(inserted[0]).toEqual({
      userId: USER_ID,
      level: 'ALERT',
      reason: 'FALTAS_SEGUIDAS',
      sourceType: 'ATTENDANCE_STREAK',
      sourceId: deterministicUuid(`${USER_ID}|FALTAS_SEGUIDAS|2026-10-02`),
    });
    expect(emit).toHaveBeenCalledWith('handoff');
  });

  it('mais de 60% das sessões: abre o alerta de faltas frequentes', async () => {
    const { service, inserted } = makeService({
      window: windowOf(MISSED, MISSED, DONE, MISSED, MISSED, DONE),
    });
    await expect(service.check(USER_ID, TODAY, NOW)).resolves.toMatchObject({
      reason: 'FALTAS_FREQUENTES',
      missed: 4,
      planned: 6,
    });
    expect(inserted[0]).toMatchObject({
      reason: 'FALTAS_FREQUENTES',
      sourceType: 'ATTENDANCE_RATE',
    });
  });

  it('frequência normal: nada é criado', async () => {
    const { service, inserted, emit } = makeService({
      window: windowOf(DONE, DONE, MISSED, DONE),
    });
    await expect(service.check(USER_ID, TODAY, NOW)).resolves.toBeNull();
    expect(inserted).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
  });

  it('alerta do mesmo motivo aberto ou recente: não abre outro nos dias seguintes', async () => {
    const { service, inserted, emit } = makeService({
      window: windowOf(MISSED, MISSED, MISSED, MISSED),
      recentAlert: true,
    });
    await expect(service.check(USER_ID, TODAY, NOW)).resolves.toBeNull();
    expect(inserted).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
  });

  it('retry da varredura: a chave única barra o duplicado e não avisa o painel de novo', async () => {
    const { service, emit } = makeService({
      window: windowOf(MISSED, MISSED, MISSED),
      alreadyInserted: true,
    });
    await expect(service.check(USER_ID, TODAY, NOW)).resolves.toBeNull();
    expect(emit).not.toHaveBeenCalled();
  });

  it('a chave do alerta de proporção muda por dia, a da sequência pelo início da sequência', async () => {
    const rate = makeService({ window: windowOf(MISSED, MISSED, DONE, MISSED, MISSED, DONE) });
    await rate.service.check(USER_ID, TODAY, NOW);
    expect(rate.inserted[0]?.sourceId).toBe(
      deterministicUuid(`${USER_ID}|FALTAS_FREQUENTES|2026-10-13`),
    );
  });
});
