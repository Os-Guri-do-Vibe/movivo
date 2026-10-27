import { z } from 'zod';

import { coachedModalitySchema } from '../training/modality.schema';

/** O que o aluno DECLARA querer. Não é a estratégia: o Motor de Objetivos decide como chegar lá. */
export const declaredGoalKindSchema = z.enum([
  'HYPERTROPHY',
  'FAT_LOSS',
  'BODY_DEFINITION',
  'STRENGTH',
  'RUNNING_PERFORMANCE',
  'RACE_PREPARATION',
  'HYROX_PREPARATION',
  'CONDITIONING',
  'SPORT_PERFORMANCE',
  'HEALTH',
  'START_TRAINING',
]);
export type DeclaredGoalKind = z.infer<typeof declaredGoalKindSchema>;

export const DECLARED_GOAL_LABELS: Readonly<Record<DeclaredGoalKind, string>> = {
  HYPERTROPHY: 'Ganhar massa muscular',
  FAT_LOSS: 'Perder gordura',
  BODY_DEFINITION: 'Definição corporal',
  STRENGTH: 'Ficar mais forte',
  RUNNING_PERFORMANCE: 'Correr melhor',
  RACE_PREPARATION: 'Me preparar para uma prova de corrida',
  HYROX_PREPARATION: 'Me preparar para o HYROX',
  CONDITIONING: 'Melhorar o condicionamento',
  SPORT_PERFORMANCE: 'Render mais no meu esporte',
  HEALTH: 'Saúde e qualidade de vida',
  START_TRAINING: 'Começar a treinar com consistência',
};

/** Evento-alvo (prova, competição, data pessoal). */
export const targetEventSchema = z.object({
  kind: z.enum(['RUNNING_RACE', 'HYROX_RACE', 'COMPETITION', 'PERSONAL_DATE']),
  name: z.string().trim().min(1).max(120),
  date: z.iso.date(),
  /** Distância da prova de corrida, quando houver. */
  distanceMeters: z.number().int().min(1_000).max(100_000).optional(),
  /** Meta de tempo informada pelo aluno, em segundos. */
  targetSeconds: z.number().int().min(60).max(86_400).optional(),
});
export type TargetEvent = z.infer<typeof targetEventSchema>;

/** Objetivo declarado na anamnese. */
export const declaredGoalSchema = z.object({
  primary: declaredGoalKindSchema,
  secondary: z.array(declaredGoalKindSchema).max(3),
  /** O que importa agora, nas palavras da interface (estética, desempenho, saúde…). */
  emphasis: z.enum(['AESTHETICS', 'PERFORMANCE', 'HEALTH', 'BALANCED']),
  targetEvent: targetEventSchema.optional(),
  /** Por que agora — texto curto, ajuda o Comunicador a falar a língua do aluno. */
  motivation: z.string().trim().max(300).optional(),
});
export type DeclaredGoal = z.infer<typeof declaredGoalSchema>;

/** Estratégia energética escolhida pelo Motor de Objetivos (não pelo aluno). */
export const energyStrategySchema = z.enum([
  'DEFICIT',
  'MAINTENANCE',
  'SURPLUS',
  'RECOMPOSITION',
  'PERFORMANCE_FUELING',
]);
export type EnergyStrategy = z.infer<typeof energyStrategySchema>;

/** Indicador que mede o progresso de uma estratégia. */
export const goalIndicatorSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,39}$/),
  label: z.string().trim().min(1).max(80),
  /** Fonte do dado (medida corporal, execução de treino, registro alimentar, check-in…). */
  source: z.enum(['BODY', 'TRAINING', 'NUTRITION', 'CHECK_IN', 'ADHERENCE']),
  direction: z.enum(['INCREASE', 'DECREASE', 'MAINTAIN']),
  unit: z.string().trim().max(16).optional(),
});
export type GoalIndicator = z.infer<typeof goalIndicatorSchema>;

/** A estratégia que o Motor de Objetivos escolheu e explicou. */
export const goalStrategySchema = z.object({
  /** Nome curto da estratégia em linguagem do aluno (ex.: "Recomposição corporal"). */
  title: z.string().trim().min(1).max(80),
  /** Por que esta estratégia, e não a leitura literal do objetivo declarado. */
  rationale: z.array(z.string().trim().min(1).max(300)).min(1).max(6),
  energyStrategy: energyStrategySchema,
  modalityFocus: z.array(coachedModalitySchema).min(1).max(3),
  indicators: z.array(goalIndicatorSchema).min(1).max(8),
  /** Em quantas semanas a estratégia é reavaliada. */
  reviewAfterWeeks: z.number().int().min(2).max(16),
  /** O que ainda falta saber para refinar a estratégia. */
  openQuestions: z.array(z.string().trim().min(1).max(200)).max(5),
});
export type GoalStrategy = z.infer<typeof goalStrategySchema>;

export const goalStatusSchema = z.enum(['ACTIVE', 'SUPERSEDED', 'ACHIEVED', 'ABANDONED']);
export type GoalStatus = z.infer<typeof goalStatusSchema>;

/** Marco intermediário: condição verificável sobre um indicador, com prazo. */
export const goalMilestoneSchema = z.object({
  indicatorKey: z.string().trim().min(1).max(40),
  description: z.string().trim().min(1).max(200),
  /** Condição em forma estruturada para checagem automática quando possível. */
  condition: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('AT_LEAST'), value: z.number() }),
    z.object({ kind: z.literal('AT_MOST'), value: z.number() }),
    z.object({ kind: z.literal('CHANGE_BY'), delta: z.number() }),
    z.object({ kind: z.literal('MANUAL') }),
  ]),
  dueInWeeks: z.number().int().min(1).max(52),
});
export type GoalMilestone = z.infer<typeof goalMilestoneSchema>;

export const milestoneStatusSchema = z.enum(['PENDING', 'ACHIEVED', 'MISSED', 'REVISED']);
export type MilestoneStatus = z.infer<typeof milestoneStatusSchema>;

/** Microtarefa: ação pequena, auditável, que o aluno cumpre e o sistema confirma por evento. */
export const goalTaskKindSchema = z.enum([
  'COMPLETE_SESSIONS',
  'COMPLETE_KEY_SESSION',
  'LOG_MEALS',
  'HIT_PROTEIN',
  'RECORD_MEASUREMENTS',
  'RECORD_PHOTOS',
  'ANSWER_CHECK_IN',
  'SLEEP_ROUTINE',
  'CUSTOM',
]);
export type GoalTaskKind = z.infer<typeof goalTaskKindSchema>;

export const goalTaskSchema = z.object({
  kind: goalTaskKindSchema,
  title: z.string().trim().min(1).max(120),
  cadence: z.enum(['DAILY', 'WEEKLY', 'ONCE']),
  /** Alvo numérico da janela (ex.: 3 sessões na semana, 5 dias com proteína na meta). */
  target: z.number().int().min(1).max(31),
});
export type GoalTask = z.infer<typeof goalTaskSchema>;

export const goalTaskStatusSchema = z.enum(['OPEN', 'DONE', 'MISSED', 'CANCELED']);
export type GoalTaskStatus = z.infer<typeof goalTaskStatusSchema>;
