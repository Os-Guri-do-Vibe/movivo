/**
 * Pedido para um dia que já tem treino (21/10/2026, quarta): "quero fazer o treino de hoje
 * amanhã, mas amanhã eu já tenho treino". O Coach não troca os dois de lugar nem recusa: pergunta
 * se o aluno prefere pular o treino de amanhã ou empurrar os treinos até o próximo descanso, e
 * aplica a escolha ("1" ou "2"), mostrando a semana que ficou.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  adjustmentsOf,
  clock,
  createStudent,
  say,
  session,
  type Student,
  startWorld,
  weekLayout,
  type World,
} from './support/world';

let world: World;
let pushing: Student;
let skipping: Student;

const sessions = () => [session('A', 'TUE'), session('B', 'WED'), session('C', 'THU')];

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  world = await startWorld();
  pushing = await createStudent(world, {
    name: 'Aluno Empurra',
    sessions: sessions(),
    firstProtocolDate: '2026-10-12',
  });
  skipping = await createStudent(world, {
    name: 'Aluno Pula',
    sessions: sessions(),
    firstProtocolDate: '2026-10-12',
  });
});

afterAll(async () => {
  vi.useRealTimers();
  await world?.close();
});

async function askToMoveTodayToTomorrow(student: Student, operationId: string) {
  return say(world, student, 'quero fazer o treino de hoje amanhã', {
    intent: 'AJUSTE_AGENDA',
    parsed: { action: 'TREINAR', date: 'AMANHA', sessionKey: 'B' },
    now: clock('2026-10-21 12:00'),
    operationId,
  });
}

describe('dia pedido já tem treino', () => {
  it('pergunta antes de mexer e não grava nada', async () => {
    const outcome = await askToMoveTodayToTomorrow(pushing, 'op-conflito-1');
    expect(outcome).toMatchObject({ kind: 'FIXED', adjusted: false });
    if (outcome.kind !== 'FIXED') return;
    expect(outcome.text).toContain('Pular');
    expect(outcome.text).toContain('Empurrar');
    expect(await adjustmentsOf(world, pushing.userId)).toHaveLength(0);
  });

  it('"2": empurra a semana (B na quinta, C na sexta) e mostra o novo arranjo', async () => {
    const outcome = await say(world, pushing, '2', {
      intent: 'AJUSTE_AGENDA',
      now: clock('2026-10-21 12:01'),
      operationId: 'op-conflito-2',
    });
    expect(outcome).toMatchObject({ kind: 'FIXED', adjusted: true });
    expect(await weekLayout(world, pushing, clock('2026-10-21 12:02'))).toMatchObject({
      '2026-10-21': null,
      '2026-10-22': 'B',
      '2026-10-23': 'C',
    });
  });

  it('"1": pula o treino de amanhã (C fica de fora) e o resto não muda', async () => {
    await askToMoveTodayToTomorrow(skipping, 'op-conflito-3');
    const outcome = await say(world, skipping, '1', {
      intent: 'AJUSTE_AGENDA',
      now: clock('2026-10-21 12:01'),
      operationId: 'op-conflito-4',
    });
    expect(outcome).toMatchObject({ kind: 'FIXED', adjusted: true });
    if (outcome.kind !== 'FIXED') return;
    expect(outcome.text).toContain('fica de fora desta semana');
    expect(await weekLayout(world, skipping, clock('2026-10-21 12:02'))).toMatchObject({
      '2026-10-21': null,
      '2026-10-22': 'B',
      '2026-10-23': null,
    });
    const [adjustment] = await adjustmentsOf(world, skipping.userId);
    expect(adjustment?.dropped).toEqual(['C']);
  });
});
