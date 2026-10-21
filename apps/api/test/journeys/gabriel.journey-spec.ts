/**
 * Jornada do Gabriel (3x: quinta A, sexta B, domingo C), semana de 19 a 25/10/2026.
 *
 * Na terça (dia de descanso) ele pede "posso fazer o Treino A hoje?". O Coach atende sem
 * confirmar: o A vai para terça, a quinta vira descanso, o link do dia sai junto. Ele treina,
 * o Coach comenta comparando com a última vez que fez o A. Daí para frente nada pode tratar a
 * quinta como "sem registro", o alerta de frequência não pode disparar, o check-in semanal
 * atribui o A à terça e o contexto do Coach enxerga a agenda efetiva. Na semana seguinte a
 * agenda volta ao padrão e o A de quinta compara com o da terça.
 *
 * Passos em sequência (é uma jornada): cada `it` parte do estado deixado pelo anterior.
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

let world: World;
let gabriel: Student;
let tuesdayWorkoutId = '';
let linkCode = '';

/** Varredura das 04:00 do dia (fuso de São Paulo, o do Gabriel). */
async function sweep(date: string) {
  return world.scheduler.scan(clock(`${date} 04:00`));
}

function dailyLinks() {
  return world.queues
    .whatsapp(gabriel.userId)
    .filter((job) => job.type === 'WORKOUT_DAILY_LINK')
    .map((job) => job.dedupeId);
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  world = await startWorld();
  gabriel = await createStudent(world, {
    name: 'Gabriel Souza',
    sessions: [session('A', 'THU'), session('B', 'FRI'), session('C', 'SUN')],
    // Protocolo entregue na segunda 12: a primeira semana inteira é a de 12 a 18.
    firstProtocolDate: '2026-10-12',
  });
  // Semana anterior vivida no calendário padrão: A na quinta 15 (35 kg), B e C nos seus dias.
  await sweep('2026-10-15');
  await trainToday(world, gabriel, { start: '2026-10-15 18:00', load: 35 });
  await sweep('2026-10-16');
  await trainToday(world, gabriel, { start: '2026-10-16 18:00', load: 80 });
  await sweep('2026-10-18');
  await trainToday(world, gabriel, { start: '2026-10-18 10:00', load: 30 });
});

afterAll(async () => {
  vi.useRealTimers();
  await world?.close();
});

describe('Gabriel: treina o A na terça, dia que era de descanso', () => {
  it('na terça às 04:00 não recebe link: terça é descanso no plano', async () => {
    await sweep('2026-10-19');
    await sweep('2026-10-20');
    expect(dailyLinks()).not.toContain('workout-link-2026-10-20');
  });

  it('"posso fazer o Treino A hoje?": A vai para terça, quinta vira descanso e o link sai junto', async () => {
    const now = clock('2026-10-20 10:00');
    const outcome = await say(
      world,
      gabriel,
      'hoje meu dia foi tranquilo, posso fazer o treino A hoje?',
      {
        intent: 'AJUSTE_AGENDA',
        parsed: { action: 'TREINAR', date: '2026-10-20', sessionKey: 'A' },
        now,
        operationId: 'op-gabriel-terca',
      },
    );

    expect(outcome).toMatchObject({ kind: 'FIXED', adjusted: true });
    if (outcome.kind !== 'FIXED') return;
    const [confirmation, linkBubble, ...rest] = outcome.text.split(BUBBLE_SEPARATOR);
    expect(rest).toEqual([]);
    expect(confirmation).toMatch(/A \(Peito e Bíceps\)/);
    expect(confirmation).toMatch(/\*Quinta\*: descanso/);
    expect(confirmation).toContain('desfazer');
    // Às 10:00 locais a saudação é "Bom dia", com o primeiro nome.
    expect(linkBubble).toMatch(/^Bom dia, \*Gabriel\*!/);
    const codes = checkInCodes(linkBubble ?? '');
    expect(codes).toHaveLength(1);
    linkCode = codes[0] as string;
    // O link vai na própria resposta do Coach, não como mensagem proativa à parte.
    expect(world.queues.whatsapp(gabriel.userId).map((job) => job.dedupeId)).not.toContain(
      'workout-link-2026-10-20',
    );

    expect(await weekLayout(world, gabriel, now)).toEqual({
      '2026-10-19': null,
      '2026-10-20': 'A',
      '2026-10-21': null,
      '2026-10-22': null,
      '2026-10-23': 'B',
      '2026-10-24': null,
      '2026-10-25': 'C',
    });

    const [adjustment, ...others] = await adjustmentsOf(world, gabriel.userId);
    expect(others).toEqual([]);
    expect(adjustment).toMatchObject({
      kind: 'TRAIN_ON',
      source: 'CHAT',
      protocolId: gabriel.protocolId,
      idempotencyKey: 'chat:op-gabriel-terca',
      undoneAt: null,
      dropped: [],
    });
    expect(adjustment?.assignments).toEqual([
      { date: '2026-10-20', sessionKey: 'A', from: null },
      { date: '2026-10-22', sessionKey: null, from: 'A' },
    ]);
    // Nenhum texto livre do aluno na tabela de ajustes: só datas e chaves.
    expect(JSON.stringify(adjustment)).not.toMatch(/tranquilo|posso/);
  });

  it('o link abre o diário no treino A de hoje, com a carga da última vez que fez o A', async () => {
    clock('2026-10-20 17:55');
    const opened = await openLink(world, linkCode);
    expect(opened.userId).toBe(gabriel.userId);
    expect(opened.date).toBeNull();

    const view = await world.journal.journal(gabriel.userId, undefined, clock('2026-10-20 18:00'));
    expect(view.workout?.prescription.dayLabel).toBe('A');
    expect(view.workout?.status).toBe('PLANNED');
    const supino = view.workout?.sets.find(
      (set) => set.exerciseId === 'supino_reto_barra' && set.setNumber === 1,
    );
    expect(supino?.previous).toMatchObject({ date: '2026-10-15', loadValue: 35 });
  });

  it('treina, registra e o Coach compara com a última vez que fez o A (quinta passada)', async () => {
    const workout = await trainToday(world, gabriel, { start: '2026-10-20 18:00', load: 40 });
    tuesdayWorkoutId = workout.id;

    expect(await completionsOf(world, gabriel.userId)).toContainEqual({
      date: '2026-10-20',
      sessionKey: 'A',
      source: 'WEB_JOURNAL',
    });
    expect(world.queues.of('workout-feedback').map((job) => job.opts.jobId)).toContain(
      `workout-feedback-${workout.id}`,
    );

    const { result, call } = await runFeedback(world, gabriel, workout.id);
    expect(result).toEqual({ status: 'SENT' });
    expect(call?.system).toContain('registrar o treino de hoje');
    const prompt = call?.messages[0]?.content ?? '';
    expect(prompt).toContain(
      'ÚLTIMA VEZ que o aluno fez este mesmo treino (quinta-feira, 15/10 (há 5 dias))',
    );
    expect(prompt).toMatch(/Supino reto com barra — série 1: 35kg/);
    const comment = world.queues.whatsapp(gabriel.userId).at(-1);
    expect(comment?.text).toMatch(/^Acabei de analisar os resultados do seu treino de hoje!/);
  });

  it('o contexto do Coach enxerga a agenda efetiva (hoje é o A, quinta é descanso remarcado)', async () => {
    clock('2026-10-20 19:30');
    const { state } = await world.context.loadEpisodic(gabriel.userId, '2026-10-20');
    expect(state.treinoDeHojeSegundoCalendario).toMatchObject({ dayLabel: 'A' });
    const agenda = state.agendaDaSemana as Array<{
      dia: string;
      treino: string;
      situacao: string;
      remarcado: boolean;
    }>;
    expect(agenda.find((day) => day.dia.startsWith('terça'))).toMatchObject({
      treino: 'A (Peito e Bíceps)',
      situacao: 'feito',
      remarcado: true,
    });
    expect(agenda.find((day) => day.dia.startsWith('quinta'))).toMatchObject({
      treino: 'descanso',
      situacao: 'descanso',
      remarcado: true,
    });
    expect(agenda.find((day) => day.dia.startsWith('sexta'))).toMatchObject({
      treino: 'B (Pernas)',
      situacao: 'previsto',
      remarcado: false,
    });

    clock('2026-10-22 09:00');
    const thursday = await world.context.loadEpisodic(gabriel.userId, '2026-10-22');
    expect(thursday.state.treinoDeHojeSegundoCalendario).toBe(
      'Hoje não é dia de treino previsto no protocolo.',
    );
  });

  it('quarta e quinta às 04:00 não sai link (quinta virou descanso); sexta sai o B', async () => {
    await sweep('2026-10-21');
    await sweep('2026-10-22');
    await sweep('2026-10-23');
    const links = dailyLinks();
    expect(links).not.toContain('workout-link-2026-10-21');
    expect(links).not.toContain('workout-link-2026-10-22');
    expect(links).toContain('workout-link-2026-10-23');
    const friday = world.queues
      .whatsapp(gabriel.userId)
      .find((job) => job.dedupeId === 'workout-link-2026-10-23');
    expect(friday?.text).toContain('*Pernas*');
    // Nenhuma pergunta de "treino sem registro" pela quinta.
    expect(friday?.followupId).toBeUndefined();

    await trainToday(world, gabriel, { start: '2026-10-23 18:00', load: 85 });
  });

  it('nada vira "sem registro" indevido: a quinta é descanso para o diário, o retrato e o alerta', async () => {
    const now = clock('2026-10-24 12:00');
    expect(await world.journal.dayStatus(gabriel.userId, '2026-10-22', now)).toEqual({
      kind: 'REST',
    });
    const saturday = await world.journal.journal(gabriel.userId, '2026-10-24', now);
    const states = Object.fromEntries(saturday.week.map((day) => [day.date, day.state]));
    expect(states).toMatchObject({
      '2026-10-18': 'COMPLETED',
      '2026-10-20': 'COMPLETED',
      '2026-10-21': 'REST',
      '2026-10-22': 'REST',
      '2026-10-23': 'COMPLETED',
    });
    const window = await world.journal.attendanceWindow(gabriel.userId, '2026-10-24', now, 14);
    expect(window.filter((day) => day.status.kind === 'MISSED')).toEqual([]);

    const { state } = await world.context.loadEpisodic(gabriel.userId, '2026-10-24');
    // 15 A, 16 B, 18 C, 20 A (remarcado) e 23 B: a quinta 22 não é prevista.
    expect(state.retrato).toMatchObject({
      ultimasDuasSemanas: { semRegistro: [], treinosPrevistos: 5, treinosRegistrados: 5 },
    });
    expect(await attendanceAlertsOf(world, gabriel.userId)).toEqual([]);
  });

  it('check-in semanal (domingo 18h) atribui o A à terça, sem inventar treino na quinta', async () => {
    await sweep('2026-10-24');
    await sweep('2026-10-25');
    clock('2026-10-25 18:00');
    await world.completion.recordFromCheckin(gabriel.userId, 9);

    const rows = await completionsOf(world, gabriel.userId);
    const thisWeek = rows.filter((row) => row.date >= '2026-10-19');
    expect(thisWeek.map((row) => `${row.date}:${row.sessionKey}`)).toEqual([
      '2026-10-20:A',
      '2026-10-23:B',
    ]);
    // Um registro por dia/sessão: o check-in não duplicou o que o diário já tinha.
    expect(new Set(rows.map((row) => `${row.date}:${row.sessionKey}`)).size).toBe(rows.length);
  });

  it('a semana seguinte volta ao padrão sozinha: o link da quinta 29 é o A de novo', async () => {
    const monday = clock('2026-10-26 08:00');
    expect(await weekLayout(world, gabriel, monday)).toEqual({
      '2026-10-26': null,
      '2026-10-27': null,
      '2026-10-28': null,
      '2026-10-29': 'A',
      '2026-10-30': 'B',
      '2026-10-31': null,
      '2026-11-01': 'C',
    });
    for (const date of ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29']) await sweep(date);
    const links = dailyLinks();
    expect(links).not.toContain('workout-link-2026-10-27');
    expect(links).toContain('workout-link-2026-10-29');
    expect(await attendanceAlertsOf(world, gabriel.userId)).toEqual([]);
  });

  it('na quinta 29 o placeholder mostra a carga da terça passada e o Coach compara com ela', async () => {
    const now = clock('2026-10-29 17:50');
    const view = await world.journal.journal(gabriel.userId, undefined, now);
    expect(view.workout?.prescription.dayLabel).toBe('A');
    const supino = view.workout?.sets.find(
      (set) => set.exerciseId === 'supino_reto_barra' && set.setNumber === 1,
    );
    expect(supino?.previous).toMatchObject({ date: '2026-10-20', loadValue: 40 });

    const workout = await trainToday(world, gabriel, { start: '2026-10-29 18:00', load: 42.5 });
    const { call } = await runFeedback(world, gabriel, workout.id);
    const prompt = call?.messages[0]?.content ?? '';
    expect(prompt).toContain(
      'ÚLTIMA VEZ que o aluno fez este mesmo treino (terça-feira, 20/10 (há 9 dias))',
    );
    expect(prompt).toMatch(/Supino reto com barra — série 1: 40kg/);
    expect(tuesdayWorkoutId).not.toBe(workout.id);

    const sessions = await sessionsOf(world, gabriel.userId);
    // A quinta 22 nunca ganhou linha de treino (nem PLANNED esquecida).
    expect(sessions.find((row) => row.date === '2026-10-22')).toBeUndefined();
  });
});
