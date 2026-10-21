/**
 * Jornadas do João (5x: segunda A, terça B, quarta C, quinta D, sábado E; sexta e domingo de
 * descanso), semana de 19 a 25/10/2026, e variações do mesmo protocolo:
 *
 *  - João: treinou segunda e terça; terça à noite pede para descansar na quarta (adiantando o
 *    descanso de sexta). Quarta sem link; quinta, sexta e sábado com link e os treinos nas novas
 *    posições. Semana seguinte volta ao padrão e o C de quarta compara com o C da quinta.
 *  - Variações (outro aluno, mesmo protocolo): pedido repetido e retry (idempotência), cadeia de
 *    ajustes na mesma semana (sexta cansado, empurra para sábado/domingo; o link da sexta deixa de
 *    valer), semana cheia ("o 2"), treino deixado de fora sem virar falta.
 *  - Joana: "desfazer" (volta como estava, link novo quando hoje volta a ter treino).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { BUBBLE_SEPARATOR } from '../../src/modules/whatsapp/message-templates';
import {
  adjustmentsOf,
  attendanceAlertsOf,
  checkInCodes,
  clock,
  completionsOf,
  createStudent,
  openLink,
  runFeedback,
  say,
  session,
  sessionsOf,
  type Student,
  startWorld,
  trainToday,
  weekLayout,
  type World,
} from './support/world';

const FIVE_DAYS = () => [
  session('A', 'MON'),
  session('B', 'TUE'),
  session('C', 'WED'),
  session('D', 'THU'),
  session('E', 'SAT'),
];

let world: World;

async function sweep(date: string) {
  return world.scheduler.scan(clock(`${date} 04:00`));
}

function dailyLinkOf(student: Student, date: string) {
  return world.queues
    .whatsapp(student.userId)
    .find((job) => job.type === 'WORKOUT_DAILY_LINK' && job.dedupeId === `workout-link-${date}`);
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  world = await startWorld();
});

afterAll(async () => {
  vi.useRealTimers();
  await world?.close();
});

describe('João: terça à noite pede para descansar na quarta', () => {
  let joao: Student;

  beforeAll(async () => {
    joao = await createStudent(world, {
      name: 'João Pereira',
      sessions: FIVE_DAYS(),
      firstProtocolDate: '2026-10-11',
    });
    // Semana anterior no padrão: o C foi feito na quarta 14 com 50 kg.
    const previous: Array<[string, number]> = [
      ['2026-10-12', 60],
      ['2026-10-13', 100],
      ['2026-10-14', 50],
      ['2026-10-15', 20],
      ['2026-10-17', 15],
      ['2026-10-19', 60],
      ['2026-10-20', 100],
    ];
    for (const [date, load] of previous) {
      await sweep(date);
      await trainToday(world, joao, { start: `${date} 07:00`, load });
    }
  });

  it('quarta vira descanso, os treinos andam até consumir o descanso de sexta e sábado fica igual', async () => {
    const now = clock('2026-10-20 21:00');
    const outcome = await say(
      world,
      joao,
      'tô muito cansado, queria adiantar o descanso de sexta pra amanhã',
      {
        intent: 'AJUSTE_AGENDA',
        parsed: { action: 'DESCANSAR', date: '2026-10-21' },
        now,
      },
    );
    expect(outcome).toMatchObject({ kind: 'FIXED', adjusted: true });
    if (outcome.kind !== 'FIXED') return;
    // Hoje (terça) não mudou: nenhum link sai junto.
    expect(outcome.text.split(BUBBLE_SEPARATOR)).toHaveLength(1);
    expect(outcome.text).toContain('quarta vira dia de descanso');
    expect(outcome.text).not.toMatch(/faltou|perdeu|compensar|—/i);

    expect(await weekLayout(world, joao, now)).toEqual({
      '2026-10-19': 'A',
      '2026-10-20': 'B',
      '2026-10-21': null,
      '2026-10-22': 'C',
      '2026-10-23': 'D',
      '2026-10-24': 'E',
      '2026-10-25': null,
    });
    const [adjustment] = await adjustmentsOf(world, joao.userId);
    expect(adjustment?.kind).toBe('REST_ON');
    expect(adjustment?.assignments).toEqual([
      { date: '2026-10-21', sessionKey: null, from: 'C' },
      { date: '2026-10-22', sessionKey: 'C', from: 'D' },
      { date: '2026-10-23', sessionKey: 'D', from: null },
    ]);
  });

  it('quarta sem link; quinta, sexta e sábado com link e os treinos nas novas posições', async () => {
    await sweep('2026-10-21');
    expect(dailyLinkOf(joao, '2026-10-21')).toBeUndefined();

    const expected: Array<[string, string, number]> = [
      ['2026-10-22', 'Costas', 52.5],
      ['2026-10-23', 'Ombros', 22],
      ['2026-10-24', 'Ombros e Core', 16],
    ];
    for (const [date, focus, load] of expected) {
      await sweep(date);
      const link = dailyLinkOf(joao, date);
      expect(link?.text).toContain(`*${focus}*`);
      // Nenhuma pergunta de "treino sem registro" pela quarta que virou descanso.
      expect(link?.followupId).toBeUndefined();
      const [code] = checkInCodes(link?.text ?? '');
      const opened = await openLink(world, code as string);
      expect(opened.userId).toBe(joao.userId);
      const workout = await trainToday(world, joao, { start: `${date} 07:00`, load });
      expect(workout.prescription.focus).toBe(focus);
    }
  });

  it('segue analisado normalmente: o C de quinta compara com o C da quarta passada', async () => {
    const thursday = (await sessionsOf(world, joao.userId)).find(
      (row) => row.date === '2026-10-22',
    );
    const { call } = await runFeedback(world, joao, thursday?.id as string);
    expect(call?.messages[0]?.content).toContain(
      'ÚLTIMA VEZ que o aluno fez este mesmo treino (quarta-feira, 14/10 (há 8 dias))',
    );
  });

  it('sem alerta de frequência e sem "sem registro" na quarta; check-in não inventa treino', async () => {
    await sweep('2026-10-25');
    const now = clock('2026-10-25 18:00');
    expect(await world.journal.dayStatus(joao.userId, '2026-10-21', now)).toEqual({
      kind: 'REST',
    });
    await world.completion.recordFromCheckin(joao.userId, 9);
    const week = (await completionsOf(world, joao.userId)).filter(
      (row) => row.date >= '2026-10-19',
    );
    expect(week.map((row) => `${row.date}:${row.sessionKey}`)).toEqual([
      '2026-10-19:A',
      '2026-10-20:B',
      '2026-10-22:C',
      '2026-10-23:D',
      '2026-10-24:E',
    ]);
    expect(await attendanceAlertsOf(world, joao.userId)).toEqual([]);
  });

  it('semana seguinte volta ao padrão e o C de quarta compara com o C de quinta da semana anterior', async () => {
    expect(await weekLayout(world, joao, clock('2026-10-26 08:00'))).toEqual({
      '2026-10-26': 'A',
      '2026-10-27': 'B',
      '2026-10-28': 'C',
      '2026-10-29': 'D',
      '2026-10-30': null,
      '2026-10-31': 'E',
      '2026-11-01': null,
    });
    await sweep('2026-10-26');
    await trainToday(world, joao, { start: '2026-10-26 07:00', load: 62 });
    await sweep('2026-10-27');
    await trainToday(world, joao, { start: '2026-10-27 07:00', load: 102 });
    await sweep('2026-10-28');
    expect(dailyLinkOf(joao, '2026-10-28')?.text).toContain('*Costas*');

    const view = await world.journal.journal(joao.userId, undefined, clock('2026-10-28 06:55'));
    const firstSet = view.workout?.sets.find((set) => set.setNumber === 1);
    expect(firstSet?.previous).toMatchObject({ date: '2026-10-22', loadValue: 52.5 });

    const workout = await trainToday(world, joao, { start: '2026-10-28 07:00', load: 55 });
    const { call } = await runFeedback(world, joao, workout.id);
    expect(call?.messages[0]?.content).toContain(
      'ÚLTIMA VEZ que o aluno fez este mesmo treino (quinta-feira, 22/10 (há 6 dias))',
    );
    expect(await attendanceAlertsOf(world, joao.userId)).toEqual([]);
  });
});

describe('Variações do João: repetição, cadeia de ajustes e semana cheia', () => {
  let jv: Student;
  let fridayLinkCode = '';

  beforeAll(async () => {
    jv = await createStudent(world, {
      name: 'Jonas Vieira',
      sessions: FIVE_DAYS(),
      firstProtocolDate: '2026-10-18',
    });
  });

  it('pedido repetido em duas mensagens seguidas aplica uma vez só', async () => {
    clock('2026-10-19 07:00');
    await trainToday(world, jv, { start: '2026-10-19 07:00', load: 40 });
    await trainToday(world, jv, { start: '2026-10-20 07:00', load: 40 });

    const ask = (minute: string) =>
      say(world, jv, 'amanhã quero descansar', {
        intent: 'AJUSTE_AGENDA',
        parsed: { action: 'DESCANSAR', date: '2026-10-21' },
        now: clock(`2026-10-20 21:${minute}`),
      });
    const first = await ask('00');
    const second = await ask('01');
    expect(first).toMatchObject({ kind: 'FIXED', adjusted: true });
    expect(second).toMatchObject({ kind: 'FIXED', adjusted: false });
    if (second.kind === 'FIXED') expect(second.text).toMatch(/Quarta já é dia de descanso/);
    expect(await adjustmentsOf(world, jv.userId)).toHaveLength(1);
  });

  it('retry do mesmo job (mesmo operationId) não grava o ajuste duas vezes', async () => {
    // O retry recalcula a partir do calendário já ajustado; e, no banco, a chave de
    // idempotência barra uma segunda gravação mesmo que o plano viesse igual.
    const ctx = await world.schedule.weekContext(jv.userId, clock('2026-10-20 21:05'));
    if (!ctx) throw new Error('sem contexto de semana');
    const plan = {
      ok: true as const,
      noop: false,
      changes: [{ date: '2026-10-25', from: null, to: 'E' }],
      dropped: [],
      slots: ctx.slots,
    };
    const meta = { kind: 'REORGANIZE' as const, idempotencyKey: 'chat:op-retry' };
    const once = await world.schedule.apply(jv.userId, ctx, plan, meta);
    const again = await world.schedule.apply(jv.userId, ctx, plan, meta);
    expect(once.created).toBe(true);
    expect(again).toEqual({ adjustmentId: once.adjustmentId, created: false });
    const rows = await adjustmentsOf(world, jv.userId);
    expect(rows.filter((row) => row.idempotencyKey === 'chat:op-retry')).toHaveLength(1);
    // Volta ao estado do teste anterior para a jornada seguir.
    const undo = await world.schedule.undoLast(jv.userId);
    expect(undo.status).toBe('UNDONE');
  });

  it('cadeia: na sexta, cansado, descansa de novo e o D e o E andam para sábado e domingo', async () => {
    await sweep('2026-10-22');
    await trainToday(world, jv, { start: '2026-10-22 07:00', load: 40 });
    await sweep('2026-10-23');
    const fridayLink = dailyLinkOf(jv, '2026-10-23');
    expect(fridayLink?.text).toContain('*Ombros*');
    fridayLinkCode = checkInCodes(fridayLink?.text ?? '')[0] as string;

    const now = clock('2026-10-23 07:30');
    const outcome = await say(
      world,
      jv,
      'estou acabado hoje, posso descansar e jogar pra frente?',
      {
        intent: 'AJUSTE_AGENDA',
        parsed: { action: 'DESCANSAR', date: '2026-10-23' },
        now,
      },
    );
    expect(outcome).toMatchObject({ kind: 'FIXED', adjusted: true });
    expect(await weekLayout(world, jv, now)).toEqual({
      '2026-10-19': 'A',
      '2026-10-20': 'B',
      '2026-10-21': null,
      '2026-10-22': 'C',
      '2026-10-23': null,
      '2026-10-24': 'D',
      '2026-10-25': 'E',
    });
    const active = (await adjustmentsOf(world, jv.userId)).filter((row) => !row.undoneAt);
    expect(active.map((row) => row.kind)).toEqual(['REST_ON', 'REST_ON']);
  });

  it('o link das 04:00 da sexta deixou de valer (a sexta virou descanso) e a linha PLANNED some', async () => {
    await expect(openLink(world, fridayLinkCode)).rejects.toThrow(/expirou|utilizado/);
    const friday = (await sessionsOf(world, jv.userId)).find((row) => row.date === '2026-10-23');
    expect(friday).toBeUndefined();
    expect(
      await world.journal.dayStatus(jv.userId, '2026-10-23', clock('2026-10-24 08:00')),
    ).toEqual({ kind: 'REST' });
  });

  it('semana cheia: o Coach pergunta qual treino fica de fora e "o 2" conclui o pedido', async () => {
    await sweep('2026-10-24');
    const now = clock('2026-10-24 08:00');
    const question = await say(world, jv, 'hoje não vai dar, quero descansar', {
      intent: 'AJUSTE_AGENDA',
      parsed: { action: 'DESCANSAR', date: '2026-10-24' },
      now,
    });
    expect(question).toMatchObject({ kind: 'FIXED', adjusted: false });
    if (question.kind !== 'FIXED') return;
    expect(question.text).toContain('Essa semana está cheia');
    expect(question.text).toMatch(/1\. \*Sábado\*: D \(Ombros\)/);
    expect(question.text).toMatch(/2\. \*Domingo\*: E \(Ombros e Core\)/);
    expect(await world.flow.hasOpenFlow(jv.userId)).toBe(true);

    // A pergunta em aberto viaja para a IA, que aponta a opção 2 (data e chave da lista).
    const answer = await say(world, jv, 'o 2', {
      intent: 'PAPO_CASUAL',
      parsed: { action: 'ESCOLHA', leaveOut: [{ date: '2026-10-25', sessionKey: 'E' }] },
      now: clock('2026-10-24 08:02'),
    });
    const parserInput = world.llm.callsFor('schedule_request_parse').at(-1)?.messages[0]?.content;
    expect(parserInput).toContain('Qual treino fica de fora da semana? Opções: 1) 2026-10-24');
    expect(answer).toMatchObject({ kind: 'FIXED', adjusted: true });
    if (answer.kind === 'FIXED') {
      expect(answer.text).toContain('fica de fora desta semana');
      expect(answer.text).not.toMatch(/faltou|perdeu|compensar/i);
    }
    expect(await world.flow.hasOpenFlow(jv.userId)).toBe(false);
    expect(await weekLayout(world, jv, clock('2026-10-24 08:03'))).toMatchObject({
      '2026-10-24': null,
      '2026-10-25': 'D',
    });
    const last = (await adjustmentsOf(world, jv.userId)).at(-1);
    expect(last?.dropped).toEqual(['E']);
  });

  it('o treino deixado de fora não vira "sem registro" nem conta no alerta de faltas', async () => {
    await sweep('2026-10-25');
    expect(dailyLinkOf(jv, '2026-10-25')?.text).toContain('*Ombros*');
    await trainToday(world, jv, { start: '2026-10-25 09:00', load: 22 });

    await sweep('2026-10-26');
    const now = clock('2026-10-26 08:00');
    const window = await world.journal.attendanceWindow(jv.userId, '2026-10-26', now, 14);
    expect(window.filter((day) => day.status.kind === 'MISSED')).toEqual([]);
    expect(await attendanceAlertsOf(world, jv.userId)).toEqual([]);
    const { state } = await world.context.loadEpisodic(jv.userId, '2026-10-26');
    expect(state.retrato).toMatchObject({ ultimasDuasSemanas: { semRegistro: [] } });
  });
});

/**
 * Comportamento ATUAL documentado (observação O2 do relatório): uma mensagem de outro assunto
 * no meio da pergunta "qual treino fica de fora" encerra a pergunta. Um "o 2" depois disso já
 * não é entendido como escolha e segue para a conversa normal da IA, sem o contexto da lista.
 */
describe('semana cheia com uma mensagem de outro assunto no meio', () => {
  it('o assunto novo solta a pergunta e o "o 2" seguinte não é mais tratado como escolha', async () => {
    const jade = await createStudent(world, {
      name: 'Jade Rocha',
      sessions: [
        session('A', 'MON'),
        session('B', 'TUE'),
        session('C', 'WED'),
        session('D', 'THU'),
        session('E', 'FRI'),
        session('F', 'SAT'),
        session('G', 'SUN'),
      ],
      firstProtocolDate: '2026-10-18',
      biologicalSex: 'FEMALE',
    });
    const question = await say(world, jade, 'hoje quero descansar', {
      intent: 'AJUSTE_AGENDA',
      parsed: { action: 'DESCANSAR', date: '2026-10-22' },
      now: clock('2026-10-22 08:00'),
    });
    if (question.kind === 'FIXED') expect(question.text).toContain('Essa semana está cheia');

    const aside = await say(world, jade, 'aliás, qual a carga do supino?', {
      intent: 'DUVIDA_TECNICA',
      parsed: { action: 'OUTRO' },
      now: clock('2026-10-22 08:01'),
    });
    expect(aside).toEqual({ kind: 'NOT_HANDLED' });
    expect(await world.flow.hasOpenFlow(jade.userId)).toBe(false);

    const choice = await say(world, jade, 'o 2', {
      intent: 'PAPO_CASUAL',
      now: clock('2026-10-22 08:02'),
    });
    expect(choice).toEqual({ kind: 'NOT_HANDLED' });
    expect(await adjustmentsOf(world, jade.userId)).toEqual([]);
  });
});

describe('Joana: desfazer', () => {
  let joana: Student;

  beforeAll(async () => {
    joana = await createStudent(world, {
      name: 'Joana Lima',
      sessions: FIVE_DAYS(),
      firstProtocolDate: '2026-10-18',
      biologicalSex: 'FEMALE',
    });
  });

  it('desfazer volta como estava e, se hoje voltou a ter treino, manda link novo', async () => {
    await say(world, joana, 'amanhã quero descansar', {
      intent: 'AJUSTE_AGENDA',
      parsed: { action: 'DESCANSAR', date: '2026-10-21' },
      now: clock('2026-10-20 21:00'),
    });
    await sweep('2026-10-21');
    expect(dailyLinkOf(joana, '2026-10-21')).toBeUndefined();

    const now = clock('2026-10-21 08:00');
    // "desfazer" é reconhecido por regra: não gasta IA.
    const calls = world.llm.callsFor('schedule_request_parse').length;
    const outcome = await say(world, joana, 'pensando melhor, desfaz', {
      intent: 'AJUSTE_AGENDA',
      now,
    });
    expect(world.llm.callsFor('schedule_request_parse')).toHaveLength(calls);
    expect(outcome).toMatchObject({ kind: 'FIXED', adjusted: true });
    if (outcome.kind !== 'FIXED') return;
    const [undone, link] = outcome.text.split(BUBBLE_SEPARATOR);
    expect(undone).toContain('voltei como estava');
    expect(link).toMatch(/^Bom dia, \*Joana\*!/);
    expect(link).toContain('*Costas*');
    expect(await weekLayout(world, joana, now)).toMatchObject({
      '2026-10-21': 'C',
      '2026-10-22': 'D',
      '2026-10-23': null,
    });
    const [row] = await adjustmentsOf(world, joana.userId);
    expect(row?.undoneAt).not.toBeNull();
  });

  it('desfazer de novo não tem o que desfazer', async () => {
    const outcome = await say(world, joana, 'desfaz', {
      intent: 'AJUSTE_AGENDA',
      now: clock('2026-10-21 08:05'),
    });
    expect(outcome).toMatchObject({ kind: 'FIXED', adjusted: false });
    if (outcome.kind === 'FIXED') expect(outcome.text).toContain('Não tenho nenhum ajuste recente');
  });

  it('ajuste cujo dia já foi treinado não é desfeito', async () => {
    await trainToday(world, joana, { start: '2026-10-21 18:00', load: 30 });
    await say(world, joana, 'amanhã não vou poder treinar', {
      intent: 'AJUSTE_AGENDA',
      parsed: { action: 'DESCANSAR', date: '2026-10-22' },
      now: clock('2026-10-21 20:00'),
    });
    await trainToday(world, joana, { start: '2026-10-23 07:00', load: 30 });
    const outcome = await say(world, joana, 'desfaz', {
      intent: 'AJUSTE_AGENDA',
      now: clock('2026-10-23 09:00'),
    });
    if (outcome.kind === 'FIXED') expect(outcome.text).toContain('já foi usado');
  });

  // Regressão do defeito D2 (achado pela QA em 2026-10-20, corrigido): `undoLast` não olha a semana. O ajuste vale até domingo e expira
  // sozinho; na segunda seguinte "desfazer" reescreve a semana que já passou (o sábado que era
  // descanso volta a ter treino e aparece como "sem registro").
  it('na semana seguinte, "desfazer" não mexe no ajuste da semana passada (já expirou)', async () => {
    await say(world, joana, 'sábado não vou conseguir, passa pro domingo', {
      intent: 'AJUSTE_AGENDA',
      parsed: { action: 'DESCANSAR', date: '2026-10-24' },
      now: clock('2026-10-23 20:00'),
    });
    const monday = clock('2026-10-26 08:00');
    const before = await world.journal.dayStatus(joana.userId, '2026-10-24', monday);
    const outcome = await say(world, joana, 'desfaz', { intent: 'AJUSTE_AGENDA', now: monday });
    const after = await world.journal.dayStatus(joana.userId, '2026-10-24', monday);
    expect(after).toEqual(before);
    expect(outcome).toMatchObject({ kind: 'FIXED', adjusted: false });
  });
});
