/**
 * Fixtures dos testes de integração do planejamento e da execução: treinador falso (saídas
 * válidas por construção) e aluno semeado direto no banco.
 */
import type { PlanSession } from '@movivo/shared';

import {
  bodyMeasurements,
  safetyEvents,
  studentConstraints,
  studentGoals,
  studentPreferences,
  studentProfiles,
  users,
} from '../src/core/database/schema';
import type { TenantDatabase } from '../src/core/database/tenant-database.service';
import type { NutritionInput } from '../src/modules/planning/tasks/nutrition';
import type { StrategyInput } from '../src/modules/planning/tasks/strategy';
import type { StrengthInput } from '../src/modules/planning/tasks/strength';

/** Treinador falso: saídas válidas por construção, a partir das entradas que o código montou. */
/** Base64 da "imagem" que o treinador falso trata como tela que não é de treino. */
export const NOT_A_WORKOUT_IMAGE = 'bm90LXdvcmtvdXQ=';

const WEEKDAY_WORDS: [string, string][] = [
  ['segunda', 'MON'],
  ['terça', 'TUE'],
  ['terca', 'TUE'],
  ['quarta', 'WED'],
  ['quinta', 'THU'],
  ['sexta', 'FRI'],
  ['sábado', 'SAT'],
  ['sabado', 'SAT'],
  ['domingo', 'SUN'],
];

/** Classificador falso: palavras-chave das mensagens usadas nos testes de conversa. */
function classifyFake(message: string) {
  const text = message.toLowerCase();
  const out = {
    intent: 'OUT_OF_SCOPE',
    availableWeekdays: null as string[] | null,
    scope: 'UNSPECIFIED',
    minutesAvailable: null as number | null,
    exerciseMention: null as string | null,
    swapReason: null as string | null,
    confidence: 'HIGH',
  };
  if (text.includes('só posso') || text.includes('so posso')) {
    out.intent = 'UNAVAILABILITY';
    out.scope = 'THIS_WEEK';
    out.availableWeekdays = [
      ...new Set(WEEKDAY_WORDS.filter(([w]) => text.includes(w)).map(([, d]) => d)),
    ];
  } else if (/só tenho (\d+) minutos/.test(text)) {
    out.intent = 'SHORT_ON_TIME';
    out.scope = 'TODAY';
    out.minutesAvailable = Number(/só tenho (\d+) minutos/.exec(text)?.[1]);
  } else if (text.startsWith('troca')) {
    out.intent = 'EXERCISE_SWAP';
    out.exerciseMention = text
      .replace(/^troca( o| a)?/, '')
      .replace(/[.!?,].*$/, '')
      .trim();
    out.swapReason = text.includes('não tenho') ? 'EQUIPMENT' : 'PREFERENCE';
  } else if (text.includes('almocei')) out.intent = 'FOOD_LOG';
  else if (text.includes('link')) out.intent = 'LINK_REQUEST';
  else if (text.includes('humano')) out.intent = 'HUMAN_REVIEW';
  else if (text.includes('proteína')) out.intent = 'NUTRITION_QUESTION';
  else if (text.startsWith('oi')) out.intent = 'GREETING';
  return out;
}

export const fakeRunner = {
  async run(
    task: { id: string },
    input: unknown,
    options?: { images?: readonly { base64: string }[] },
  ) {
    const base = {
      modelRunIds: [] as string[],
      correctionRounds: 0,
      stateVersion: 0,
      methodologyVersions: {},
      costBrl: 0,
    };
    if (task.id === 'goals.define_strategy') {
      const i = input as StrategyInput;
      return {
        ...base,
        output: {
          strategy: {
            title: 'Ganho de força com consistência',
            rationale: ['Objetivo declarado e disponibilidade favorecem foco em força.'],
            energyStrategy: i.derived.adiposity === 'HIGH' ? 'RECOMPOSITION' : 'MAINTENANCE',
            modalityFocus: ['STRENGTH'],
            indicators: [
              {
                key: 'sessions',
                label: 'Sessões concluídas',
                source: 'ADHERENCE',
                direction: 'INCREASE',
              },
            ],
            reviewAfterWeeks: 6,
            openQuestions: [],
          },
          milestones: [
            {
              indicatorKey: 'sessions',
              description: 'Concluir 9 sessões em 3 semanas.',
              condition: { kind: 'AT_LEAST', value: 9 },
              dueInWeeks: 3,
            },
          ],
          tasks: [
            { kind: 'COMPLETE_SESSIONS', title: 'Treinar 3 vezes', cadence: 'WEEKLY', target: 3 },
          ],
          studentMessage: 'Vamos construir força com constância, no seu ritmo.',
          professionalNote: 'Sem observações.',
        },
      };
    }
    if (task.id === 'strength.build_block') {
      const i = input as StrengthInput;
      const picks = i.candidates.slice(0, 6);
      const sessions: PlanSession[] = Array.from({ length: i.sessionsPerWeek }, (_, index) => ({
        key: `FORCA_${index + 1}`,
        title: `Força ${index + 1}`,
        purpose: 'Desenvolver força com progressão de carga.',
        priority: index === 0 ? 'KEY' : 'IMPORTANT',
        weeklyFrequency: 1,
        estimatedMinutes: Math.min(i.minutesPerSession, 45),
        estimatedRpe: 6,
        content: {
          modality: 'STRENGTH',
          focus: 'Corpo todo',
          exercises: picks.map((c) => ({
            exerciseId: c.id,
            name: c.name,
            sets: 3,
            ...(c.measurement === 'DURATION'
              ? { durationSeconds: 30 }
              : { reps: { min: 8, max: 12 } }),
            loadStrategy: 'DOUBLE_PROGRESSION' as const,
            rir: 2,
            restSeconds: 90,
          })),
        },
      }));
      return {
        ...base,
        output: {
          summary: 'Bloco de força de corpo inteiro.',
          phases: [{ name: 'Base', focus: 'Adaptação', weeks: 4, endsWithDeload: false }],
          sessions,
          notes: ['Suba a carga quando completar o topo das repetições.'],
        },
      };
    }
    if (task.id === 'nutrition.build_plan') {
      const i = input as NutritionInput;
      const day = (b: NutritionInput['bounds']['restDay']) => {
        const kcal = Math.round((b.energyKcal.min + b.energyKcal.max) / 2);
        const protein = Math.max(b.proteinG.min, 100);
        const fat = Math.max(b.fatMinG ?? 55, 55);
        const carbs = Math.max(20, Math.round((kcal - protein * 4 - fat * 9) / 4));
        return {
          energyKcal: { min: b.energyKcal.min, max: b.energyKcal.max },
          proteinG: protein,
          carbsG: carbs,
          fatG: fat,
          fiberG: Math.max(b.fiberMinG ?? 25, 25),
          waterMl: Math.max(b.waterMinMl ?? 2_500, 2_500),
        };
      };
      const slots = i.usualMeals.slice(0, 4);
      const share = 1 / slots.length;
      return {
        ...base,
        output: {
          strategy: i.strategy,
          summary: 'Plano alimentar simples, com proteína distribuída ao longo do dia.',
          trainingDay: day(i.bounds.trainingDay),
          restDay: day(i.bounds.restDay),
          meals: slots.map((slot) => ({
            slot,
            energyShare: share,
            proteinG: 30,
            guidance: 'Inclua uma fonte de proteína.',
            examples: ['Arroz, feijão e ovos'],
          })),
          guidelines: ['Beba água ao longo do dia.'],
          supplements: [],
        },
      };
    }
    if (task.id === 'vision.extract_workout_screenshot') {
      const notWorkout = options?.images?.[0]?.base64 === NOT_A_WORKOUT_IMAGE;
      return {
        ...base,
        output: notWorkout
          ? { kind: 'NOT_A_WORKOUT', metrics: {}, confidence: 'HIGH', visibleText: [], note: null }
          : {
              kind: 'RUNNING',
              metrics: { distanceMeters: 5_020, movingSeconds: 1_694, avgHeartRate: 152 },
              confidence: 'HIGH',
              visibleText: ['5,02 km', '28:14', 'FC média 152 bpm'],
              note: null,
            },
      };
    }
    if (task.id === 'nutrition.interpret_food_log') {
      const text = (input as { text: string }).text.toLowerCase();
      const items = [
        text.includes('arroz') && {
          label: 'arroz branco cozido',
          grams: 150,
          portionSource: 'ESTIMATED',
        },
        text.includes('feij') && {
          label: 'feijão carioca cozido',
          grams: 90,
          portionSource: 'HOUSEHOLD_MEASURE',
        },
        text.includes('frango') && {
          label: 'peito de frango grelhado',
          grams: 120,
          portionSource: 'DECLARED',
        },
        text.includes('unicórnio') && {
          label: 'unicórnio assado',
          grams: 100,
          portionSource: 'ESTIMATED',
        },
      ].filter(Boolean);
      return {
        ...base,
        output: {
          meal: 'LUNCH',
          items,
          needsClarification: items.length ? null : 'O que você comeu?',
        },
      };
    }
    if (task.id === 'vision.identify_meal') {
      return {
        ...base,
        output: {
          notFood: false,
          mealSlotGuess: 'DINNER',
          items: [{ label: 'salmão grelhado', estimatedGrams: 130, confidence: 'MEDIUM' }],
          note: null,
        },
      };
    }
    if (task.id === 'conversation.classify_inbound') {
      return { ...base, output: classifyFake((input as { message: string }).message) };
    }
    if (task.id === 'conversation.answer_question') {
      return {
        ...base,
        output: {
          reply: 'Distribua a proteína ao longo do dia, em três ou quatro refeições.',
          needsProfessional: false,
        },
      };
    }
    if (task.id === 'strength.choose_substitute') {
      const i = input as { candidates: { id: string }[] };
      return {
        ...base,
        output: {
          toExerciseId: i.candidates[0]?.id,
          why: 'Trabalha os mesmos músculos com o que você tem.',
        },
      };
    }
    if (task.id === 'safety.detect_risk_signals') {
      return { ...base, output: { signals: [] } };
    }
    throw new Error(`tarefa inesperada no teste: ${task.id}`);
  },
};

export async function createStudent(
  db: TenantDatabase,
  created: string[],
  options: { signal?: boolean } = {},
): Promise<string> {
  const phone = `+55119${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const userId = await db.runAsSystem(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        phoneNumber: phone,
        email: `${phone.replace(/\D/g, '')}@example.invalid`,
        name: 'Aluno Plano',
        biologicalSex: 'MALE',
      })
      .returning({ id: users.id });
    if (!user) throw new Error('falha ao criar aluno');
    const id = user.id;
    await tx.insert(studentProfiles).values({
      userId: id,
      profile: {
        birthDate: '1994-03-10',
        heightCm: 178,
        modalities: [
          {
            modality: 'STRENGTH',
            level: 'INTERMEDIATE',
            monthsPracticing: 24,
            sessionsPerWeek: 3,
            wantsToStart: false,
          },
        ],
        externalSports: [],
        venues: ['FULL_GYM'],
        lifeContext: {
          occupationRhythm: 'REGULAR',
          cookingCapacity: 'BASIC',
          mealsOutsideHomePerWeek: 4,
          foodBudget: 'MODERATE',
        },
      },
    });
    await tx.insert(studentGoals).values({
      userId: id,
      version: 1,
      declared: { primary: 'HYPERTROPHY', secondary: [], emphasis: 'AESTHETICS' },
      startedOn: '2026-11-04',
    });
    await tx.insert(studentConstraints).values({
      userId: id,
      kind: 'AVAILABILITY',
      constraint: {
        kind: 'AVAILABILITY',
        windows: [
          { weekday: 'MON', slot: 'EVENING', maxMinutes: 60 },
          { weekday: 'WED', slot: 'EVENING', maxMinutes: 60 },
          { weekday: 'FRI', slot: 'EVENING', maxMinutes: 60 },
          { weekday: 'SAT', slot: 'MORNING', maxMinutes: 90 },
        ],
        variesWeekly: false,
        maxSessionsPerWeek: 4,
      },
      origin: 'DECLARED',
      validFrom: '2026-11-04',
    });
    await tx.insert(studentPreferences).values([
      {
        userId: id,
        domain: 'FOOD',
        key: 'meals_per_day',
        value: 4,
        strength: 'STRONG',
        origin: 'DECLARED',
        confidence: 80,
      },
      {
        userId: id,
        domain: 'FOOD',
        key: 'usual_meals',
        value: 'BREAKFAST,LUNCH,AFTERNOON_SNACK,DINNER',
        strength: 'STRONG',
        origin: 'DECLARED',
        confidence: 80,
      },
    ]);
    await tx.insert(bodyMeasurements).values([
      { userId: id, kind: 'WEIGHT', value: 80, method: 'SCALE', measuredOn: '2026-11-04' },
      { userId: id, kind: 'WAIST', value: 84, method: 'SELF_TAPE', measuredOn: '2026-11-04' },
    ]);
    if (options.signal) {
      await tx.insert(safetyEvents).values({
        userId: id,
        kind: 'PARQ_POSITIVE',
        severity: 'URGENT',
        scope: 'ALL',
        detectedBy: 'RULE',
        evidence: 'PAR-Q com resposta de risco',
      });
    }
    return id;
  });
  created.push(userId);
  return userId;
}
