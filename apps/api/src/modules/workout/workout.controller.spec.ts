import { describe, expect, it, vi } from 'vitest';

import type { WorkoutAccessService } from './workout-access.service';
import { WorkoutController } from './workout.controller';
import type { WorkoutJournalService } from './workout-journal.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';

function makeController() {
  const access = {
    exchange: vi.fn(async () => 'session-token'),
    requireUser: vi.fn(async () => USER_ID),
  } as unknown as WorkoutAccessService;
  const journal = {
    journal: vi.fn(async () => ({ firstName: 'Pedro' })),
    start: vi.fn(async () => undefined),
    saveSets: vi.fn(async () => undefined),
    finish: vi.fn(async () => undefined),
  } as unknown as WorkoutJournalService;
  return { controller: new WorkoutController(access, journal), access, journal };
}

describe('WorkoutController', () => {
  it('delega troca do magic link', async () => {
    const { controller, access } = makeController();
    await expect(controller.exchange({ token: 'a'.repeat(43) })).resolves.toEqual({
      sessionToken: 'session-token',
    });
    expect(access.exchange).toHaveBeenCalledWith('a'.repeat(43));
  });

  it('abre hoje ou uma data passada apos validar a sessao', async () => {
    const { controller, journal } = makeController();
    await controller.journal('Bearer token');
    await controller.journal('Bearer token', '2026-08-10');
    expect(journal.journal).toHaveBeenNthCalledWith(1, USER_ID, undefined);
    expect(journal.journal).toHaveBeenNthCalledWith(2, USER_ID, '2026-08-10');
  });

  it('delega inicio, series e finalizacao validados', async () => {
    const { controller, journal } = makeController();
    const entries = [
      {
        exerciseId: 'squat',
        setNumber: 1,
        reps: 10,
        loadValue: 20,
        loadUnit: 'KG' as const,
        completed: true,
        skipped: false,
      },
    ];
    const finish = {
      perceivedEffort: 7,
      feelingNotes: 'Treino bom',
      painReported: false,
      painNotes: '',
    };

    await expect(controller.start('Bearer token', SESSION_ID)).resolves.toEqual({ ok: true });
    await expect(controller.sets('Bearer token', SESSION_ID, { entries })).resolves.toEqual({
      ok: true,
    });
    await expect(controller.finish('Bearer token', SESSION_ID, finish)).resolves.toEqual({
      ok: true,
    });
    expect(journal.start).toHaveBeenCalledWith(USER_ID, SESSION_ID);
    expect(journal.saveSets).toHaveBeenCalledWith(USER_ID, SESSION_ID, entries);
    expect(journal.finish).toHaveBeenCalledWith(
      USER_ID,
      SESSION_ID,
      expect.objectContaining(finish),
    );
  });
});
