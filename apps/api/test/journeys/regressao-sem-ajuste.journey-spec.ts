/**
 * Regressão: o aluno que NUNCA pede ajuste continua exatamente como antes da agenda flexível.
 *
 * Os consumidores trocaram o calendário fixo (`sessionForWeekday`/`sessionFor`/
 * `plannedDaysBefore`) pelo efetivo. Sem ajuste, o efetivo tem de coincidir com o fixo em tudo:
 * varredura das 04:00 (link com e sem a pergunta do treino sem registro), alerta de frequência,
 * check-in semanal, contexto/retrato do Coach, comentário pós-treino e card de compartilhamento.
 * As expectativas são calculadas com as funções ANTIGAS (`workout-schedule.ts`), não com as novas.
 *
 * Também: renovação de mesociclo com ajustes antigos de OUTRO protocolo não quebra nada.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { protocols, protocolVersions } from '../../src/core/database/schema';
import {
  dayKey,
  plannedDaysBefore,
  sessionFor,
  sessionForWeekday,
} from '../../src/modules/workout/workout-schedule';
import {
  attendanceAlertsOf,
  clock,
  completionsOf,
  createStudent,
  instant,
  runFeedback,
  say,
  session,
  structureOf,
  type Student,
  startWorld,
  trainToday,
  weekLayout,
  type World,
} from './support/world';

let world: World;

const SESSIONS = () => [session('A', 'MON'), session('B', 'WED'), session('C', 'FRI')];

function dailyLink(student: Student, date: string) {
  return world.queues
    .whatsapp(student.userId)
    .find((job) => job.dedupeId === `workout-link-${date}`);
}

function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (
    let at = Date.parse(`${from}T12:00:00Z`);
    at <= Date.parse(`${to}T12:00:00Z`);
    at += 86_400_000
  ) {
    dates.push(new Date(at).toISOString().slice(0, 10));
  }
  return dates;
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  world = await startWorld();
});

afterAll(async () => {
  vi.useRealTimers();
  await world?.close();
});

describe('Beto treina tudo e nunca pede ajuste: o efetivo coincide com o calendário antigo', () => {
  let beto: Student;

  beforeAll(async () => {
    beto = await createStudent(world, {
      name: 'Beto Martins',
      sessions: SESSIONS(),
      firstProtocolDate: '2026-10-11',
    });
    for (const date of datesBetween('2026-10-12', '2026-10-22')) {
      await world.scheduler.scan(clock(`${date} 04:00`));
      if (dailyLink(beto, date))
        await trainToday(world, beto, { start: `${date} 07:00`, load: 50 });
    }
  });

  it('o link das 04:00 sai exatamente nos dias do calendário antigo, sem pergunta', async () => {
    const dates = datesBetween('2026-10-12', '2026-10-22');
    const withLink = dates.filter((date) => dailyLink(beto, date));
    const legacy = dates.filter((date) =>
      sessionForWeekday(new Date(`${date}T12:00:00Z`).getUTCDay(), beto.structure),
    );
    expect(withLink).toEqual(legacy);
    for (const date of withLink) {
      const link = dailyLink(beto, date);
      expect(link?.text).toMatch(/^Bom dia, \*Beto\*!/);
      expect(link?.followupId).toBeUndefined();
    }
  });

  it('a varredura repetida (inclusive "forçar") não reenvia nem muda a decisão do dia', async () => {
    const before = world.queues.whatsapp(beto.userId).length;
    await world.scheduler.scan(clock('2026-10-21 04:00'));
    await world.scheduler.scan(clock('2026-10-21 09:00'), { force: true });
    expect(world.queues.whatsapp(beto.userId)).toHaveLength(before);
  });

  it('a semana efetiva e o contexto do Coach batem com o calendário antigo; nada "remarcado"', async () => {
    const now = clock('2026-10-21 10:00');
    const layout = await weekLayout(world, beto, now);
    for (const [date, key] of Object.entries(layout)) {
      const legacy = sessionForWeekday(new Date(`${date}T12:00:00Z`).getUTCDay(), beto.structure);
      // Dias antes da entrega do protocolo ficam vazios (regra antiga do diário).
      if (date > '2026-10-11') expect(key).toBe(legacy?.dayLabel ?? null);
    }
    const { state } = await world.context.loadEpisodic(beto.userId, dayKey(now));
    expect(state.treinoDeHojeSegundoCalendario).toEqual(sessionFor(now, beto.structure));
    const agenda = state.agendaDaSemana as Array<{ remarcado: boolean }>;
    expect(agenda.every((day) => !day.remarcado)).toBe(true);
  });

  it('comentário pós-treino de sempre ("treino de hoje") e card de compartilhamento presente', async () => {
    const now = clock('2026-10-21 08:00');
    const view = await world.journal.journal(beto.userId, '2026-10-21', now);
    expect(view.workout?.status).toBe('COMPLETED');
    expect(view.workout?.loggedLate).toBe(false);
    expect(view.workout?.shareCard?.workout.durationSeconds).toBe(50 * 60);
    const { call } = await runFeedback(world, beto, view.workout?.id as string);
    expect(call?.system).toContain('registrar o treino de hoje');
    // A comparação continua com a última vez do MESMO treino (quarta passada).
    expect(call?.messages[0]?.content).toContain('(quarta-feira, 14/10 (há 7 dias))');
  });

  it('check-in semanal atribui as conclusões aos mesmos dias que o calendário antigo', async () => {
    // Domingo 25, 18h: sem treinar na sexta 23; o aluno diz que seguiu "metade" (1 treino).
    for (const date of datesBetween('2026-10-23', '2026-10-25')) {
      await world.scheduler.scan(clock(`${date} 04:00`));
    }
    const sunday = clock('2026-10-25 18:00');
    const expected = plannedDaysBefore(sunday, 7, beto.structure).slice(-1);
    await world.completion.recordFromCheckin(beto.userId, 5);
    const rows = await completionsOf(world, beto.userId);
    expect(expected).toEqual([{ completedAt: '2026-10-23', sessionKey: 'C' }]);
    expect(rows).toContainEqual({ date: '2026-10-23', sessionKey: 'C', source: 'CHECKIN' });
  });
});

describe('Ana falta e nunca pede ajuste: pergunta do treino sem registro e alerta seguem iguais', () => {
  let ana: Student;

  beforeAll(async () => {
    ana = await createStudent(world, {
      name: 'Ana Costa',
      sessions: SESSIONS(),
      firstProtocolDate: '2026-10-11',
      biologicalSex: 'FEMALE',
    });
    for (const date of ['2026-10-12', '2026-10-14', '2026-10-16']) {
      await world.scheduler.scan(clock(`${date} 04:00`));
      await trainToday(world, ana, { start: `${date} 07:00`, load: 20 });
    }
  });

  it('primeira falta (segunda): o link de quarta leva a pergunta sobre a segunda', async () => {
    for (const date of datesBetween('2026-10-19', '2026-10-21')) {
      await world.scheduler.scan(clock(`${date} 04:00`));
    }
    const wednesday = dailyLink(ana, '2026-10-21');
    expect(wednesday?.followupId).toBeDefined();
    expect(wednesday?.text).toContain('Peito e Bíceps');
    expect(wednesday?.text).toMatch(/segunda/i);
    expect(wednesday?.fallbackText).toMatch(/^Bom dia, \*Ana\*!/);
  });

  it('segunda falta seguida: o link de sexta vai sem pergunta', async () => {
    await world.scheduler.scan(clock('2026-10-22 04:00'));
    await world.scheduler.scan(clock('2026-10-23 04:00'));
    expect(dailyLink(ana, '2026-10-23')?.followupId).toBeUndefined();
    expect(await attendanceAlertsOf(world, ana.userId)).toEqual([]);
  });

  it('terceira falta seguida: o profissional CREF recebe o alerta de frequência', async () => {
    for (const date of datesBetween('2026-10-24', '2026-10-26')) {
      await world.scheduler.scan(clock(`${date} 04:00`));
    }
    expect(await attendanceAlertsOf(world, ana.userId)).toEqual([{ reason: 'FALTAS_SEGUIDAS' }]);
  });
});

describe('renovação de mesociclo com ajustes antigos de outro protocolo', () => {
  let caio: Student;

  beforeAll(async () => {
    caio = await createStudent(world, {
      name: 'Caio Fernandes',
      sessions: [session('A', 'THU'), session('B', 'FRI'), session('C', 'SUN')],
      firstProtocolDate: '2026-10-12',
    });
  });

  it('o ajuste do protocolo antigo não vaza para o novo, e o novo segue o próprio padrão', async () => {
    await say(world, caio, 'posso fazer o A hoje?', {
      intent: 'AJUSTE_AGENDA',
      parsed: { action: 'TREINAR', date: '2026-10-20', sessionKey: 'A' },
      now: clock('2026-10-20 10:00'),
    });
    await trainToday(world, caio, { start: '2026-10-20 18:00', load: 40 });

    // Quarta 21: o profissional publica o mesociclo 2 (chaves e dias diferentes).
    const renewedAt = instant('2026-10-21 09:00');
    const next = structureOf([
      { ...session('A', 'TUE'), dayLabel: 'Treino 1', focus: 'Superiores' },
      { ...session('B', 'THU'), dayLabel: 'Treino 2', focus: 'Inferiores' },
    ]);
    await world.db.admin
      .update(protocols)
      .set({ status: 'SUPERSEDED' })
      .where(eq(protocols.id, caio.protocolId));
    const [renewed] = await world.db.admin
      .insert(protocols)
      .values({
        userId: caio.userId,
        status: 'ACTIVE',
        content: next,
        constraints: {},
        mesocycleName: 'Mesociclo 2',
        mesocycleNumber: 2,
        startDate: renewedAt,
        endDate: new Date(renewedAt.getTime() + 42 * 86_400_000),
        totalWeeks: 6,
      })
      .returning({ id: protocols.id });
    await world.db.admin.insert(protocolVersions).values({
      protocolId: renewed?.id as string,
      userId: caio.userId,
      version: 1,
      status: 'ACTIVE',
      content: next,
      createdAt: renewedAt,
    });
    caio = { ...caio, protocolId: renewed?.id as string, structure: next };

    const now = clock('2026-10-22 08:00');
    // Quinta 22 era descanso pelo ajuste do protocolo antigo; no novo, quinta é o Treino 2.
    // Terça 20 fica com o A já treinado (dia travado), mesmo sendo dia do Treino 1 no novo.
    expect(await weekLayout(world, caio, now)).toEqual({
      '2026-10-19': null,
      '2026-10-20': 'A',
      '2026-10-21': null,
      '2026-10-22': 'Treino 2',
      '2026-10-23': null,
      '2026-10-24': null,
      '2026-10-25': null,
    });
    await world.scheduler.scan(clock('2026-10-22 04:00'));
    expect(dailyLink(caio, '2026-10-22')?.text).toContain('*Inferiores*');
    const view = await world.journal.journal(caio.userId, undefined, now);
    expect(view.workout?.prescription.dayLabel).toBe('Treino 2');
    await expect(
      world.journal.attendanceWindow(caio.userId, '2026-10-22', now, 14),
    ).resolves.toHaveLength(14);

    // E um pedido novo usa as chaves do protocolo novo.
    const outcome = await say(world, caio, 'hoje não dá, faço o treino 2 no sábado', {
      intent: 'AJUSTE_AGENDA',
      parsed: { action: 'TREINAR', date: '2026-10-24', sessionKey: 'Treino 2' },
      now: clock('2026-10-22 09:00'),
    });
    expect(outcome).toMatchObject({ kind: 'FIXED', adjusted: true });
    expect(await weekLayout(world, caio, clock('2026-10-22 09:01'))).toMatchObject({
      '2026-10-22': null,
      '2026-10-24': 'Treino 2',
    });
  });

  // Regressão do defeito D5 (achado pela QA em 2026-10-20, corrigido): a recusa por cota usa a copy de "semana concluída" ("você já
  // fechou os N treinos, parabéns!") mesmo quando ainda há treino previsto e não feito.
  it('recusa por cota não diz que o aluno "já fechou" a semana quando ainda falta treino', async () => {
    // Semana do Caio: A (feito, protocolo antigo) + Treino 2 no sábado = cota 2 do protocolo novo.
    const outcome = await say(world, caio, 'consigo fazer o treino 1 no domingo também?', {
      intent: 'AJUSTE_AGENDA',
      parsed: { action: 'TREINAR', date: '2026-10-25', sessionKey: 'Treino 1' },
      now: clock('2026-10-22 10:00'),
    });
    expect(outcome.kind).toBe('FIXED');
    if (outcome.kind === 'FIXED') expect(outcome.text).not.toContain('já fechou');
  });
});
