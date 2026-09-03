import { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';

import { TenantDatabase } from '../../core/database/tenant-database.service';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkerFactory } from '../jobs/worker.factory';
import { WorkoutScheduler } from './workout.scheduler';

const USER_ID = '11111111-1111-4111-8111-111111111111';

function session(dayLabel: string) {
  return {
    dayLabel,
    focus: 'Corpo inteiro',
    exercises: [
      {
        exerciseId: 'goblet_squat',
        name: 'Agachamento goblet com halter',
        sets: 3,
        reps: { min: 8, max: 12 },
        loadStrategy: 'DOUBLE_PROGRESSION',
        restSeconds: 90,
      },
    ],
  };
}

/** Frequência 3 => segunda/quarta/sexta (`workout-schedule.ts`). */
const STRUCTURE = {
  promptVersion: 'methodology-2026-08-v2+catalog-2026-08-v2',
  goal: 'GAIN_MUSCLE',
  phase: 'ADAPTACAO',
  phaseDurationWeeks: 3,
  weeklyFrequency: 3,
  sessions: [session('A'), session('B'), session('C')],
};

function makeScheduler(rows: Array<{ userId: string; content: unknown }>) {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: async () => rows,
  };
  const tx = { selectDistinct: () => chain } as never;
  const db = {
    runAsSystem: vi.fn((cb: (value: unknown) => Promise<unknown>) => cb(tx)),
  } as unknown as TenantDatabase;
  const enqueue = vi.fn(async () => 'job');
  const logger = { setContext: vi.fn(), info: vi.fn() } as unknown as PinoLogger;
  const scheduler = new WorkoutScheduler(
    {} as WorkerFactory,
    { enqueue } as unknown as QueueManager,
    db,
    logger,
  );
  return { scheduler, enqueue };
}

describe('WorkoutScheduler.scan', () => {
  it('envia no dia de treino com jobId determinístico por dia (sem reenvio)', async () => {
    const { scheduler, enqueue } = makeScheduler([{ userId: USER_ID, content: STRUCTURE }]);
    // Segunda-feira, 20h em America/Sao_Paulo (UTC-3).
    const result = await scheduler.scan(new Date('2026-08-10T23:00:00.000Z'));

    expect(result.sent).toBe(1);
    expect(enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'workout-quick-reply',
      expect.objectContaining({
        userId: USER_ID,
        type: 'WORKOUT_QUICK_REPLY',
        buttons: [
          { id: 'workout:DONE:2026-08-10:A', title: 'Treinei ✅' },
          { id: 'workout:SKIP:2026-08-10:A', title: 'Hoje não' },
        ],
      }),
      { jobId: `wa-workout-${USER_ID}-2026-08-10` },
    );
  });

  it('não envia em dia sem treino previsto', async () => {
    const { scheduler, enqueue } = makeScheduler([{ userId: USER_ID, content: STRUCTURE }]);
    // Domingo.
    const result = await scheduler.scan(new Date('2026-08-09T23:00:00.000Z'));
    expect(result.sent).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('ignora protocolo cuja estrutura não valida, sem derrubar o scan', async () => {
    const { scheduler, enqueue } = makeScheduler([{ userId: USER_ID, content: { lixo: true } }]);
    const result = await scheduler.scan(new Date('2026-08-10T23:00:00.000Z'));
    expect(result).toMatchObject({ eligible: 1, sent: 0 });
    expect(enqueue).not.toHaveBeenCalled();
  });
});
