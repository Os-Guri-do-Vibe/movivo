import { describe, expect, it } from 'vitest';

import type { ValidationContext } from '../../core/agents/agent-task';
import {
  commitmentNudgeValidators,
  reengagementMessageValidators,
  reengagementPlanValidators,
  trackingGapValidators,
  type ReengagementPlanInput,
} from './reengagement-tasks';

const ctx: ValidationContext = { state: {}, methodology: {} };
const run = async <I, O>(
  validators: ReadonlyArray<(i: I, o: O, c: ValidationContext) => unknown>,
  i: I,
  o: O,
) => JSON.stringify((await Promise.all(validators.map((v) => v(i, o, ctx)))).flat());

const input: ReengagementPlanInput = {
  level: 2,
  daysSilent: 6,
  allowedStrategies: ['MINIMUM_VERSION', 'REMOVE_FRICTION', 'RESET_GOAL'],
  lastSignal: 'MESSAGE',
  trainedLast14: 1,
  plannedPerWeek: 4,
  hasNutritionPlan: true,
  daysWithoutMealLog: 9,
  daysSinceWeight: 22,
  previousOutreach: [{ level: 1, strategy: 'REMOVE_FRICTION', respondedAfterHours: null }],
};
const plan = {
  strategy: 'MINIMUM_VERSION' as const,
  hypotheses: ['Pode ser que a semana tenha apertado no trabalho.'],
  question: 'Topa recomeçar com dois treinos curtos esta semana?',
  minimumWeek: { sessionsPerWeek: 2, minutesPerSession: 25 },
  rationale: 'Treinava e sumiu; o menor passo reduz a fricção.',
};

describe('plano de reengajamento', () => {
  it('aceita a versão mínima com treinos e minutos', async () => {
    expect(await run(reengagementPlanValidators, input, plan)).toBe('[]');
  });

  it('só usa abordagem permitida no degrau e não repete a que ficou sem resposta', async () => {
    expect(
      await run(reengagementPlanValidators, input, {
        ...plan,
        strategy: 'OPEN_DOOR' as const,
        minimumWeek: null,
      }),
    ).toContain('neste degrau');
    expect(
      await run(reengagementPlanValidators, input, {
        ...plan,
        strategy: 'REMOVE_FRICTION' as const,
        minimumWeek: null,
      }),
    ).toContain('já foi usada sem resposta');
  });

  it('versão mínima precisa dos números e não pede mais do que o protocolo tem', async () => {
    expect(await run(reengagementPlanValidators, input, { ...plan, minimumWeek: null })).toContain(
      'quantos treinos',
    );
    expect(
      await run(
        reengagementPlanValidators,
        { ...input, plannedPerWeek: 1 },
        { ...plan, minimumWeek: { sessionsPerWeek: 3, minutesPerSession: 20 } },
      ),
    ).toContain('mais treinos');
    expect(
      await run(reengagementPlanValidators, input, { ...plan, strategy: 'RESET_GOAL' as const }),
    ).toContain('só a abordagem MINIMUM_VERSION');
  });
});

describe('mensagens proativas', () => {
  const msgInput = { firstName: 'Ana', level: 2, daysSilent: 6, plan };

  it('terminam em pergunta, sem culpa, e a versão mínima traz números', async () => {
    expect(
      await run(reengagementMessageValidators, msgInput, {
        messages: ['Ana, senti sua falta por aqui. Que tal 2 treinos de 25 minutos esta semana?'],
      }),
    ).toBe('[]');
    expect(
      await run(reengagementMessageValidators, msgInput, {
        messages: ['Você sumiu faz uma semana. Vamos voltar?'],
      }),
    ).toContain('sem cobrança');
    expect(
      await run(reengagementMessageValidators, msgInput, {
        messages: ['Ana, senti sua falta. Topa recomeçar leve?'],
      }),
    ).toContain('quantos treinos');
  });

  it('o lembrete do combinado não cobra', async () => {
    const nudge = {
      firstName: 'Ana',
      commitment: {
        source: 'TRAINING' as const,
        text: 'Fechar 4 sessões com RIR 1 a 2',
        daysOpen: 3,
        daysLeft: 4,
      },
      progress: { sessionsDone: 2, mealDaysLogged: 3, studentMessages: 5 },
    };
    expect(
      await run(commitmentNudgeValidators, nudge, {
        messages: ['Ana, já são 2 sessões do nosso combinado. Como está indo?'],
      }),
    ).toBe('[]');
    expect(
      await run(commitmentNudgeValidators, nudge, {
        messages: ['Você não cumpriu o combinado ainda.'],
      }),
    ).toContain('sem cobrança');
  });
});

describe('leitura da nutricionista sobre falha de registro', () => {
  const base = {
    goalDirection: 'LOSE' as const,
    daysWithoutMealLog: 4,
    loggedMealDaysLast14: 3,
    daysSinceWeight: 21,
    weightPointsLast8Weeks: 1,
    daysOnPlan: 42,
  };
  const out = {
    priority: 'BOTH' as const,
    whyItMatters:
      'Com o seu peso de domingo e uma foto do prato eu ajusto o plano antes de você perder tempo.',
    easiestWay: 'Uma foto do almoço e o peso no check-in de domingo já bastam.',
  };

  it('a prioridade precisa bater com a falha real', async () => {
    expect(await run(trackingGapValidators, base, out)).toBe('[]');
    expect(
      await run(
        trackingGapValidators,
        { ...base, daysSinceWeight: 5 },
        { ...out, priority: 'WEIGHT' as const },
      ),
    ).toContain('menos de 14 dias');
    expect(await run(trackingGapValidators, { ...base, daysWithoutMealLog: 0 }, out)).toContain(
      'só há falha nos dois',
    );
  });
});
