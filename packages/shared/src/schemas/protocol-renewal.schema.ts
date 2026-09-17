/**
 * Formulário de troca de protocolo por fim de mesociclo — DTO de contrato (renovação de
 * mesociclo, pós-MVP).
 *
 * Ao vencer o `endDate` de um protocolo `ACTIVE`, o aluno recebe por WhatsApp o link
 * deste formulário: 5 blocos, no mesmo estilo de salvamento de progresso da anamnese de
 * cadastro (`onboardingStep1Schema`/`onboardingStep2Schema`/`onboardingStep3Schema` em
 * `anamnesis.schema.ts`), mas mais curto e sem a fase anônima (o titular já existe).
 *
 * Reaproveita os enums já declarados em `anamnesis.schema.ts` sempre que a pergunta é a
 * MESMA do formulário original (região/tendência de dor, dias da semana, duração de
 * sessão, local de treino, objetivo, barreira de consistência) — nunca redeclara um
 * vocabulário que já existe.
 */
import { z } from 'zod';

import {
  consistencyBarrierSchema,
  isoDateSchema,
  MAX_WEIGHT_KG,
  MIN_WEIGHT_KG,
  painRegionSchema,
  painTrendSchema,
  primaryGoalSchema,
  sessionDurationSchema,
  trainingLocationSchema,
  weekdaySchema,
} from './anamnesis.schema';

// ---------------------------------------------------------------------------
// Bloco 1 — desempenho e execução real (perguntas 1-4)
// ---------------------------------------------------------------------------

export const renewalCompletionRateSchema = z.enum([
  'SEMPRE',
  'NA_MAIORIA_DAS_VEZES',
  'SO_AS_VEZES',
  'RARAMENTE',
]);
export type RenewalCompletionRate = z.infer<typeof renewalCompletionRateSchema>;

export const renewalActualFrequencySchema = z.enum([
  'TODOS_OS_DIAS_PLANEJADOS',
  'FALTOU_1_DIA_NA_MAIORIA',
  'FALTARAM_2_OU_MAIS_NA_MAIORIA',
  'TREINEI_BEM_MENOS',
]);
export type RenewalActualFrequency = z.infer<typeof renewalActualFrequencySchema>;

export const renewalLoadProgressionSchema = z.enum([
  'EVOLUI_NA_MAIORIA',
  'MANTIVE_SEM_EVOLUIR',
  'DIFICULDADE_MANTER',
  'NAO_ACOMPANHEI',
]);
export type RenewalLoadProgression = z.infer<typeof renewalLoadProgressionSchema>;

/** Leitura simplificada do RIR real percebido ao final da maioria das séries de trabalho. */
export const renewalPerceivedEffortSchema = z.enum([
  'SOBRAVA_BASTANTE',
  'SOBRAVA_UM_POUCO',
  'QUASE_NO_LIMITE',
  'PERTO_DA_FALHA',
]);
export type RenewalPerceivedEffort = z.infer<typeof renewalPerceivedEffortSchema>;

export const protocolRenewalBlock1Schema = z.object({
  completionRate: renewalCompletionRateSchema,
  actualFrequency: renewalActualFrequencySchema,
  loadProgression: renewalLoadProgressionSchema,
  perceivedEffort: renewalPerceivedEffortSchema,
});
export type ProtocolRenewalBlock1 = z.infer<typeof protocolRenewalBlock1Schema>;

// ---------------------------------------------------------------------------
// Bloco 2 — fadiga e recuperação (perguntas 5-8)
// ---------------------------------------------------------------------------

export const renewalFatigueLevelSchema = z.enum([
  'BAIXO_RECUPERADO',
  'MODERADO',
  'ALTO_SEM_RECUPERACAO',
  'MUITO_ALTO_EXAUSTO',
]);
export type RenewalFatigueLevel = z.infer<typeof renewalFatigueLevelSchema>;

export const renewalSleepQualitySchema = z.enum(['OTIMA', 'BOA', 'REGULAR', 'RUIM']);
export type RenewalSleepQuality = z.infer<typeof renewalSleepQualitySchema>;

export const renewalStressLevelSchema = z.enum(['BAIXO', 'MODERADO', 'ALTO']);
export type RenewalStressLevel = z.infer<typeof renewalStressLevelSchema>;

export const renewalMuscleSorenessSchema = z.enum([
  'NORMAL',
  'MAIS_INTENSA_OU_DEMORADA',
  'BEM_MAIS_INTENSA_OU_DEMORADA',
]);
export type RenewalMuscleSoreness = z.infer<typeof renewalMuscleSorenessSchema>;

export const protocolRenewalBlock2Schema = z.object({
  fatigueLevel: renewalFatigueLevelSchema,
  sleepQuality: renewalSleepQualitySchema,
  stressLevel: renewalStressLevelSchema,
  muscleSoreness: renewalMuscleSorenessSchema,
});
export type ProtocolRenewalBlock2 = z.infer<typeof protocolRenewalBlock2Schema>;

// ---------------------------------------------------------------------------
// Bloco 3 — segurança: repescagem de PAR-Q (pergunta 9, 9a-9d, pergunta 10)
// LGPD Art. 11 — vai para o bloco cifrado (`data_block_3`), nunca em claro.
// ---------------------------------------------------------------------------

/** Pergunta 9 + follow-ups 9a-9d — dor/desconforto/limitação NOVA neste mesociclo. */
export const protocolRenewalNewPainSchema = z
  .object({
    hasNewPain: z.boolean(),
    region: painRegionSchema.optional(),
    regionOther: z.string().trim().max(100).optional(),
    intensity: z.number().int().min(0).max(10).optional(),
    trend: painTrendSchema.optional(),
    soughtCare: z.boolean().optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.hasNewPain) return;
    if (!val.region) {
      ctx.addIssue({ code: 'custom', path: ['region'], message: 'Informe a região.' });
    }
    if (val.region === 'OTHER' && !val.regionOther) {
      ctx.addIssue({
        code: 'custom',
        path: ['regionOther'],
        message: 'Informe qual outra região.',
      });
    }
    if (val.intensity === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['intensity'],
        message: 'Informe a intensidade (0-10).',
      });
    }
    if (!val.trend) {
      ctx.addIssue({
        code: 'custom',
        path: ['trend'],
        message: 'Informe se está melhorando, estável ou piorando.',
      });
    }
    if (val.soughtCare === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['soughtCare'],
        message: 'Informe se já procurou avaliação médica ou fisioterapêutica.',
      });
    }
  });
export type ProtocolRenewalNewPain = z.infer<typeof protocolRenewalNewPainSchema>;

/**
 * Pergunta 10 — repescagem do PAR-Q original: alguma resposta "Não" mudaria para "Sim"
 * hoje? `changedToYes: true` reaciona a MESMA lógica de gate do PAR-Q inicial
 * (`evaluateParq` em `apps/api/src/modules/anamnesis/parq.ts`) — ver
 * `evaluateRenewalSafety` em `apps/api/src/modules/protocol-renewal/protocol-renewal-safety.ts`.
 */
export const protocolRenewalParqRecheckSchema = z
  .object({
    changedToYes: z.boolean(),
    detail: z.string().trim().max(500).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.changedToYes && !val.detail) {
      ctx.addIssue({ code: 'custom', path: ['detail'], message: 'Conte o que mudou.' });
    }
  });
export type ProtocolRenewalParqRecheck = z.infer<typeof protocolRenewalParqRecheckSchema>;

export const protocolRenewalBlock3Schema = z.object({
  newPain: protocolRenewalNewPainSchema,
  parqRecheck: protocolRenewalParqRecheckSchema,
});
export type ProtocolRenewalBlock3 = z.infer<typeof protocolRenewalBlock3Schema>;

// ---------------------------------------------------------------------------
// Bloco 4 — resultado percebido (perguntas 11-13)
// ---------------------------------------------------------------------------

export const renewalGoalProgressSchema = z.enum([
  'MELHOR_QUE_ESPERAVA',
  'DENTRO_DO_ESPERADO',
  'ABAIXO_DO_ESPERADO',
  'NAO_SEI_AVALIAR',
]);
export type RenewalGoalProgress = z.infer<typeof renewalGoalProgressSchema>;

export const protocolRenewalBlock4Schema = z.object({
  /** Pergunta 11. */
  currentWeightKg: z.number().min(MIN_WEIGHT_KG).max(MAX_WEIGHT_KG),
  goalProgress: renewalGoalProgressSchema,
  satisfaction: z.number().int().min(0).max(10),
});
export type ProtocolRenewalBlock4 = z.infer<typeof protocolRenewalBlock4Schema>;

// ---------------------------------------------------------------------------
// Bloco 5 — contexto e logística (perguntas 14-18) — só o que pode ter mudado
// ---------------------------------------------------------------------------

export const renewalContextChangeSchema = z.enum([
  'DAYS_PER_WEEK',
  'SESSION_DURATION',
  'TRAINING_LOCATION',
  'NONE',
]);
export type RenewalContextChange = z.infer<typeof renewalContextChangeSchema>;

export const renewalTargetEventStatusSchema = z.enum([
  'STILL_ON',
  'DATE_CHANGED',
  'NO_LONGER_APPLIES',
]);
export type RenewalTargetEventStatus = z.infer<typeof renewalTargetEventStatusSchema>;

export const protocolRenewalBlock5Schema = z
  .object({
    /** Pergunta 14 — múltipla escolha; cada opção marcada exige o campo específico abaixo. */
    changes: z.array(renewalContextChangeSchema).min(1),
    daysPerWeek: z.number().int().min(1).max(7).optional(),
    preferredDays: z.array(weekdaySchema).max(7).default([]),
    sessionDuration: sessionDurationSchema.optional(),
    location: trainingLocationSchema.optional(),
    /** Pergunta 15. */
    dislikedExercise: z
      .object({
        has: z.boolean(),
        description: z.string().trim().max(300).optional(),
      })
      .superRefine((val, ctx) => {
        if (val.has && !val.description) {
          ctx.addIssue({
            code: 'custom',
            path: ['description'],
            message: 'Informe qual exercício.',
          });
        }
      }),
    /** Pergunta 16 — vazio equivale a "Nenhuma, está indo bem". */
    barriers: z.array(consistencyBarrierSchema).max(10).default([]),
    /** Texto livre quando `barriers` inclui `OTHER` — mesmo padrão de `consistencyBarrierOther`. */
    barrierOther: z.string().trim().max(120).optional(),
    /** Pergunta 17. */
    goalChange: z
      .object({
        changed: z.boolean(),
        newGoal: primaryGoalSchema.optional(),
        /** Texto livre quando `newGoal` é `OTHER` — mesmo padrão de `primaryGoalOther`. */
        newGoalOther: z.string().trim().max(120).optional(),
      })
      .superRefine((val, ctx) => {
        if (val.changed && !val.newGoal) {
          ctx.addIssue({ code: 'custom', path: ['newGoal'], message: 'Informe o novo objetivo.' });
        }
        if (val.changed && val.newGoal === 'OTHER' && !val.newGoalOther) {
          ctx.addIssue({
            code: 'custom',
            path: ['newGoalOther'],
            message: 'Informe o novo objetivo.',
          });
        }
      }),
    /** Pergunta 18 — só enviada quando o protocolo anterior tinha data-alvo cadastrada. */
    targetEvent: z
      .object({
        status: renewalTargetEventStatusSchema,
        newDate: isoDateSchema.optional(),
      })
      .superRefine((val, ctx) => {
        if (val.status === 'DATE_CHANGED' && !val.newDate) {
          ctx.addIssue({ code: 'custom', path: ['newDate'], message: 'Informe a nova data.' });
        }
      })
      .optional(),
  })
  .superRefine((val, ctx) => {
    if (val.changes.includes('NONE') && val.changes.length > 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['changes'],
        message: '"Nenhuma mudança" não combina com outra opção marcada.',
      });
    }
    if (val.changes.includes('DAYS_PER_WEEK') && val.daysPerWeek === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['daysPerWeek'],
        message: 'Informe os dias disponíveis por semana.',
      });
    }
    if (val.changes.includes('SESSION_DURATION') && !val.sessionDuration) {
      ctx.addIssue({
        code: 'custom',
        path: ['sessionDuration'],
        message: 'Informe o tempo disponível por sessão.',
      });
    }
    if (val.changes.includes('TRAINING_LOCATION') && !val.location) {
      ctx.addIssue({
        code: 'custom',
        path: ['location'],
        message: 'Informe o novo local de treino.',
      });
    }
    if (val.barriers.includes('OTHER') && !val.barrierOther) {
      ctx.addIssue({
        code: 'custom',
        path: ['barrierOther'],
        message: 'Informe qual dificuldade.',
      });
    }
  });
export type ProtocolRenewalBlock5 = z.infer<typeof protocolRenewalBlock5Schema>;

// ---------------------------------------------------------------------------
// Etapas aceitas pelo `PATCH .../step/{n}` e schema de status
// ---------------------------------------------------------------------------

export const PROTOCOL_RENEWAL_STEP_SCHEMAS = {
  1: protocolRenewalBlock1Schema,
  2: protocolRenewalBlock2Schema,
  3: protocolRenewalBlock3Schema,
  4: protocolRenewalBlock4Schema,
  5: protocolRenewalBlock5Schema,
} as const;
