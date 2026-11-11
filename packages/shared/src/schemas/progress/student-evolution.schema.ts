import { z } from 'zod';

const nullableNumber = z.number().nullable();

/** Uma semana do aluno: previsto × feito e como o corpo respondeu. */
export const evolutionWeekSchema = z.object({
  weekStart: z.iso.date(),
  planned: z.number().int(),
  done: z.number().int(),
  missed: z.number().int(),
  plannedLoad: z.number(),
  realizedLoad: z.number(),
  avgRpe: nullableNumber,
  painReports: z.number().int(),
});
export type EvolutionWeek = z.infer<typeof evolutionWeekSchema>;

/** Um dia: carga e como o aluno se sentiu (1 a 5; estresse: 5 = muito) e a prontidão derivada (0 a 100). */
export const evolutionDaySchema = z.object({
  date: z.iso.date(),
  load: z.number(),
  energy: nullableNumber,
  sleep: nullableNumber,
  soreness: nullableNumber,
  mood: nullableNumber,
  stress: nullableNumber,
  readiness: nullableNumber,
});
export type EvolutionDay = z.infer<typeof evolutionDaySchema>;

/** Alimentação registrada em um dia: o que o aluno contou no WhatsApp ou no app (só dias com registro). */
export const evolutionNutritionDaySchema = z.object({
  date: z.iso.date(),
  meals: z.number().int(),
  energyKcal: z.number(),
  proteinG: z.number(),
  carbsG: z.number(),
  fatG: z.number(),
  waterMl: nullableNumber,
});
export type EvolutionNutritionDay = z.infer<typeof evolutionNutritionDaySchema>;

export const studentEvolutionSchema = z.object({
  asOf: z.iso.date(),
  weeks: z.array(evolutionWeekSchema),
  /** Últimos 28 dias, um item por dia. */
  days: z.array(evolutionDaySchema),
  /** Registro alimentar dos últimos 28 dias (dias sem registro ficam de fora). */
  nutritionDays: z.array(evolutionNutritionDaySchema),
  load: z.object({
    weeklyLoad: z.number(),
    previousWeeklyLoad: z.number(),
    acwr: nullableNumber,
    monotony: nullableNumber,
    strain: nullableNumber,
    adherenceRatio: nullableNumber,
    readiness: z.object({
      score: nullableNumber,
      baseline: nullableNumber,
      delta: nullableNumber,
    }),
    risks: z.array(z.object({ kind: z.string(), detail: z.string() })),
  }),
  measurements: z.array(
    z.object({
      kind: z.string(),
      points: z.array(z.object({ date: z.iso.date(), value: z.number() })),
    }),
  ),
  /** Progressão dos exercícios mais frequentes (carga de topo, repetições e volume por sessão). */
  strength: z.array(
    z.object({
      exerciseId: z.string(),
      points: z.array(
        z.object({
          date: z.iso.date(),
          topLoadKg: nullableNumber,
          repsAtTop: nullableNumber,
          tonnageKg: z.number(),
        }),
      ),
    }),
  ),
  pain: z.array(
    z.object({
      region: z.string(),
      reports: z.number().int(),
      maxIntensity: z.number(),
      lastOn: z.iso.date(),
    }),
  ),
  /** O que os agentes sabem do aluno (memória), para a equipe auditar. */
  memory: z.array(
    z.object({ kind: z.string(), text: z.string(), importance: z.number().int() }),
  ),
  reassessments: z.array(
    z.object({ cycleEndedOn: z.iso.date(), status: z.string(), submittedAt: z.string().nullable() }),
  ),
});
export type StudentEvolution = z.infer<typeof studentEvolutionSchema>;
