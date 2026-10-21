import type { ProtocolStructure, Weekday } from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import {
  buildWeekSlots,
  effectiveSessionForDate,
  overridesFromAdjustments,
  planScheduleChange,
  type AdjustmentRequest,
  type PlanSuccess,
  type SessionRowSummary,
  type WeekSlot,
  weekDates,
  weekStartMonday,
} from './schedule-planner';

// Semana de 2026-10-19 (segunda) a 2026-10-25 (domingo).
const MON = '2026-10-19';
const TUE = '2026-10-20';
const WED = '2026-10-21';
const THU = '2026-10-22';
const FRI = '2026-10-23';
const SAT = '2026-10-24';
const SUN = '2026-10-25';

function structure(sessions: Array<[string, Weekday]>): ProtocolStructure {
  return {
    weeklyFrequency: sessions.length,
    sessions: sessions.map(([dayLabel, weekday]) => ({ dayLabel, weekday, focus: dayLabel })),
  } as unknown as ProtocolStructure;
}

/** Gabriel: 3x, Quinta A / Sexta B / Domingo C. */
const GABRIEL = structure([
  ['A', 'THU'],
  ['B', 'FRI'],
  ['C', 'SUN'],
]);
/** João: 5x, Seg T1 / Ter T2 / Qua T3 / Qui T4 / Sáb T5. */
const JOAO = structure([
  ['T1', 'MON'],
  ['T2', 'TUE'],
  ['T3', 'WED'],
  ['T4', 'THU'],
  ['T5', 'SAT'],
]);

function slotsFor(
  protocol: ProtocolStructure,
  today: string,
  sessions: Record<string, SessionRowSummary> = {},
  overrides?: Map<string, string | null>,
): WeekSlot[] {
  return buildWeekSlots({
    today,
    firstProtocolDate: '2026-10-05',
    structure: protocol,
    overrides,
    sessionsByDate: new Map(Object.entries(sessions)),
  });
}

function plan(
  protocol: ProtocolStructure,
  slots: WeekSlot[],
  today: string,
  request: AdjustmentRequest,
) {
  return planScheduleChange({
    today,
    slots,
    quota: protocol.weeklyFrequency,
    sessionKeys: protocol.sessions.map((session) => session.dayLabel),
    request,
  });
}

function layout(result: PlanSuccess): Record<string, string | null> {
  return Object.fromEntries(result.slots.map((slot) => [slot.date, slot.sessionKey]));
}

describe('semana e calendário efetivo', () => {
  it('a semana vai de segunda a domingo', () => {
    expect(weekStartMonday(SUN)).toBe(MON);
    expect(weekDates(WED)).toEqual([MON, TUE, WED, THU, FRI, SAT, SUN]);
  });

  it('sem ajuste vale o calendário padrão do protocolo', () => {
    const slots = slotsFor(GABRIEL, TUE);
    expect(slots.map((slot) => slot.sessionKey)).toEqual([null, null, null, 'A', 'B', null, 'C']);
  });

  it('o último ajuste que cita a data vence, e descanso (null) também é ajuste', () => {
    const overrides = overridesFromAdjustments([
      {
        assignments: [
          { date: TUE, sessionKey: 'A' },
          { date: THU, sessionKey: null },
        ],
      },
      { assignments: [{ date: TUE, sessionKey: 'B' }] },
    ]);
    expect(effectiveSessionForDate(TUE, GABRIEL, overrides)?.dayLabel).toBe('B');
    expect(effectiveSessionForDate(THU, GABRIEL, overrides)).toBeNull();
    // Semana seguinte: sem ajuste para as datas, o padrão volta sozinho.
    expect(effectiveSessionForDate('2026-10-29', GABRIEL, overrides)?.dayLabel).toBe('A');
  });

  it('chave de ajuste que não existe mais no protocolo cai no calendário padrão', () => {
    const overrides = new Map<string, string | null>([[THU, 'Z']]);
    expect(effectiveSessionForDate(THU, GABRIEL, overrides)?.dayLabel).toBe('A');
  });

  it('treino concluído trava o dia e prevalece sobre o calendário', () => {
    const slots = slotsFor(GABRIEL, WED, { [TUE]: { status: 'COMPLETED', sessionKey: 'A' } });
    expect(slots[1]).toEqual({ date: TUE, sessionKey: 'A', locked: true });
  });

  it('dias até a entrega do protocolo, já passados, ficam vazios e travados', () => {
    const slots = buildWeekSlots({
      today: THU,
      firstProtocolDate: TUE,
      structure: JOAO,
      sessionsByDate: new Map(),
    });
    expect(slots[0]).toEqual({ date: MON, sessionKey: null, locked: true });
    expect(slots[1]).toEqual({ date: TUE, sessionKey: null, locked: true });
    expect(slots[2]?.sessionKey).toBe('T3');
  });
});

describe('Gabriel: treinar em dia sem treino', () => {
  const slots = slotsFor(GABRIEL, TUE);
  // Estado real depois de antecipar o A para a terça: a quinta ficou livre.
  const afterATuesday = new Map<string, string | null>([
    [TUE, 'A'],
    [THU, null],
  ]);

  it('"posso fazer o A hoje?" antecipa o A da quinta para a terça e libera a quinta', () => {
    const result = plan(GABRIEL, slots, TUE, { kind: 'TRAIN_ON', date: TUE, sessionKey: 'A' });
    expect(result.ok).toBe(true);
    const ok = result as PlanSuccess;
    expect(layout(ok)).toMatchObject({ [TUE]: 'A', [THU]: null, [FRI]: 'B', [SUN]: 'C' });
    expect(ok.changes).toEqual([
      { date: TUE, from: null, to: 'A' },
      { date: THU, from: 'A', to: null },
    ]);
  });

  it('sem dizer a sessão, traz a próxima pendente', () => {
    const result = plan(GABRIEL, slots, TUE, { kind: 'TRAIN_ON', date: TUE }) as PlanSuccess;
    expect(layout(result)[TUE]).toBe('A');
  });

  it('pedir uma sessão fora da ordem é permitido', () => {
    const result = plan(GABRIEL, slots, TUE, {
      kind: 'TRAIN_ON',
      date: TUE,
      sessionKey: 'C',
    }) as PlanSuccess;
    expect(layout(result)).toMatchObject({ [TUE]: 'C', [SUN]: null, [THU]: 'A' });
  });

  it('numa quinta (dia do A), pedir o B pergunta o que fazer com o A (DATE_CONFLICT)', () => {
    const thu = slotsFor(GABRIEL, THU);
    expect(plan(GABRIEL, thu, THU, { kind: 'TRAIN_ON', date: THU, sessionKey: 'B' })).toEqual({
      ok: false,
      reason: 'DATE_CONFLICT',
      date: THU,
      sessionKey: 'A',
    });
  });

  it('conflito resolvido com PUSH: o B entra na quinta e o A avança para o descanso seguinte', () => {
    const thu = slotsFor(GABRIEL, THU);
    const result = plan(GABRIEL, thu, THU, {
      kind: 'TRAIN_ON',
      date: THU,
      sessionKey: 'B',
      onConflict: 'PUSH',
    }) as PlanSuccess;
    expect(layout(result)).toMatchObject({ [THU]: 'B', [FRI]: 'A', [SUN]: 'C' });
    expect(result.dropped).toEqual([]);
  });

  it('conflito resolvido com SKIP: o A fica de fora da semana e o resto não muda', () => {
    const thu = slotsFor(GABRIEL, THU);
    const result = plan(GABRIEL, thu, THU, {
      kind: 'TRAIN_ON',
      date: THU,
      sessionKey: 'B',
      onConflict: 'SKIP',
    }) as PlanSuccess;
    expect(layout(result)).toMatchObject({ [THU]: 'B', [FRI]: null, [SUN]: 'C' });
    expect(result.dropped).toEqual(['A']);
  });

  it('PUSH empurra a cadeia inteira até o próximo descanso (João: segunda cheia até quinta)', () => {
    const mon = slotsFor(JOAO, MON);
    const result = plan(JOAO, mon, MON, {
      kind: 'TRAIN_ON',
      date: TUE,
      sessionKey: 'T1',
      onConflict: 'PUSH',
    }) as PlanSuccess;
    expect(layout(result)).toMatchObject({
      [MON]: null,
      [TUE]: 'T1',
      [WED]: 'T2',
      [THU]: 'T3',
      [FRI]: 'T4',
      [SAT]: 'T5',
    });
  });

  it('PUSH sem nenhum descanso depois do dia pedido cai na semana cheia', () => {
    const full = slotsFor(
      JOAO,
      MON,
      {},
      new Map([
        [FRI, 'T5'],
        [SUN, 'T5'],
      ]),
    );
    const result = plan(JOAO, full, MON, {
      kind: 'TRAIN_ON',
      date: SAT,
      sessionKey: 'T1',
      onConflict: 'PUSH',
    });
    expect(result).toMatchObject({ ok: false });
  });

  it('pedir "treinar hoje" num dia que já tem treino não muda nada', () => {
    const thu = slotsFor(GABRIEL, THU);
    const result = plan(GABRIEL, thu, THU, { kind: 'TRAIN_ON', date: THU }) as PlanSuccess;
    expect(result.noop).toBe(true);
  });

  it('a mesma sessão duas vezes na semana não é criada: já feita', () => {
    const wed = slotsFor(
      GABRIEL,
      WED,
      { [TUE]: { status: 'COMPLETED', sessionKey: 'A' } },
      afterATuesday,
    );
    expect(plan(GABRIEL, wed, WED, { kind: 'TRAIN_ON', date: WED, sessionKey: 'A' })).toMatchObject(
      {
        ok: false,
        reason: 'ALREADY_DONE',
      },
    );
  });

  it('com o A feito, pedir "treinar hoje" traz o próximo pendente (B)', () => {
    const wed = slotsFor(
      GABRIEL,
      WED,
      { [TUE]: { status: 'COMPLETED', sessionKey: 'A' } },
      afterATuesday,
    );
    const result = plan(GABRIEL, wed, WED, { kind: 'TRAIN_ON', date: WED }) as PlanSuccess;
    expect(layout(result)).toMatchObject({ [WED]: 'B', [FRI]: null, [SUN]: 'C' });
  });

  it('semana toda feita: não há o que trazer', () => {
    const sun = slotsFor(GABRIEL, SUN, {
      [THU]: { status: 'COMPLETED', sessionKey: 'A' },
      [FRI]: { status: 'COMPLETED', sessionKey: 'B' },
      [SUN]: { status: 'COMPLETED', sessionKey: 'C' },
    });
    expect(plan(GABRIEL, sun, SUN, { kind: 'TRAIN_ON', date: SUN })).toMatchObject({
      ok: false,
      reason: 'DAY_LOCKED',
    });
    const sat = slotsFor(GABRIEL, SAT, {
      [THU]: { status: 'COMPLETED', sessionKey: 'A' },
      [FRI]: { status: 'COMPLETED', sessionKey: 'B' },
    });
    // C ainda pendente no domingo: trazer para sábado é possível.
    expect((plan(GABRIEL, sat, SAT, { kind: 'TRAIN_ON', date: SAT }) as PlanSuccess).ok).toBe(true);
  });

  it('um sessão pendente de dia passado (sem registro) pode ser feita hoje', () => {
    const fri = slotsFor(GABRIEL, FRI);
    // A ficou na quinta sem registro; sexta é B. Pedir o A na sexta (PUSH): B vai para o sábado livre.
    const result = plan(GABRIEL, fri, FRI, {
      kind: 'TRAIN_ON',
      date: FRI,
      sessionKey: 'A',
      onConflict: 'PUSH',
    }) as PlanSuccess;
    expect(layout(result)).toMatchObject({ [THU]: null, [FRI]: 'A', [SAT]: 'B', [SUN]: 'C' });
  });

  it('não há data passada nem semana futura', () => {
    expect(plan(GABRIEL, slots, TUE, { kind: 'TRAIN_ON', date: MON })).toMatchObject({
      ok: false,
      reason: 'PAST_DATE',
    });
    expect(plan(GABRIEL, slots, TUE, { kind: 'TRAIN_ON', date: '2026-10-26' })).toMatchObject({
      ok: false,
      reason: 'OUT_OF_WEEK',
    });
  });

  it('dia já treinado não muda', () => {
    const done = slotsFor(GABRIEL, TUE, { [TUE]: { status: 'COMPLETED', sessionKey: 'A' } });
    expect(
      plan(GABRIEL, done, TUE, { kind: 'TRAIN_ON', date: TUE, sessionKey: 'B' }),
    ).toMatchObject({
      ok: false,
      reason: 'DAY_LOCKED',
    });
  });

  it('chave que não existe no protocolo é recusada', () => {
    expect(
      plan(GABRIEL, slots, TUE, { kind: 'TRAIN_ON', date: TUE, sessionKey: 'Z' }),
    ).toMatchObject({
      ok: false,
      reason: 'UNKNOWN_SESSION',
    });
  });

  it('sessão deixada de fora pode voltar enquanto a cota permitir', () => {
    const reduced = slotsFor(GABRIEL, TUE, {}, new Map([[SUN, null]]));
    const result = plan(GABRIEL, reduced, TUE, {
      kind: 'TRAIN_ON',
      date: TUE,
      sessionKey: 'C',
    }) as PlanSuccess;
    expect(layout(result)).toMatchObject({ [TUE]: 'C', [THU]: 'A', [FRI]: 'B' });
  });

  it('a semana não passa dos treinos contratados', () => {
    const twoOfThree = planScheduleChange({
      today: TUE,
      slots: slotsFor(GABRIEL, TUE, {}, new Map([[SUN, null]])),
      quota: 2,
      sessionKeys: ['A', 'B', 'C'],
      request: { kind: 'TRAIN_ON', date: TUE, sessionKey: 'C' },
    });
    expect(twoOfThree).toMatchObject({ ok: false, reason: 'QUOTA_REACHED' });
  });
});

describe('João: descansar em um dia', () => {
  const tue = slotsFor(JOAO, TUE, {
    [MON]: { status: 'COMPLETED', sessionKey: 'T1' },
    [TUE]: { status: 'COMPLETED', sessionKey: 'T2' },
  });

  it('quarta vira descanso e as sessões andam até consumir o descanso de sexta', () => {
    const result = plan(JOAO, tue, TUE, { kind: 'REST_ON', date: WED }) as PlanSuccess;
    expect(layout(result)).toEqual({
      [MON]: 'T1',
      [TUE]: 'T2',
      [WED]: null,
      [THU]: 'T3',
      [FRI]: 'T4',
      [SAT]: 'T5',
      [SUN]: null,
    });
    expect(result.dropped).toEqual([]);
  });

  it('descansar num dia que já é descanso não muda nada', () => {
    const result = plan(JOAO, tue, TUE, { kind: 'REST_ON', date: FRI }) as PlanSuccess;
    expect(result.noop).toBe(true);
  });

  it('ajustes em cadeia: cada pedido parte do calendário já ajustado', () => {
    const first = plan(JOAO, tue, TUE, { kind: 'REST_ON', date: WED }) as PlanSuccess;
    const overrides = overridesFromAdjustments([
      {
        assignments: first.changes.map((change) => ({ date: change.date, sessionKey: change.to })),
      },
    ]);
    const fri = slotsFor(
      JOAO,
      FRI,
      {
        [MON]: { status: 'COMPLETED', sessionKey: 'T1' },
        [TUE]: { status: 'COMPLETED', sessionKey: 'T2' },
        [THU]: { status: 'COMPLETED', sessionKey: 'T3' },
      },
      overrides,
    );
    const second = plan(JOAO, fri, FRI, { kind: 'REST_ON', date: FRI }) as PlanSuccess;
    // O treino que ficou na sexta vai para sábado e o de sábado para domingo.
    expect(layout(second)).toMatchObject({ [FRI]: null, [SAT]: 'T4', [SUN]: 'T5' });
  });

  it('semana sem descanso para absorver: devolve quais treinos podem ficar de fora', () => {
    const full = slotsFor(
      JOAO,
      TUE,
      {},
      new Map([
        [FRI, 'T4'],
        [SUN, 'T5'],
        [THU, 'T3'],
        [WED, 'T2'],
        [SAT, null],
      ]),
    );
    // Quarta..domingo: T2 T3 T4 _ T5 → ainda há sábado livre. Preenche o sábado também.
    const filled = full.map((slot) => (slot.date === SAT ? { ...slot, sessionKey: 'T1' } : slot));
    const result = plan(JOAO, filled, TUE, { kind: 'REST_ON', date: WED });
    expect(result).toMatchObject({ ok: false, reason: 'FULL_WEEK' });
    const candidates = (result as { candidates: Array<{ date: string }> }).candidates.map(
      (c) => c.date,
    );
    expect(candidates).toEqual([WED, THU, FRI, SAT, SUN]);
  });

  it('com o treino de fora escolhido, o descanso é concedido e o resto anda', () => {
    const filled = slotsFor(
      JOAO,
      TUE,
      {},
      new Map([
        [WED, 'T2'],
        [THU, 'T3'],
        [FRI, 'T4'],
        [SAT, 'T1'],
        [SUN, 'T5'],
      ]),
    );
    const result = plan(JOAO, filled, TUE, {
      kind: 'REST_ON',
      date: WED,
      leaveOut: [{ date: SAT }],
    }) as PlanSuccess;
    expect(layout(result)).toMatchObject({
      [WED]: null,
      [THU]: 'T2',
      [FRI]: 'T3',
      [SAT]: 'T4',
      [SUN]: 'T5',
    });
    expect(result.dropped).toEqual(['T1']);
  });

  it('deixar de fora o próprio treino do dia vira descanso sem empurrar ninguém', () => {
    const result = plan(JOAO, slotsFor(JOAO, TUE), TUE, {
      kind: 'REST_ON',
      date: WED,
      leaveOut: [{ date: WED }],
    }) as PlanSuccess;
    expect(layout(result)).toMatchObject({ [WED]: null, [THU]: 'T4' });
    expect(result.dropped).toEqual(['T3']);
  });

  it('não descansa dia já treinado', () => {
    expect(plan(JOAO, tue, TUE, { kind: 'REST_ON', date: TUE })).toMatchObject({
      ok: false,
      reason: 'DAY_LOCKED',
    });
  });
});

describe('reorganizar a semana a pedido do aluno', () => {
  const week = slotsFor(JOAO, TUE);

  it('aceita qualquer arranjo que respeite os limites, inclusive deixar uma sessão de fora', () => {
    const result = plan(JOAO, week, TUE, {
      kind: 'REORGANIZE',
      placements: [
        { sessionKey: 'T3', date: THU },
        { sessionKey: 'T4', date: FRI },
        { sessionKey: 'T5', date: null },
      ],
    }) as PlanSuccess;
    expect(layout(result)).toMatchObject({
      [TUE]: 'T2',
      [WED]: null,
      [THU]: 'T3',
      [FRI]: 'T4',
      [SAT]: null,
    });
    expect(result.dropped).toEqual(['T5']);
  });

  it('recusa dois treinos no mesmo dia e dia ocupado por quem não foi citado', () => {
    expect(
      plan(JOAO, week, TUE, {
        kind: 'REORGANIZE',
        placements: [
          { sessionKey: 'T3', date: FRI },
          { sessionKey: 'T4', date: FRI },
        ],
      }),
    ).toMatchObject({ ok: false, reason: 'DUPLICATE_DATE' });
    expect(
      plan(JOAO, week, TUE, { kind: 'REORGANIZE', placements: [{ sessionKey: 'T3', date: SAT }] }),
    ).toMatchObject({ ok: false, reason: 'DATE_TAKEN', date: SAT });
  });

  it('recusa a MESMA sessão em dois dias, mesmo que as outras fiquem de fora (D6)', () => {
    expect(
      plan(JOAO, week, TUE, {
        kind: 'REORGANIZE',
        placements: [
          { sessionKey: 'T3', date: WED },
          { sessionKey: 'T3', date: SAT },
          { sessionKey: 'T4', date: null },
          { sessionKey: 'T5', date: null },
        ],
      }),
    ).toMatchObject({ ok: false, reason: 'DUPLICATE_SESSION', sessionKey: 'T3' });
  });

  it('protocolo antigo que repete a letra na semana aceita a letra repetida (tem dois slots)', () => {
    const legacy = structure([
      ['A', 'MON'],
      ['B', 'WED'],
      ['A', 'FRI'],
    ]);
    const slots = slotsFor(legacy, TUE);
    const result = plan(legacy, slots, TUE, {
      kind: 'REORGANIZE',
      placements: [
        { sessionKey: 'A', date: WED },
        { sessionKey: 'A', date: SAT },
        { sessionKey: 'B', date: null },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('recusa sessão já feita na semana', () => {
    const done = slotsFor(JOAO, WED, { [TUE]: { status: 'COMPLETED', sessionKey: 'T2' } });
    expect(
      plan(JOAO, done, WED, { kind: 'REORGANIZE', placements: [{ sessionKey: 'T2', date: THU }] }),
    ).toMatchObject({ ok: false, reason: 'ALREADY_DONE' });
  });
});

describe('registro tardio: treino feito num dia que já passou', () => {
  // Hoje é quinta; o aluno treinou o A na terça, fora do dia previsto (quinta), e quer registrar.
  const thursday = slotsFor(GABRIEL, THU);
  const late = (request: AdjustmentRequest, slots = thursday, earliestDate = TUE) =>
    planScheduleChange({
      today: THU,
      earliestDate,
      slots,
      quota: GABRIEL.weeklyFrequency,
      sessionKeys: ['A', 'B', 'C'],
      request,
    });

  it('sem a data mais antiga, dia passado continua recusado', () => {
    expect(
      plan(GABRIEL, thursday, THU, { kind: 'TRAIN_ON', date: TUE, sessionKey: 'A' }),
    ).toMatchObject({
      ok: false,
      reason: 'PAST_DATE',
    });
  });

  it('o treino vai para o dia em que foi feito e o dia previsto fica livre', () => {
    const result = late({ kind: 'TRAIN_ON', date: TUE, sessionKey: 'A' }) as PlanSuccess;
    expect(result.ok).toBe(true);
    expect(layout(result)).toMatchObject({ [TUE]: 'A', [THU]: null, [FRI]: 'B', [SUN]: 'C' });
  });

  it('dia fora da janela continua recusado', () => {
    expect(late({ kind: 'TRAIN_ON', date: MON, sessionKey: 'A' })).toMatchObject({
      ok: false,
      reason: 'PAST_DATE',
    });
  });

  it('a semana pode ser a anterior: o domingo passado é o dia 7 daquela semana', () => {
    const slots = buildWeekSlots({
      today: MON,
      anchor: '2026-10-18',
      firstProtocolDate: '2026-10-05',
      structure: GABRIEL,
      sessionsByDate: new Map(),
    });
    expect(slots.map((slot) => slot.date)).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
    ]);
    // O C do domingo passado (18/10) segue como sessão pendente daquela semana.
    expect(slots[6]?.sessionKey).toBe('C');
  });
});
