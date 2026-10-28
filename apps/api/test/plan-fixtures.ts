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
export const fakeRunner = {
  async run(task: { id: string }, input: unknown) {
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
