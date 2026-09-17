import { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';

import type { AppConfigService } from '../../core/config';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkerFactory } from '../jobs/worker.factory';
import type { ShortLinkService } from '../short-link/short-link.service';
import type { WorkoutAccessService } from './workout-access.service';
import type { WorkoutJournalService } from './workout-journal.service';
import { WorkoutScheduler } from './workout.scheduler';

const CONFIG = {
  whatsapp: { publicSiteUrl: 'https://movivo.test' },
} as unknown as AppConfigService;

const USER_ID = '11111111-1111-4111-8111-111111111111';

// Achado 2026-09-10 (pedido do fundador): horário deixou de ser configurável por aluno — o
// link diário dispara sempre às 04:00 no fuso LOCAL do aluno (`users.timezone`). Só
// `reminderEnabled` (opt-out) e ter treino no dia continuam variando por titular.
function makeScheduler(reminderEnabled = true, hasWorkout = true) {
  const rows = [
    {
      userId: USER_ID,
      name: 'Pedro Teste',
      timezone: 'America/Sao_Paulo',
      reminderEnabled,
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
  const create = vi.fn(async () => 'aB3xK9pQ');
  const scheduler = new WorkoutScheduler(
    {} as WorkerFactory,
    { enqueue } as unknown as QueueManager,
    db,
    {
      createMagicLink: vi.fn(async () => 'https://movivo.test/treino/acessar#token=secret'),
    } as unknown as WorkoutAccessService,
    { journal } as unknown as WorkoutJournalService,
    { create } as unknown as ShortLinkService,
    CONFIG,
    { setContext: vi.fn(), info: vi.fn() } as unknown as PinoLogger,
  );
  return { scheduler, enqueue, journal, create };
}

describe('WorkoutScheduler.scan', () => {
  it('envia o link às 04:00 no fuso local, com dedupe por titular e dia', async () => {
    const { scheduler, enqueue } = makeScheduler();
    // 07:00 UTC == 04:00 em America/Sao_Paulo (UTC-3).
    const result = await scheduler.scan(new Date('2026-08-10T07:00:00.000Z'));
    expect(result.sent).toBe(1);
    expect(enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'workout-daily-link',
      expect.objectContaining({ userId: USER_ID, type: 'WORKOUT_DAILY_LINK' }),
      { jobId: `wa-workout-link-${USER_ID}-2026-08-10` },
    );
  });

  it('encurta o magic link para /check-in/<código> no domínio da marca (achado 2026-09-12)', async () => {
    const { scheduler, enqueue, create } = makeScheduler();
    await scheduler.scan(new Date('2026-08-10T07:00:00.000Z'));

    expect(create).toHaveBeenCalledWith(
      'https://movivo.test/treino/acessar#token=secret',
      expect.any(Date),
    );
    const [, , payload] = enqueue.mock.calls[0] as unknown as [string, string, { text: string }];
    expect(payload.text).toContain('https://movivo.test/check-in/aB3xK9pQ');
    expect(payload.text).not.toContain('#token=secret');
  });

  it('nao envia fora do horario fixo (04:00)', async () => {
    const { scheduler, enqueue } = makeScheduler();
    // 08:00 UTC == 05:00 em America/Sao_Paulo — não é 04:00.
    await scheduler.scan(new Date('2026-08-10T08:00:00.000Z'));
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('nao envia quando o aluno desativou o lembrete', async () => {
    const { scheduler, enqueue } = makeScheduler(false);
    await scheduler.scan(new Date('2026-08-10T07:00:00.000Z'));
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('nao envia em dia sem sessao prescrita', async () => {
    const { scheduler, enqueue } = makeScheduler(true, false);
    await scheduler.scan(new Date('2026-08-10T07:00:00.000Z'));
    expect(enqueue).not.toHaveBeenCalled();
  });
});
