import type { ProtocolStructure } from '@movivo/shared';
import { describe, expect, it, vi } from 'vitest';

import type { TenantDatabase } from '../../core/database/tenant-database.service';
import { buildWeekSlots } from './schedule-planner';
import { WorkoutLateLogService } from './workout-late-log.service';
import type { WorkoutJournalService } from './workout-journal.service';
import type { ScheduleContext, WorkoutScheduleService } from './workout-schedule.service';

const USER_ID = 'u1';
// Hoje é quinta 2026-10-22; ontem quarta (21), anteontem terça (20).
const TODAY = '2026-10-22';
const NOW = new Date('2026-10-22T15:00:00.000Z');

const STRUCTURE = {
  weeklyFrequency: 3,
  sessions: [
    { dayLabel: 'A', weekday: 'THU', focus: 'Costas e Bíceps' },
    { dayLabel: 'B', weekday: 'FRI', focus: 'Pernas' },
    { dayLabel: 'C', weekday: 'SUN', focus: 'Peito e Tríceps' },
  ],
} as unknown as ProtocolStructure;

function ctx(
  options: {
    today?: string;
    /** Semana a montar (padrão: a de `today`). */
    anchor?: string;
    overrides?: Map<string, string | null>;
    firstProtocolDate?: string;
    sessions?: Record<string, { status: 'COMPLETED' | 'IN_PROGRESS'; sessionKey: string }>;
  } = {},
): ScheduleContext {
  const today = options.today ?? TODAY;
  const firstProtocolDate = options.firstProtocolDate ?? '2026-10-05';
  return {
    userId: USER_ID,
    name: 'Ana',
    timezone: 'America/Sao_Paulo',
    today,
    localTime: '12:00',
    protocolId: 'p1',
    structure: STRUCTURE,
    quota: 3,
    firstProtocolDate,
    slots: buildWeekSlots({
      today,
      anchor: options.anchor,
      firstProtocolDate,
      structure: STRUCTURE,
      overrides: options.overrides,
      sessionsByDate: new Map(Object.entries(options.sessions ?? {})),
    }),
  };
}

function make(options: {
  ctx?: ScheduleContext | null;
  existing?: Array<{
    id: string;
    status: string;
    sessionKey: string;
    prescription: { focus: string };
  }>;
}) {
  const db = {
    runAsSystem: vi.fn(async () => options.existing ?? []),
  } as unknown as TenantDatabase;
  const weekContext = vi.fn(async (..._args: unknown[]) =>
    options.ctx === undefined ? ctx() : options.ctx,
  );
  const apply = vi.fn(async (..._args: unknown[]) => ({ adjustmentId: 'adj', created: true }));
  const schedule = { weekContext, apply } as unknown as WorkoutScheduleService;
  const journal = {
    journal: vi.fn(async (_userId: string, _date: string, _now: Date) => ({
      workout: { id: 'w-late', prescription: { dayLabel: 'A', focus: 'Costas e Bíceps' } },
    })),
    startLate: vi.fn(async () => undefined),
  };
  const service = new WorkoutLateLogService(
    db,
    schedule,
    journal as unknown as WorkoutJournalService,
    { setContext: vi.fn(), info: vi.fn() } as never,
  );
  return { service, weekContext, apply, journal };
}

describe('WorkoutLateLogService.begin', () => {
  it('abre o treino previsto para o dia passado, sem mexer no calendário', async () => {
    // Ontem (quarta) tinha o A por ajuste anterior: o calendário já concorda.
    const withA = ctx();
    withA.slots = withA.slots.map((slot) =>
      slot.date === '2026-10-21' ? { ...slot, sessionKey: 'A' } : slot,
    );
    const { service, apply, journal } = make({ ctx: withA });

    const result = await service.begin(USER_ID, { date: '2026-10-21' }, NOW);

    expect(result).toEqual({
      status: 'READY',
      workoutId: 'w-late',
      date: '2026-10-21',
      sessionKey: 'A',
      focus: 'Costas e Bíceps',
    });
    expect(apply).not.toHaveBeenCalled();
    expect(journal.journal).toHaveBeenCalledWith(USER_ID, '2026-10-21', NOW);
    expect(journal.startLate).toHaveBeenCalledWith(USER_ID, 'w-late', NOW);
  });

  it('Gabriel treinou o A na terça (dia sem treino): leva o A para terça e libera a quinta', async () => {
    const { service, apply } = make({});

    const result = await service.begin(USER_ID, { date: '2026-10-20', sessionKey: 'A' }, NOW);

    expect(result.status).toBe('READY');
    const [, , plan, meta] = apply.mock.calls[0] as unknown as [
      string,
      unknown,
      { changes: Array<{ date: string; from: string | null; to: string | null }> },
      { kind: string; source: string },
    ];
    expect(plan.changes).toEqual([
      { date: '2026-10-20', from: null, to: 'A' },
      { date: '2026-10-22', from: 'A', to: null },
    ]);
    expect(meta).toEqual({ kind: 'LATE_LOG', source: 'LATE_LOG' });
  });

  it('dia de descanso sem dizer qual treino: pergunta, com as opções do protocolo', async () => {
    const { service, apply } = make({});
    const result = await service.begin(USER_ID, { date: '2026-10-21' }, NOW);
    expect(result).toEqual({
      status: 'NEEDS_SESSION',
      options: [
        { key: 'A', focus: 'Costas e Bíceps' },
        { key: 'B', focus: 'Pernas' },
        { key: 'C', focus: 'Peito e Tríceps' },
      ],
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it('treino que o planejador não consegue mover (já feito na semana) é registrado mesmo assim', async () => {
    // O A já foi feito na terça (por um ajuste anterior a quinta ficou livre).
    const done = ctx({
      sessions: { '2026-10-20': { status: 'COMPLETED', sessionKey: 'A' } },
      overrides: new Map([['2026-10-22', null]]),
    });
    const { service, apply } = make({ ctx: done });

    const result = await service.begin(USER_ID, { date: '2026-10-21', sessionKey: 'A' }, NOW);

    expect(result.status).toBe('READY');
    const plan = apply.mock.calls[0]?.[2] as unknown as {
      changes: Array<{ date: string; from: string | null; to: string | null }>;
    };
    // Só o dia do treino é ajustado; o que o aluno viveu vale mais que o plano.
    expect(plan.changes).toEqual([{ date: '2026-10-21', from: null, to: 'A' }]);
  });

  it('recusa chave de treino que não existe', async () => {
    const { service } = make({});
    expect(
      await service.begin(USER_ID, { date: '2026-10-21', sessionKey: 'Z' }, NOW),
    ).toMatchObject({ status: 'UNKNOWN_SESSION' });
  });

  it.each([
    ['hoje', '2026-10-22'],
    ['amanhã', '2026-10-23'],
    ['3 dias atrás (fora da janela de 2 dias)', '2026-10-19'],
  ])('fora da janela: %s', async (_label, date) => {
    const { service, journal } = make({});
    expect(await service.begin(USER_ID, { date, sessionKey: 'A' }, NOW)).toEqual({
      status: 'OUT_OF_WINDOW',
    });
    expect(journal.startLate).not.toHaveBeenCalled();
  });

  it('no dia da ENTREGA do protocolo abre o treino previsto, sem perguntar e sem ajuste (D4)', async () => {
    // Entregue na quinta 22 (dia do A); hoje é sexta 23. O planejador trava o slot do dia da
    // entrega, mas o registro tardio usa o calendário efetivo.
    const friday = ctx({ today: '2026-10-23', firstProtocolDate: '2026-10-22' });
    const { service, apply, journal } = make({ ctx: friday });

    const result = await service.begin(
      USER_ID,
      { date: '2026-10-22' },
      new Date('2026-10-23T15:00:00Z'),
    );

    expect(result).toMatchObject({ status: 'READY', date: '2026-10-22' });
    expect(apply).not.toHaveBeenCalled();
    expect(journal.startLate).toHaveBeenCalled();
  });

  it('antes da entrega do protocolo não há treino para registrar', async () => {
    const { service } = make({ ctx: ctx({ firstProtocolDate: '2026-10-22' }) });
    expect(await service.begin(USER_ID, { date: '2026-10-21', sessionKey: 'A' }, NOW)).toEqual({
      status: 'OUT_OF_WINDOW',
    });
  });

  it('treino já registrado naquele dia', async () => {
    const { service, journal } = make({
      existing: [
        {
          id: 'w',
          status: 'COMPLETED',
          sessionKey: 'A',
          prescription: { focus: 'Costas e Bíceps' },
        },
      ],
    });
    expect(await service.begin(USER_ID, { date: '2026-10-21', sessionKey: 'A' }, NOW)).toEqual({
      status: 'ALREADY_LOGGED',
      focus: 'Costas e Bíceps',
    });
    expect(journal.startLate).not.toHaveBeenCalled();
  });

  it('registro tardio já aberto é retomado, não duplicado', async () => {
    const { service, journal, apply } = make({
      existing: [
        { id: 'w-open', status: 'IN_PROGRESS', sessionKey: 'B', prescription: { focus: 'Pernas' } },
      ],
    });
    expect(await service.begin(USER_ID, { date: '2026-10-21' }, NOW)).toEqual({
      status: 'READY',
      workoutId: 'w-open',
      date: '2026-10-21',
      sessionKey: 'B',
      focus: 'Pernas',
    });
    expect(journal.journal).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it('sem protocolo ativo', async () => {
    const { service } = make({ ctx: null });
    expect(await service.begin(USER_ID, { date: '2026-10-21' }, NOW)).toEqual({
      status: 'NO_PROTOCOL',
    });
  });

  it('o dia pode estar na semana anterior (hoje é segunda, ontem é domingo)', async () => {
    const monday = ctx({ today: '2026-10-26', anchor: '2026-10-25' });
    const { service, weekContext } = make({ ctx: monday });
    await service.begin(
      USER_ID,
      { date: '2026-10-25', sessionKey: 'C' },
      new Date('2026-10-26T15:00:00Z'),
    );
    // A semana usada para planejar é a que contém o dia registrado.
    expect(weekContext).toHaveBeenCalledWith(USER_ID, expect.any(Date), '2026-10-25');
  });
});
