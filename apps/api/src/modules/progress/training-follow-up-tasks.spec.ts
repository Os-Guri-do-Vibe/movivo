import { describe, expect, it } from 'vitest';

import type { ValidationContext } from '../../core/agents/agent-task';
import {
  trainingFollowUpValidators,
  type TrainingFollowUp,
  type TrainingFollowUpInput,
} from './training-follow-up-tasks';

const ctx: ValidationContext = { state: {}, methodology: {} };

const week = (weekStart: string) => ({
  weekStart,
  planned: 4,
  done: 4,
  missed: 0,
  keyPlanned: 2,
  keyDone: 2,
  load: 1_800,
  avgRpe: 7,
  painReports: 0,
  foodLogDays: 5,
  weightKg: null,
});

const input = (over: Partial<TrainingFollowUpInput> = {}): TrainingFollowUpInput => ({
  goalDirection: 'GAIN',
  protocol: {
    weekNumber: 5,
    totalWeeks: 8,
    phaseName: 'Hipertrofia',
    phaseFocus: 'Volume progressivo',
    plannedDeloadWeek: false,
    sessionsPerWeek: 4,
  },
  weeks: [week('2026-10-12'), week('2026-10-19'), week('2026-10-26')],
  loadMetrics: null,
  progression: [],
  daysSinceProtocolChange: 28,
  sessionHistory: [],
  openCommitments: [],
  ...over,
});

const adjust: TrainingFollowUp = {
  status: 'NEEDS_ADJUSTMENT',
  findings: [
    { topic: 'PROGRESSION', statement: 'Agachamento parado em 80 kg há 3 sessões com RIR 3.' },
  ],
  adjustment: {
    kind: 'ADJUST_PROTOCOL',
    instruction:
      'Subir o volume de pernas em 2 séries por semana e trocar o leg press por agachamento búlgaro.',
    reason: 'Estímulo estagnado com folga de repetições.',
  },
  progressionTry: 'Tenta 82,5 kg no agachamento; se cair abaixo de 6 repetições, volta aos 80 kg.',
  nextStep: 'Fechar as quatro sessões da semana com RIR 1 a 2 nas séries principais.',
  question: null,
  commitmentReview: [],
};

const run = async (i: TrainingFollowUpInput, o: TrainingFollowUp) =>
  (await Promise.all(trainingFollowUpValidators.map((v) => v(i, o, ctx)))).flat();

describe('trainingFollowUpValidators', () => {
  it('aceita ajuste do protocolo com dados e uma tentativa de carga', async () => {
    expect(await run(input(), adjust)).toEqual([]);
  });

  it('só altera o protocolo com pelo menos 2 semanas de dados e sem mudança recente', async () => {
    const fewWeeks = await run(input({ weeks: [week('2026-10-26')] }), adjust);
    expect(fewWeeks.map((v) => v.path)).toContain('adjustment');
    const recent = await run(input({ daysSinceProtocolChange: 4 }), adjust);
    expect(recent.map((v) => v.message).join(' ')).toMatch(/menos de 10 dias/);
  });

  it('semana de recuperação prevista pelo protocolo não leva tentativa de progressão', async () => {
    const violations = await run(
      input({ protocol: { ...input().protocol, plannedDeloadWeek: true } }),
      adjust,
    );
    expect(violations.map((v) => v.path)).toContain('progressionTry');
  });

  it('sem dados não se altera o protocolo', async () => {
    const violations = await run(input(), { ...adjust, status: 'NEEDS_DATA' });
    expect(violations.map((v) => v.path)).toContain('adjustment');
  });

  it('exige o veredito de todo compromisso da semana anterior', async () => {
    const id = '7d1b2c3e-4f50-4a61-8b72-9c8d7e6f5a40';
    const open = input({
      openCommitments: [
        {
          id,
          text: 'Fechar as quatro sessões da semana com RIR 1 a 2',
          createdOn: '2026-10-25',
          dueOn: '2026-11-01',
        },
      ],
    });
    expect((await run(open, adjust)).map((v) => v.path)).toContain('commitmentReview');
    expect(
      (
        await run(open, {
          ...adjust,
          commitmentReview: [{ id, verdict: 'PARTIAL', evidence: '3 das 4 sessões, RIR médio 2.' }],
        })
      ).map((v) => v.path),
    ).not.toContain('commitmentReview');
  });
});
