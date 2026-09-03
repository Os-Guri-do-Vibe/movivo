import { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';

import { TenantDatabase } from '../../core/database/tenant-database.service';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkerFactory } from '../jobs/worker.factory';
import type { WorkoutAccessService } from './workout-access.service';
import type { WorkoutJournalService } from './workout-journal.service';
import { WorkoutScheduler } from './workout.scheduler';

const USER_ID = '11111111-1111-4111-8111-111111111111';

function makeScheduler(reminderTime = '05:00', hasWorkout = true) {
  const rows = [
    {
      userId: USER_ID,
      name: 'Pedro Teste',
      timezone: 'America/Sao_Paulo',
      reminderTime,
      reminderEnabled: true,
    },
  ];
  const chain = { from: () => chain, innerJoin: () => chain, where: async () => rows };
  const db = {
    runAsSystem: vi.fn((cb: (value: unknown) => Promise<unknown>) =>
      cb({ selectDistinct: () => chain }),
    ),
  } as unknown as TenantDatabase;
  const enqueue = vi.fn(async () => 'job');
  const journal = vi.fn(async () => ({
    workout: hasWorkout ? { id: '22222222-2222-4222-8222-222222222222' } : null,
  }));
  const scheduler = new WorkoutScheduler(
    {} as WorkerFactory,
    { enqueue } as unknown as QueueManager,
    db,
    {
      createMagicLink: vi.fn(async () => 'https://movivo.test/treino/acessar#token=secret'),
    } as unknown as WorkoutAccessService,
    { journal } as unknown as WorkoutJournalService,
    { setContext: vi.fn(), info: vi.fn() } as unknown as PinoLogger,
  );
  return { scheduler, enqueue, journal };
}

describe('WorkoutScheduler.scan', () => {
  it('envia o link na hora local configurada com dedupe por titular e dia', async () => {
    const { scheduler, enqueue } = makeScheduler();
    const result = await scheduler.scan(new Date('2026-08-10T08:00:00.000Z'));
    expect(result.sent).toBe(1);
    expect(enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'workout-daily-link',
      expect.objectContaining({ userId: USER_ID, type: 'WORKOUT_DAILY_LINK' }),
      { jobId: `wa-workout-link-${USER_ID}-2026-08-10` },
    );
  });

  it('nao envia fora da hora configurada', async () => {
    const { scheduler, enqueue } = makeScheduler('06:00');
    await scheduler.scan(new Date('2026-08-10T08:00:00.000Z'));
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('nao envia em dia sem sessao prescrita', async () => {
    const { scheduler, enqueue } = makeScheduler('05:00', false);
    await scheduler.scan(new Date('2026-08-10T08:00:00.000Z'));
    expect(enqueue).not.toHaveBeenCalled();
  });
});
