import { describe, expect, it } from 'vitest';

import type { ValidationContext } from '../../core/agents/agent-task';
import {
  missedSessionMessageValidators,
  missedSessionPlanValidators,
  type MissedSessionInput,
  type MissedSessionMessageInput,
  type MissedSessionPlan,
} from './missed-session-tasks';

const ctx: ValidationContext = { state: {}, methodology: {} };

const input = (over: Partial<MissedSessionInput> = {}): MissedSessionInput => ({
  missed: [
    {
      date: '2026-11-02',
      title: 'Força A',
      priority: 'KEY',
      modality: 'STRENGTH',
      estimatedMinutes: 55,
    },
  ],
  last14Days: { planned: 6, done: 5, missed: 1, missedWeekdays: [] },
  freeDays: ['2026-11-04', '2026-11-06'],
  upcoming: [{ date: '2026-11-05', title: 'Corrida leve' }],
  daysSinceLastTraining: 4,
  checkIn: null,
  loadMetrics: null,
  ...over,
});

const plan = (over: Partial<MissedSessionPlan> = {}): MissedSessionPlan => ({
  strategy: 'CHECK_IN',
  hypotheses: [],
  question: 'Como foi o dia de ontem por aí?',
  rationale: 'Primeira sessão perdida, sem padrão.',
  ...over,
});

const planViolations = async (i: MissedSessionInput, o: MissedSessionPlan) =>
  (await Promise.all(missedSessionPlanValidators.map((v) => v(i, o, ctx)))).flat();

describe('missedSessionPlanValidators', () => {
  it('check-in simples é válido', async () => {
    expect(await planViolations(input(), plan())).toEqual([]);
  });

  it('escalar só com 3 ou mais sessões perdidas em 14 dias', async () => {
    const escalate = plan({ strategy: 'ESCALATE' });
    expect((await planViolations(input(), escalate)).map((v) => v.path)).toContain('strategy');
    const repeated = input({ last14Days: { planned: 6, done: 2, missed: 3, missedWeekdays: [1] } });
    expect(await planViolations(repeated, escalate)).toEqual([]);
  });
});

describe('missedSessionMessageValidators', () => {
  const messageInput = (
    strategy: MissedSessionPlan['strategy'] = 'CHECK_IN',
  ): MissedSessionMessageInput => ({
    firstName: 'Ana',
    missedTitles: ['Força A'],
    plan: plan({ strategy }),
  });
  const run = async (i: MissedSessionMessageInput, messages: string[]) =>
    (await Promise.all(missedSessionMessageValidators.map((v) => v(i, { messages }, ctx)))).flat();

  it('aceita acolhimento que termina em pergunta', async () => {
    expect(
      await run(messageInput(), [
        'Oi, Ana! Ontem o treino não rolou, e tá tudo bem.',
        'Como foi o seu dia?',
      ]),
    ).toEqual([]);
  });

  it('exige a pergunta no fim e recusa culpa', async () => {
    const noQuestion = await run(messageInput(), ['Oi, Ana! Ontem o treino não rolou.']);
    expect(noQuestion.map((v) => v.message).join(' ')).toMatch(/pergunta/);
    const guilt = await run(messageInput(), [
      'Ana, você faltou ao treino de novo. Podemos conversar?',
    ]);
    expect(guilt.map((v) => v.message).join(' ')).toMatch(/culpa/);
  });
});
