import { describe, expect, it } from 'vitest';

import type { ValidationContext } from '../../core/agents/agent-task';
import {
  dayReviewValidators,
  loggingGapMessageValidators,
  loggingGapPlanValidators,
  mealReminderValidators,
  type DayReviewInput,
  type LoggingGapInput,
} from './meal-routine-tasks';

const ctx: ValidationContext = { state: {}, methodology: {} };
const run = async <I, O>(
  validators: ReadonlyArray<(i: I, o: O, c: ValidationContext) => unknown>,
  input: I,
  output: O,
) => (await Promise.all(validators.map((v) => v(input, output, ctx)))).flat() as unknown[];

describe('lembrete de refeição', () => {
  const input = {
    firstName: 'Ana',
    mealLabel: 'café da manhã',
    period: 'MORNING' as const,
    loggedToday: 0,
    streakDays: 3,
    trainingToday: true,
  };

  it('aceita abertura e fecho humanos, sem números', async () => {
    expect(
      await run(mealReminderValidators, input, {
        opening: 'Bom dia, Ana! Hoje é dia de treino: lembra de registrar seu café da manhã:',
        closing:
          'Me manda uma foto ou descreve o que comeu. Se quiser outras opções, é só abrir o plano em PDF ou me perguntar.',
      }),
    ).toEqual([]);
  });

  it('recusa números, falta de como registrar e de onde ver outras opções', async () => {
    const found = await run(mealReminderValidators, input, {
      opening: 'Bom dia! Seu café tem 400 kcal',
      closing: 'Manda tudo certinho depois, combinado, tá bom?',
    });
    expect(JSON.stringify(found)).toContain('sem números');
    expect(JSON.stringify(found)).toContain('foto, áudio ou descrevendo');
    expect(JSON.stringify(found)).toContain('outras opções');
  });
});

describe('leitura do dia', () => {
  const input: DayReviewInput = {
    firstName: 'Ana',
    dayType: 'TRAINING',
    strategy: 'DEFICIT',
    targets: { energyMinKcal: 1_900, energyMaxKcal: 2_100, proteinG: 140, waterMl: 2_800 },
    consumed: { energyKcal: 1_950, proteinG: 118, carbsG: 200, fatG: 60 },
    waterMl: 1_500,
    meals: [{ label: 'Almoço', energyKcal: 700, proteinG: 50 }],
    missingMeals: [],
    closedBecause: 'ALL_LOGGED',
    last7DaysAverage: null,
  };

  it('aceita número dos dados e a diferença entre meta e consumo', async () => {
    expect(
      await run(dayReviewValidators, input, {
        note: 'Energia dentro da faixa e boa constância. Faltaram 22 g de proteína: adianta um iogurte no lanche amanhã.',
        pattern: 'LOW_PROTEIN',
      }),
    ).toEqual([]);
  });

  it('recusa número inventado', async () => {
    const found = await run(dayReviewValidators, input, {
      note: 'Você fechou o dia com 2.450 kcal, acima do esperado.',
      pattern: 'OVER_TARGET',
    });
    expect(JSON.stringify(found)).toContain('números fora dos dados');
  });
});

describe('falha de registro', () => {
  const input: LoggingGapInput = {
    daysWithoutLog: 3,
    loggedDaysLast14: 6,
    remindersLast3Days: 6,
    previousOutreachLast14: 0,
    daysSinceWeight: 21,
    nutritionist: {
      priority: 'BOTH' as const,
      whyItMatters:
        'Com o seu peso de domingo e uma foto do prato eu ajusto o plano antes de você perder tempo.',
      easiestWay: 'Uma foto do almoço e o peso no check-in de domingo já bastam.',
    },
    talkedRecently: true,
    trainedLast7Days: 3,
    checkIn: null,
  };
  const plan = {
    strategy: 'SIMPLIFY' as const,
    hypotheses: ['Pode ser que o registro esteja pesado na rotina corrida.'],
    question: 'Topa mandar só a foto do almoço por uns dias?',
    rationale: 'Treina e conversa, mas não registra: reduzir a fricção.',
  };

  it('escalar exige 5 dias sem registro e uma tentativa anterior', async () => {
    expect(await run(loggingGapPlanValidators, input, plan)).toEqual([]);
    const escalate = { ...plan, strategy: 'ESCALATE' as const };
    expect(JSON.stringify(await run(loggingGapPlanValidators, input, escalate))).toContain(
      'ESCALATE',
    );
    expect(
      await run(
        loggingGapPlanValidators,
        { ...input, daysWithoutLog: 6, previousOutreachLast14: 1 },
        escalate,
      ),
    ).toEqual([]);
  });

  it('a mensagem termina em pergunta e não cobra', async () => {
    const base = {
      firstName: 'Ana',
      daysWithoutLog: 3,
      daysSinceWeight: 21,
      plan,
      nutritionist: input.nutritionist,
    };
    expect(
      await run(loggingGapMessageValidators, base, {
        messages: ['Vi que você segue firme nos treinos! Topa mandar só a foto do almoço?'],
      }),
    ).toEqual([]);
    const found = await run(loggingGapMessageValidators, base, {
      messages: ['Você não registrou nada nesses dias.'],
    });
    expect(JSON.stringify(found)).toContain('sem cobrança');
    expect(JSON.stringify(found)).toContain('pergunta');
  });
});
