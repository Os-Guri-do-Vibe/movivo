/**
 * Jornada da Giovana (3x: terça A, quinta B, sábado C): recebeu o link às 04:00 da terça 20/10;
 * às 11:00 a troca de exercício que pediu é aprovada (rosca direta → rosca martelo); ela ainda
 * não treinou. O treino de hoje é atualizado no lugar (qualquer link mostra o exercício novo) e
 * o Coach pergunta se ela quer um link novo. "sim" → link novo na hora, com a saudação do horário
 * local, e o anterior deixa de valer; "não" → mantém o link. Quem já começou o treino não recebe
 * pergunta. Troca aprovada antes das 04:00 simplesmente sai no link do dia.
 *
 * Cada variação é um aluno diferente no mesmo banco (o que também prova que um não interfere no
 * outro). A versão nova do protocolo é publicada como o repositório de protocolo faz e o job da
 * fila `workout-protocol-changed` é processado pelo worker real.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { WorkoutProtocolChangedJob } from '../../src/modules/jobs/workout-protocol-changed.contract';
import {
  checkInCodes,
  clock,
  createStudent,
  openLink,
  publishVersion,
  say,
  session,
  sessionsOf,
  structureOf,
  type Student,
  startWorld,
  type World,
} from './support/world';

let world: World;

const SESSIONS = () => [session('A', 'TUE'), session('B', 'THU'), session('C', 'SAT')];

/** A troca aprovada: rosca direta vira rosca martelo no treino A. */
function withHammerCurl(student: Student) {
  return structureOf(
    student.structure.sessions.map((item) =>
      item.dayLabel !== 'A'
        ? item
        : {
            ...item,
            exercises: item.exercises.map((exercise) =>
              exercise.exerciseId === 'rosca_direta_barra'
                ? {
                    ...exercise,
                    exerciseId: 'rosca_martelo_halter',
                    name: 'Rosca martelo com halter',
                  }
                : exercise,
            ),
          },
    ),
  );
}

/** Aprovação da troca + o job que os dois produtores (CREF no painel e worker automático) enfileiram. */
async function approveSubstitution(student: Student, local: string) {
  const at = clock(local);
  const version = await publishVersion(world, student, withHammerCurl(student), at);
  const job: WorkoutProtocolChangedJob = {
    userId: student.userId,
    reason: 'SUBSTITUTION',
    protocolVersion: version,
  };
  return world.protocolChanged.process({ data: job } as never);
}

async function newStudent(name: string) {
  return createStudent(world, {
    name,
    sessions: SESSIONS(),
    firstProtocolDate: '2026-10-12',
    biologicalSex: 'FEMALE',
  });
}

function exercisesOfToday(view: Awaited<ReturnType<World['journal']['journal']>>) {
  return view.workout?.prescription.exercises.map((exercise) => exercise.exerciseId);
}

function todayLinkCode(student: Student) {
  const link = world.queues
    .whatsapp(student.userId)
    .find((job) => job.dedupeId === 'workout-link-2026-10-20');
  return checkInCodes(link?.text ?? '')[0] as string;
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  world = await startWorld();
});

afterAll(async () => {
  vi.useRealTimers();
  await world?.close();
});

describe('Giovana: troca aprovada às 11:00, ainda não treinou, responde "sim"', () => {
  let giovana: Student;
  let oldCode = '';
  let workoutId = '';

  beforeAll(async () => {
    giovana = await newStudent('Giovana Ribeiro');
    await world.scheduler.scan(clock('2026-10-20 04:00'));
    oldCode = todayLinkCode(giovana);
    const rows = await sessionsOf(world, giovana.userId);
    workoutId = rows.find((row) => row.date === '2026-10-20')?.id as string;
  });

  it('o treino de hoje é atualizado no lugar e o Coach pergunta (depois da entrega do protocolo)', async () => {
    expect(oldCode).toBeTruthy();
    await expect(approveSubstitution(giovana, '2026-10-20 11:00')).resolves.toEqual({
      status: 'OFFERED',
    });

    const [row] = (await sessionsOf(world, giovana.userId)).filter(
      (item) => item.date === '2026-10-20',
    );
    // Mesma linha (os links que apontam para ela continuam válidos), prescrição nova.
    expect(row?.id).toBe(workoutId);
    expect(row?.status).toBe('PLANNED');
    expect(row?.prescription.exercises.map((exercise) => exercise.exerciseId)).toContain(
      'rosca_martelo_halter',
    );

    const offerJob = world.queues.of('whatsapp-outbound').at(-1);
    expect(offerJob?.opts.delay).toBe(90_000);
    const offer = world.queues.whatsapp(giovana.userId).at(-1);
    expect(offer?.type).toBe('COACH_MESSAGE');
    expect(offer?.text).toMatch(/^Bom dia, \*Giovana\*!/);
    expect(offer?.text).toContain('A troca de exercício que você pediu já foi aprovada');
    expect(offer?.text).toContain('responder *sim*');
    expect(await world.flow.hasOpenFlow(giovana.userId)).toBe(true);

    const view = await world.journal.journal(giovana.userId, undefined, clock('2026-10-20 11:05'));
    expect(exercisesOfToday(view)).toEqual(['supino_reto_barra', 'rosca_martelo_halter']);
  });

  it('"sim" às 13:30: link novo na hora com "Boa tarde", sem gastar IA, e o antigo deixa de abrir', async () => {
    const parserCalls = world.llm.calls.length;
    const outcome = await say(world, giovana, 'sim', {
      intent: 'SAUDACAO',
      now: clock('2026-10-20 13:30'),
    });
    expect(world.llm.calls).toHaveLength(parserCalls);
    expect(outcome).toMatchObject({ kind: 'FIXED', adjusted: false });
    if (outcome.kind !== 'FIXED') return;
    expect(outcome.text).toMatch(/^Boa tarde, \*Giovana\*!/);
    expect(outcome.text).toContain('já está com o exercício atualizado');
    expect(outcome.text).toContain('o anterior deixou de valer');
    expect(await world.flow.hasOpenFlow(giovana.userId)).toBe(false);

    await expect(openLink(world, oldCode)).rejects.toThrow(/expirou|utilizado/);
    const [newCode] = checkInCodes(outcome.text);
    const opened = await openLink(world, newCode as string);
    expect(opened.userId).toBe(giovana.userId);
    const view = await world.journal.journal(giovana.userId, undefined, clock('2026-10-20 13:31'));
    expect(view.workout?.id).toBe(workoutId);
    expect(exercisesOfToday(view)).toContain('rosca_martelo_halter');
  });

  it('o mesmo aviso de versão processado de novo não pergunta outra vez', async () => {
    const before = world.queues.whatsapp(giovana.userId).length;
    const again = await world.protocolChanged.process({
      data: { userId: giovana.userId, reason: 'SUBSTITUTION', protocolVersion: 2 },
    } as never);
    expect(again).toEqual({ status: 'NOT_NEEDED' });
    expect(world.queues.whatsapp(giovana.userId)).toHaveLength(before);
  });
});

describe('Variações da troca aprovada no dia', () => {
  it('"não": mantém o link atual, que segue abrindo e já mostra o exercício novo', async () => {
    const gina = await newStudent('Gina Alves');
    await world.scheduler.scan(clock('2026-10-20 04:00'));
    const code = todayLinkCode(gina);
    await approveSubstitution(gina, '2026-10-20 11:00');

    const outcome = await say(world, gina, 'não precisa', {
      intent: 'SAUDACAO',
      now: clock('2026-10-20 11:10'),
    });
    expect(outcome).toMatchObject({ kind: 'FIXED' });
    if (outcome.kind === 'FIXED') {
      expect(outcome.text).toContain('O seu link continua valendo');
      expect(checkInCodes(outcome.text)).toEqual([]);
    }
    const opened = await openLink(world, code);
    expect(opened.userId).toBe(gina.userId);
    const view = await world.journal.journal(gina.userId, undefined, clock('2026-10-20 11:11'));
    expect(exercisesOfToday(view)).toContain('rosca_martelo_halter');
  });

  it('outro assunto não responde a oferta: ela segue esperando o "sim"', async () => {
    const gil = await newStudent('Gilda Moraes');
    await world.scheduler.scan(clock('2026-10-20 04:00'));
    await approveSubstitution(gil, '2026-10-20 11:00');
    const outcome = await say(world, gil, 'qual a carga do supino hoje?', {
      intent: 'DUVIDA_TECNICA',
      now: clock('2026-10-20 11:20'),
    });
    expect(outcome).toEqual({ kind: 'NOT_HANDLED' });
    expect(await world.flow.hasOpenFlow(gil.userId)).toBe(true);
  });

  it('quem já começou o treino não recebe pergunta nem link; o treino em andamento não muda', async () => {
    const gabi = await newStudent('Gabriela Nunes');
    await world.scheduler.scan(clock('2026-10-20 04:00'));
    const now = clock('2026-10-20 10:00');
    const view = await world.journal.journal(gabi.userId, undefined, now);
    await world.journal.start(gabi.userId, view.workout?.id as string, now);
    const before = world.queues.whatsapp(gabi.userId).length;

    await expect(approveSubstitution(gabi, '2026-10-20 11:00')).resolves.toEqual({
      status: 'NOT_NEEDED',
    });
    expect(world.queues.whatsapp(gabi.userId)).toHaveLength(before);
    expect(await world.flow.hasOpenFlow(gabi.userId)).toBe(false);
    const [row] = (await sessionsOf(world, gabi.userId)).filter(
      (item) => item.date === '2026-10-20',
    );
    expect(row?.status).toBe('IN_PROGRESS');
    expect(row?.prescription.exercises.map((exercise) => exercise.exerciseId)).toContain(
      'rosca_direta_barra',
    );
  });

  it('aprovada à noite: a pergunta e o link novo dizem "Boa noite"', async () => {
    const gisele = await newStudent('Gisele Prado');
    await world.scheduler.scan(clock('2026-10-20 04:00'));
    await approveSubstitution(gisele, '2026-10-20 19:10');
    expect(world.queues.whatsapp(gisele.userId).at(-1)?.text).toMatch(/^Boa noite, \*Gisele\*!/);
    const outcome = await say(world, gisele, 'pode mandar', {
      intent: 'SAUDACAO',
      now: clock('2026-10-20 19:15'),
    });
    if (outcome.kind === 'FIXED') expect(outcome.text).toMatch(/^Boa noite, \*Gisele\*!/);
  });

  it('troca aprovada antes das 04:00: sem pergunta, e o link do dia já sai com o exercício novo', async () => {
    const gaia = await newStudent('Gaia Torres');
    await expect(approveSubstitution(gaia, '2026-10-20 02:00')).resolves.toEqual({
      status: 'NOT_NEEDED',
    });
    expect(world.queues.whatsapp(gaia.userId)).toEqual([]);
    await world.scheduler.scan(clock('2026-10-20 04:00'));
    const code = todayLinkCode(gaia);
    await openLink(world, code);
    const view = await world.journal.journal(gaia.userId, undefined, clock('2026-10-20 06:00'));
    expect(exercisesOfToday(view)).toContain('rosca_martelo_halter');
  });

  it('falha de Redis/banco ao oferecer nunca derruba a publicação (o worker devolve NOT_NEEDED)', async () => {
    const gaby = await newStudent('Gaby Rocha');
    await world.scheduler.scan(clock('2026-10-20 04:00'));
    world.redis.down = true;
    try {
      await expect(approveSubstitution(gaby, '2026-10-20 11:00')).resolves.toEqual({
        status: 'NOT_NEEDED',
      });
    } finally {
      world.redis.down = false;
    }
    // O treino foi atualizado mesmo assim (a escrita no banco veio antes do Redis).
    const view = await world.journal.journal(gaby.userId, undefined, clock('2026-10-20 11:05'));
    expect(exercisesOfToday(view)).toContain('rosca_martelo_halter');
  });
});
