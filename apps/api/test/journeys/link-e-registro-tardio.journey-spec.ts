/**
 * Jornadas do pedido de link ("me manda o link") e do registro tardio ("treinei ontem e não
 * consegui registrar"), com o banco real.
 *
 * Link: reenvia na hora com a saudação do horário local, revoga o anterior, segura toques
 * repetidos, responde certo em dia de descanso e com treino já feito, e um link pedido de
 * madrugada impede o envio duplicado das 04:00.
 *
 * Registro tardio: o link abre o diário no dia (`&date=`), sem cronômetro; o treino conta no dia
 * em que foi feito; o calendário concorda com o histórico; não há card de compartilhamento; o
 * Coach fala "treino de ontem"; fora da janela de 2 dias é recusado; dia de descanso exige dizer
 * qual treino foi feito.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  adjustmentsOf,
  checkInCodes,
  clock,
  completionsOf,
  createStudent,
  finishInput,
  magicTokensOf,
  openLink,
  runFeedback,
  say,
  session,
  sessionsOf,
  sets,
  type Student,
  startWorld,
  trainToday,
  weekLayout,
  type World,
} from './support/world';

let world: World;

/** 3x: segunda A, quarta B, sexta C. */
const SESSIONS = () => [session('A', 'MON'), session('B', 'WED'), session('C', 'FRI')];

function dailyLink(student: Student, date: string) {
  return world.queues
    .whatsapp(student.userId)
    .find((job) => job.dedupeId === `workout-link-${date}`);
}

function textOf(outcome: Awaited<ReturnType<typeof say>>): string {
  if (outcome.kind !== 'FIXED') throw new Error('o fluxo não respondeu');
  return outcome.text;
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  world = await startWorld();
});

afterAll(async () => {
  vi.useRealTimers();
  await world?.close();
});

describe('pedido do link do check-in diário', () => {
  let lia: Student;
  let first = '';
  let second = '';

  beforeAll(async () => {
    lia = await createStudent(world, {
      name: 'Lia Campos',
      sessions: SESSIONS(),
      firstProtocolDate: '2026-10-12',
      biologicalSex: 'FEMALE',
    });
    await world.scheduler.scan(clock('2026-10-21 04:00'));
    first = checkInCodes(dailyLink(lia, '2026-10-21')?.text ?? '')[0] as string;
  });

  it('"me manda o link": reenvia na hora (sem IA), com saudação local, e o anterior deixa de valer', async () => {
    const calls = world.llm.calls.length;
    const text = textOf(
      await say(world, lia, 'me manda o link do treino de hoje', {
        intent: 'PEDIDO_LINK_TREINO',
        now: clock('2026-10-21 07:00'),
      }),
    );
    expect(world.llm.calls).toHaveLength(calls);
    expect(text).toMatch(/^Bom dia, \*Lia\*!/);
    expect(text).toContain('Aqui está o link do seu check-in diário de hoje, *Pernas*');
    second = checkInCodes(text)[0] as string;
    expect(second).not.toBe(first);
    await expect(openLink(world, first)).rejects.toThrow(/expirou|utilizado/);
    await expect(openLink(world, second)).resolves.toMatchObject({ userId: lia.userId });
  });

  it('toque repetido em menos de 1 minuto não gera outro link', async () => {
    const tokens = (await magicTokensOf(world, lia.userId)).length;
    const text = textOf(
      await say(world, lia, 'manda de novo', {
        intent: 'PEDIDO_LINK_TREINO',
        now: clock('2026-10-21 07:00'),
      }),
    );
    expect(text).toContain('O link acabou de ir para você');
    expect(await magicTokensOf(world, lia.userId)).toHaveLength(tokens);
  });

  it('passado o intervalo mínimo, reenvia de novo', async () => {
    const text = textOf(
      await say(world, lia, 'perdi o link', {
        intent: 'PEDIDO_LINK_TREINO',
        now: clock('2026-10-21 07:02'),
      }),
    );
    expect(checkInCodes(text)).toHaveLength(1);
  });

  it('em dia de descanso responde que hoje é descanso e não cria link', async () => {
    const tokens = (await magicTokensOf(world, lia.userId)).length;
    const text = textOf(
      await say(world, lia, 'cadê meu check-in?', {
        intent: 'PEDIDO_LINK_TREINO',
        now: clock('2026-10-22 09:00'),
      }),
    );
    expect(text).toContain('Hoje é dia de descanso no seu plano');
    expect(await magicTokensOf(world, lia.userId)).toHaveLength(tokens);
  });

  it('pedido de madrugada (03:30) sai com "Boa noite" e a varredura das 04:00 não manda outro', async () => {
    const text = textOf(
      await say(world, lia, 'me manda o link', {
        intent: 'PEDIDO_LINK_TREINO',
        now: clock('2026-10-23 03:30'),
      }),
    );
    expect(text).toMatch(/^Boa noite, \*Lia\*!/);
    await world.scheduler.scan(clock('2026-10-23 04:00'));
    expect(dailyLink(lia, '2026-10-23')).toBeUndefined();
  });

  it('com o treino de hoje já registrado, diz que está feito em vez de mandar link', async () => {
    await trainToday(world, lia, { start: '2026-10-23 07:00', load: 20 });
    const text = textOf(
      await say(world, lia, 'me manda o link', {
        intent: 'PEDIDO_LINK_TREINO',
        now: clock('2026-10-23 20:00'),
      }),
    );
    expect(text).toContain('O seu treino de hoje (*Costas*) já está registrado');
    expect(checkInCodes(text)).toEqual([]);
  });
});

describe('registro tardio de um treino previsto (treinou ontem, não registrou)', () => {
  let rui: Student;
  let lateCode = '';
  let workoutId = '';

  beforeAll(async () => {
    rui = await createStudent(world, {
      name: 'Rui Teixeira',
      sessions: SESSIONS(),
      firstProtocolDate: '2026-10-12',
    });
    await world.scheduler.scan(clock('2026-10-19 04:00'));
  });

  it('"treinei ontem e não consegui registrar": abre o treino de ontem sem cronômetro e manda o link', async () => {
    const outcome = await say(world, rui, 'treinei ontem mas não consegui registrar', {
      intent: 'AJUSTE_AGENDA',
      parsed: { action: 'REGISTRAR', date: '2026-10-19' },
      now: clock('2026-10-20 08:00'),
    });
    expect(outcome).toMatchObject({ kind: 'FIXED', adjusted: true });
    const text = textOf(outcome);
    expect(text).toMatch(/^Bom dia, \*Rui\*!/);
    expect(text).toContain('registrar o seu treino de ontem (*Peito e Bíceps*)');
    expect(text).toContain('sem cronômetro');
    lateCode = checkInCodes(text)[0] as string;

    const [monday] = (await sessionsOf(world, rui.userId)).filter(
      (row) => row.date === '2026-10-19',
    );
    expect(monday).toMatchObject({ status: 'IN_PROGRESS', loggedLate: true, startedAt: null });
    workoutId = monday?.id as string;
    // O treino previsto era o do dia: nada a remarcar.
    expect(await adjustmentsOf(world, rui.userId)).toEqual([]);
    // O link de ontem (04:00 de segunda) não foi revogado por isso.
    const tokens = await magicTokensOf(world, rui.userId);
    expect(tokens.filter((token) => token.revokedAt)).toEqual([]);
  });

  it('o link abre o diário no dia do treino e o registro termina sem tempo inventado', async () => {
    const opened = await openLink(world, lateCode);
    expect(opened.date).toBe('2026-10-19');
    const now = clock('2026-10-20 08:10');
    const view = await world.journal.journal(rui.userId, opened.date ?? undefined, now);
    expect(view.selectedDate).toBe('2026-10-19');
    expect(view.workout).toMatchObject({ id: workoutId, status: 'IN_PROGRESS', loggedLate: true });
    expect(view.workout?.canLogLate).toBe(false);

    await world.journal.saveSets(
      rui.userId,
      workoutId,
      sets(view.workout?.prescription as never, 30),
    );
    await world.journal.finish(rui.userId, workoutId, finishInput(8));
    const [done] = (await sessionsOf(world, rui.userId)).filter((row) => row.date === '2026-10-19');
    expect(done).toMatchObject({ status: 'COMPLETED', durationSeconds: null, startedAt: null });

    // Conta no dia em que foi feito, não no dia do registro.
    expect(await completionsOf(world, rui.userId)).toEqual([
      { date: '2026-10-19', sessionKey: 'A', source: 'WEB_JOURNAL' },
    ]);
    // Sem cronômetro não há card de compartilhamento (ele mostra o tempo de treino).
    const after = await world.journal.journal(rui.userId, '2026-10-19', clock('2026-10-20 08:12'));
    expect(after.workout?.shareCard).toBeUndefined();
    expect(
      await world.journal.dayStatus(rui.userId, '2026-10-19', clock('2026-10-20 08:12')),
    ).toEqual({ kind: 'DONE' });
  });

  it('o comentário do Coach fala do "treino de ontem"', async () => {
    const { call } = await runFeedback(world, rui, workoutId);
    expect(call?.system).toContain('registrar o treino de ontem');
    expect(world.queues.whatsapp(rui.userId).at(-1)?.text).toMatch(
      /^Acabei de analisar os resultados do seu treino de ontem!/,
    );
  });

  it('a pergunta de "treino sem registro" não sai pela segunda que foi registrada depois', async () => {
    await world.scheduler.scan(clock('2026-10-21 04:00'));
    const wednesday = dailyLink(rui, '2026-10-21');
    expect(wednesday?.text).toContain('*Pernas*');
    expect(wednesday?.followupId).toBeUndefined();
  });

  it('fora da janela de 2 dias é recusado, pelo Coach e pelo endpoint', async () => {
    const text = textOf(
      await say(world, rui, 'treinei segunda e esqueci de registrar', {
        intent: 'AJUSTE_AGENDA',
        parsed: { action: 'REGISTRAR', date: '2026-10-19' },
        now: clock('2026-10-23 08:00'),
      }),
    );
    expect(text).toContain('até 2 dias atrás');

    // Quarta 21 tem linha PLANNED (link das 04:00) e ficou sem registro: sexta já passou da janela.
    const [wednesday] = (await sessionsOf(world, rui.userId)).filter(
      (row) => row.date === '2026-10-21',
    );
    await expect(
      world.journal.startLate(rui.userId, wednesday?.id as string, clock('2026-10-24 08:00')),
    ).rejects.toThrow(/ultimos 2 dias/);
    // E o treino de hoje não é "tardio": usa o Iniciar.
    await world.scheduler.scan(clock('2026-10-23 04:00'));
    const [friday] = (await sessionsOf(world, rui.userId)).filter(
      (row) => row.date === '2026-10-23',
    );
    await expect(
      world.journal.startLate(rui.userId, friday?.id as string, clock('2026-10-23 09:00')),
    ).rejects.toThrow(/use "Iniciar"/);
  });

  it('pelo diário (botão "Registrar este treino"): dia recente sem registro pode ser aberto', async () => {
    const now = clock('2026-10-22 09:00');
    const view = await world.journal.journal(rui.userId, '2026-10-21', now);
    expect(view.workout).toMatchObject({ status: 'PLANNED', canLogLate: true });
    await world.journal.startLate(rui.userId, view.workout?.id as string, now);
    // Idempotente: tocar de novo não muda nada.
    await world.journal.startLate(rui.userId, view.workout?.id as string, now);
    const reopened = await world.journal.journal(rui.userId, '2026-10-21', now);
    expect(reopened.workout).toMatchObject({ status: 'IN_PROGRESS', loggedLate: true });
  });
});

describe('registro tardio num dia de descanso: o aluno diz qual treino fez', () => {
  let rosa: Student;

  beforeAll(async () => {
    rosa = await createStudent(world, {
      name: 'Rosa Duarte',
      sessions: SESSIONS(),
      firstProtocolDate: '2026-10-12',
      biologicalSex: 'FEMALE',
    });
    await world.scheduler.scan(clock('2026-10-23 04:00'));
  });

  it('sem dizer o treino, o Coach pergunta, com as opções do protocolo', async () => {
    const text = textOf(
      await say(world, rosa, 'ontem consegui treinar e esqueci de registrar', {
        intent: 'AJUSTE_AGENDA',
        parsed: { action: 'REGISTRAR', date: '2026-10-22' },
        now: clock('2026-10-23 09:00'),
      }),
    );
    expect(text).toContain('Qual treino você fez nesse dia?');
    expect(text).toContain('C (Costas)');
    expect(await world.flow.hasOpenFlow(rosa.userId)).toBe(true);
  });

  it('"fiz o C": o C vai para quinta, a sexta fica livre e o link de hoje (C) deixa de valer', async () => {
    const fridayCode = checkInCodes(dailyLink(rosa, '2026-10-23')?.text ?? '')[0] as string;
    const outcome = await say(world, rosa, 'fiz o C', {
      intent: 'PAPO_CASUAL',
      parsed: { action: 'REGISTRAR', sessionKey: 'C' },
      now: clock('2026-10-23 09:02'),
    });
    const text = textOf(outcome);
    expect(text).toContain('registrar o seu treino de ontem (*Costas*)');
    expect(await weekLayout(world, rosa, clock('2026-10-23 09:03'))).toMatchObject({
      '2026-10-22': 'C',
      '2026-10-23': null,
    });
    const [adjustment] = await adjustmentsOf(world, rosa.userId);
    expect(adjustment).toMatchObject({ kind: 'LATE_LOG', source: 'LATE_LOG' });
    await expect(openLink(world, fridayCode)).rejects.toThrow(/expirou|utilizado/);

    // Registro tardio não é "desfazível" pelo chat (o que o aluno viveu vale mais que o plano).
    const undo = textOf(
      await say(world, rosa, 'desfaz', { intent: 'AJUSTE_AGENDA', now: clock('2026-10-23 09:05') }),
    );
    expect(undo).toContain('Não tenho nenhum ajuste recente');
  });
});

// Regressão do defeito D4 (achado pela QA em 2026-10-20, corrigido): no dia da entrega do 1º protocolo o planejador trava o dia como
// "antes do início", então o registro tardio pergunta qual treino foi feito mesmo havendo treino
// previsto, e grava um ajuste LATE_LOG desnecessário.
describe('registro tardio no dia da entrega do protocolo', () => {
  it('abre direto o treino previsto do dia, sem perguntar e sem ajuste', async () => {
    const tito = await createStudent(world, {
      name: 'Tito Brandão',
      sessions: SESSIONS(),
      firstProtocolDate: '2026-10-19',
    });
    const outcome = await say(world, tito, 'treinei ontem e não registrei', {
      intent: 'AJUSTE_AGENDA',
      parsed: { action: 'REGISTRAR', date: '2026-10-19' },
      now: clock('2026-10-20 08:00'),
    });
    expect(outcome).toMatchObject({ kind: 'FIXED', adjusted: true });
    expect(await adjustmentsOf(world, tito.userId)).toEqual([]);
  });
});
