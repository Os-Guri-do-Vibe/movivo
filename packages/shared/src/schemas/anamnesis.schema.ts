/**
 * Onboarding v2 — DTOs de contrato (Sprint 6, US-6.3 / TASK-6.3.1).
 *
 * Fonte única do shape das 3 etapas do wizard, consumida pelo backend
 * (`AnamnesisController`) e pelo frontend (US-6.10).
 *
 * Estrutura (D1 da `sprint/sprint-6-onboarding-em-etapas.md`):
 *  - **Etapa 1** (`onboardingStep1Schema`) — cadastro pessoal: nome, nascimento (18+),
 *    sexo biológico, telefone E.164 verificado por código, e-mail opcional. Dado
 *    pessoal comum → `data_block_1` (jsonb).
 *  - **Etapa 2** — anamnese em 5 seções. As seções 1/2/3/5 (`anamnesisV2Schema`) são
 *    dado comum → `data_block_3` (jsonb); a **seção 4** (`painAssessmentSchema`) é
 *    **dado de saúde (LGPD Art. 11)** → `data_block_2` (bytea cifrado).
 *  - **Etapa 3** (`onboardingStep3Schema`) — PAR-Q `parq-2026-07-v1` (reuso integral,
 *    sem alteração jurídica) + as 3 declarações finais. Saúde → `data_block_2`.
 *
 * ⚠️ Regra vinculante de Alexandre (`docs/juridico/consentimento-e-parq.md` §5.7):
 * **todo campo de texto livre vai para o bloco cifrado**, independentemente da seção
 * em que a UI o exiba — é o vetor pelo qual dado sensível entra em coluna não
 * classificada como sensível. Por isso os campos livres das seções 1/2/3/5 estão
 * agrupados em `anamnesisFreeTextSchema`, que o backend desvia para `data_block_2`.
 *
 * A anamnese v1 (`anamnesisBlock1/2/3Schema`, `PATCH .../block/{n}`) foi **removida**
 * (substituição destrutiva — D1). Não há convivência atrás de flag.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Vocabulário fechado — as opções são as do RT CREF, sem redução (decisão do
// fundador 2026-08-10, item 3: "não adianta MVP, sem informações realmente
// validadas pelo profissional CREF").
// ---------------------------------------------------------------------------

/**
 * Objetivo principal — os 9 valores do RT (o 9º é "Outro" com texto livre).
 *
 * `OTHER` **não é um objetivo de geração**: nenhuma regra determinística consegue
 * inferir faixa de repetição de um texto livre. O gerador recebe o objetivo
 * traduzido por {@link toGenerationGoal}; o texto bruto é preservado na anamnese
 * (`primaryGoalOther`) para o profissional CREF ver no painel.
 */
export const primaryGoalSchema = z.enum([
  'GAIN_MUSCLE',
  'GAIN_STRENGTH',
  'LOSE_FAT',
  'CONDITIONING',
  'HEALTH_ENERGY',
  'BUILD_ROUTINE',
  'RETURN_TO_TRAINING',
  'SPORT_EVENT',
  'OTHER',
]);
export type PrimaryGoal = z.infer<typeof primaryGoalSchema>;

/** Rótulos exibidos (a UI não inventa texto de opção — Sofia §0.4). */
export const PRIMARY_GOAL_LABELS: Readonly<Record<PrimaryGoal, string>> = {
  GAIN_MUSCLE: 'Ganhar massa muscular',
  GAIN_STRENGTH: 'Ganhar força',
  LOSE_FAT: 'Reduzir gordura corporal',
  CONDITIONING: 'Melhorar o condicionamento físico',
  HEALTH_ENERGY: 'Melhorar minha saúde e disposição',
  BUILD_ROUTINE: 'Criar uma rotina de treino',
  RETURN_TO_TRAINING: 'Voltar a treinar',
  SPORT_EVENT: 'Preparar-me para um esporte ou evento',
  OTHER: 'Outro',
};

/**
 * Objetivo aceito pelo gerador/validador. `OTHER` não entra: seria uma décima
 * categoria de geração sem faixa de repetição definida pelo RT.
 */
export const generationGoalSchema = primaryGoalSchema.exclude(['OTHER']);
export type GenerationGoal = z.infer<typeof generationGoalSchema>;

/**
 * Objetivo declarado → objetivo de geração.
 *
 * "Outro" cai em `CONDITIONING` (saúde geral / condicionamento) — o objetivo mais
 * conservador do vocabulário, e o único defensável sem interpretar texto livre.
 * O texto original **não se perde**: fica em `primaryGoalOther` para o painel CREF.
 */
export function toGenerationGoal(goal: PrimaryGoal): GenerationGoal {
  return goal === 'OTHER' ? 'CONDITIONING' : goal;
}

/** 11 regiões de ênfase (10 específicas + "corpo todo", mutuamente exclusiva). */
export const emphasisRegionSchema = z.enum([
  'FULL_BODY',
  'CHEST',
  'BACK',
  'SHOULDERS',
  'BICEPS',
  'TRICEPS',
  'ABS_CORE',
  'QUADS',
  'HAMSTRINGS',
  'GLUTES',
  'CALVES',
]);
export type EmphasisRegion = z.infer<typeof emphasisRegionSchema>;

export const EMPHASIS_REGION_LABELS: Readonly<Record<EmphasisRegion, string>> = {
  FULL_BODY: 'Corpo todo, sem preferência',
  CHEST: 'Peitoral',
  BACK: 'Costas',
  SHOULDERS: 'Ombros',
  BICEPS: 'Bíceps',
  TRICEPS: 'Tríceps',
  ABS_CORE: 'Abdômen e core',
  QUADS: 'Quadríceps',
  HAMSTRINGS: 'Posterior de coxa',
  GLUTES: 'Glúteos',
  CALVES: 'Panturrilhas',
};

/** Grupos musculares do catálogo por região de ênfase (mapeamento para o gerador). */
export const EMPHASIS_MUSCLE_GROUPS: Readonly<Record<EmphasisRegion, readonly string[]>> = {
  FULL_BODY: [],
  CHEST: ['peito'],
  BACK: ['costas'],
  SHOULDERS: ['ombro'],
  BICEPS: ['bíceps'],
  TRICEPS: ['tríceps'],
  ABS_CORE: ['core'],
  QUADS: ['quadríceps'],
  HAMSTRINGS: ['posterior de coxa'],
  GLUTES: ['glúteo'],
  CALVES: ['panturrilha'],
};

/** Situação atual de treino (seção 2). */
export const trainingStatusSchema = z.enum(['NEVER', 'STOPPED', 'OCCASIONAL', 'REGULAR']);
export type TrainingStatus = z.infer<typeof trainingStatusSchema>;

/** 5 faixas de "parado há quanto tempo" (condicional de `STOPPED`). */
export const stoppedForSchema = z.enum([
  'LT_3_MONTHS',
  'M3_TO_6',
  'M6_TO_12',
  'Y1_TO_2',
  'GT_2_YEARS',
]);
export type StoppedFor = z.infer<typeof stoppedForSchema>;

/**
 * Experiência com musculação — **o campo que fecha o `level` hardcoded** (D6).
 * As descrições exibidas são copy do fundador e vivem no frontend (US-6.10).
 */
export const trainingExperienceSchema = z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']);
export type TrainingExperience = z.infer<typeof trainingExperienceSchema>;

/** 10 atividades já praticadas + "outra" com texto livre. */
export const pastActivitySchema = z.enum([
  'WEIGHT_TRAINING',
  'WALK_RUN',
  'CYCLING',
  'SWIMMING',
  'FOOTBALL',
  'MARTIAL_ARTS',
  'DANCE',
  'YOGA_PILATES',
  'FUNCTIONAL_CROSSFIT',
  'NONE',
  'OTHER',
]);
export type PastActivity = z.infer<typeof pastActivitySchema>;

/** 9 barreiras de consistência + "outro" com texto livre. */
export const consistencyBarrierSchema = z.enum([
  'LACK_OF_TIME',
  'LACK_OF_MOTIVATION',
  'DONT_KNOW_WHAT_TO_DO',
  'NO_RESULTS',
  'PAIN_OR_INJURY',
  'COST',
  'EMBARRASSMENT',
  'TIREDNESS',
  'ROUTINE_CHANGE',
  'OTHER',
]);
export type ConsistencyBarrier = z.infer<typeof consistencyBarrierSchema>;

/** 5 faixas de tempo por treino. */
export const sessionDurationSchema = z.enum([
  'LT_30',
  'M30_TO_45',
  'M45_TO_60',
  'M60_TO_90',
  'GT_90',
]);
export type SessionDuration = z.infer<typeof sessionDurationSchema>;

/**
 * Minutos representativos de cada faixa — o gerador raciocina em minutos.
 * Usa-se o **piso** da faixa (planejar para o tempo que a pessoa garante, não para o teto).
 */
export const SESSION_DURATION_MINUTES: Readonly<Record<SessionDuration, number>> = {
  LT_30: 25,
  M30_TO_45: 30,
  M45_TO_60: 45,
  M60_TO_90: 60,
  GT_90: 90,
};

/**
 * 4 locais de treino reais (decisão do fundador 2026-08-10, item 4), substituindo
 * `HOME`/`GYM`/`BOTH`. Cada exercício do catálogo declara em quais destes ele cabe —
 * "ao ar livre" não é "casa" e "academia de condomínio" não é "academia completa".
 */
export const trainingLocationSchema = z.enum(['FULL_GYM', 'CONDO_GYM', 'HOME', 'OUTDOOR']);
export type TrainingLocation = z.infer<typeof trainingLocationSchema>;

export const TRAINING_LOCATION_LABELS: Readonly<Record<TrainingLocation, string>> = {
  FULL_GYM: 'Academia completa',
  CONDO_GYM: 'Academia de condomínio',
  HOME: 'Em casa',
  OUTDOOR: 'Ao ar livre',
};

/** Período preferido de treino. */
export const preferredPeriodSchema = z.enum(['MORNING', 'AFTERNOON', 'EVENING', 'NIGHT', 'VARIES']);
export type PreferredPeriod = z.infer<typeof preferredPeriodSchema>;

export const weekdaySchema = z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
export type Weekday = z.infer<typeof weekdaySchema>;

/** Sexo biológico — parâmetro técnico de prescrição (Alexandre §5.7: não é dado sensível). */
export const biologicalSexSchema = z.enum(['MALE', 'FEMALE']);
export type BiologicalSex = z.infer<typeof biologicalSexSchema>;

/** 10 regiões de dor da seção 4 (Sofia §6.3) — articulares/segmentares. */
export const painRegionSchema = z.enum([
  'NECK',
  'SHOULDER',
  'ELBOW',
  'WRIST',
  'LOWER_BACK',
  'UPPER_BACK',
  'HIP',
  'KNEE',
  'ANKLE_FOOT',
  'OTHER',
]);
export type PainRegion = z.infer<typeof painRegionSchema>;

export const PAIN_REGION_LABELS: Readonly<Record<PainRegion, string>> = {
  NECK: 'Pescoço',
  SHOULDER: 'Ombro',
  ELBOW: 'Cotovelo',
  WRIST: 'Punho',
  LOWER_BACK: 'Lombar',
  UPPER_BACK: 'Costas (região torácica)',
  HIP: 'Quadril',
  KNEE: 'Joelho',
  ANKLE_FOOT: 'Tornozelo ou pé',
  OTHER: 'Outra',
};

/** Tendência da dor. */
export const painTrendSchema = z.enum(['IMPROVING', 'STABLE', 'WORSENING', 'UNKNOWN']);
export type PainTrend = z.infer<typeof painTrendSchema>;

/** Telefone em E.164 (`+5511999999999`) — identificador funcional do produto. */
export const phoneE164Schema = z
  .string()
  .regex(
    /^\+[1-9]\d{7,14}$/,
    'Telefone deve estar em formato internacional E.164 (ex.: +5511999999999).',
  );

// ---------------------------------------------------------------------------
// PAR-Q (conjunto autoritativo `parq-2026-07-v1` — Alexandre §2.1)
// REUSO INTEGRAL: nada aqui muda na Sprint 6, só o enquadramento como etapa 3.
// ---------------------------------------------------------------------------

/** Identificador imutável do conjunto de perguntas. Trava a versão exibida↔avaliada. */
export const PARQ_VERSION = 'parq-2026-07-v1';

/** As 9 perguntas oficiais. Toda binária (Não/Sim); Q9 exige motivo quando "Sim". */
export const PARQ_QUESTION_IDS = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9'] as const;
export type ParqQuestionId = (typeof PARQ_QUESTION_IDS)[number];

/** Uma resposta do PAR-Q. `answer=true` é o "Sim" (resposta de risco). */
export const parqAnswerSchema = z.object({
  questionId: z.enum(PARQ_QUESTION_IDS),
  answer: z.boolean(),
  /** Follow-up opcional ("Conta um pouco mais?"). Obrigatório em Q9=Sim. */
  detail: z.string().trim().max(500).optional(),
});
export type ParqAnswer = z.infer<typeof parqAnswerSchema>;

/** Conjunto completo: exatamente uma resposta por pergunta Q1..Q9. */
export const parqSchema = z
  .object({
    version: z.literal(PARQ_VERSION),
    answers: z.array(parqAnswerSchema).length(9),
  })
  .superRefine((val, ctx) => {
    const ids = new Set(val.answers.map((a) => a.questionId));
    for (const id of PARQ_QUESTION_IDS) {
      if (!ids.has(id)) {
        ctx.addIssue({ code: 'custom', message: `Resposta ausente para ${id}.` });
      }
    }
    // Q9 = "Sim" precisa de motivo (Alexandre §2.1: campo obrigatório).
    const q9 = val.answers.find((a) => a.questionId === 'Q9');
    if (q9?.answer === true && !q9.detail) {
      ctx.addIssue({ code: 'custom', message: 'Q9 marcada como "Sim" exige o motivo.' });
    }
  });
export type Parq = z.infer<typeof parqSchema>;

// ---------------------------------------------------------------------------
// Etapa 1 — cadastro pessoal
// ---------------------------------------------------------------------------

/** Idade mínima do produto (art. 14 LGPD + decisão de negócio do fundador). */
export const MIN_AGE_YEARS = 18;

/** Mensagem EXATA do fundador para o gate 18+. Nem uma vírgula muda. */
export const UNDER_AGE_MESSAGE =
  'No momento, a Movivo está disponível apenas para maiores de 18 anos.';

/** Data civil `YYYY-MM-DD` (sem hora — nascimento não tem fuso). */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD.')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'Data inválida.');

/**
 * Idade completa em anos numa data de referência. Determinística e sem dependência:
 * é a mesma função usada pelo gate 18+ do servidor (a autoridade) e pelo cliente.
 */
export function ageInYears(birthDate: string, reference: Date = new Date()): number {
  const [year, month, day] = birthDate.split('-').map(Number) as [number, number, number];
  let age = reference.getUTCFullYear() - year;
  const monthDiff = reference.getUTCMonth() + 1 - month;
  if (monthDiff < 0 || (monthDiff === 0 && reference.getUTCDate() < day)) age -= 1;
  return age;
}

export const onboardingStep1Schema = z.object({
  name: z.string().trim().min(2).max(120),
  birthDate: isoDateSchema,
  biologicalSex: biologicalSexSchema,
  phoneNumber: phoneE164Schema,
  email: z.email().max(255).optional(),
});
export type OnboardingStep1 = z.infer<typeof onboardingStep1Schema>;

// ---------------------------------------------------------------------------
// Etapa 2 — seções 1, 2, 3 e 5 (dado pessoal comum)
// ---------------------------------------------------------------------------

/** Limite comum dos campos "Outro"/livres curtos. */
const FREE_TEXT_SHORT = 120;
const FREE_TEXT_LONG = 300;

/**
 * Campos de texto livre das seções 1/2/3/5.
 *
 * Separados do resto **de propósito**: por recomendação vinculante de Alexandre
 * (§5.7), o backend os desvia para o bloco cifrado, mesmo eles pertencendo a
 * seções de dado comum. Todos opcionais — só existem quando o condicional abre.
 */
export const anamnesisFreeTextSchema = z.object({
  /** Objetivo "Outro": preservado bruto para o painel CREF; não vira objetivo de geração. */
  primaryGoalOther: z.string().trim().max(FREE_TEXT_SHORT).optional(),
  importantEventDescription: z.string().trim().max(FREE_TEXT_LONG).optional(),
  pastActivityOther: z.string().trim().max(FREE_TEXT_SHORT).optional(),
  consistencyBarrierOther: z.string().trim().max(FREE_TEXT_SHORT).optional(),
  otherSportName: z.string().trim().max(FREE_TEXT_SHORT).optional(),
  /** Seção 5 — exercício que o usuário não quer fazer. Vira `UserConstraints.avoid[]`. */
  avoidedExercise: z.string().trim().max(FREE_TEXT_LONG).optional(),
});
export type AnamnesisFreeText = z.infer<typeof anamnesisFreeTextSchema>;

/** Seções 1, 2, 3 e 5 sem os campos livres (o que vai para `data_block_3`, jsonb). */
export const anamnesisStructuredSchema = z
  .object({
    // --- Seção 1: objetivos ---
    primaryGoal: primaryGoalSchema,
    /** Até 2 regiões; `FULL_BODY` é mutuamente exclusiva (decisão do fundador, pendência #7). */
    emphasis: z.array(emphasisRegionSchema).max(2).default([]),
    hasImportantEvent: z.boolean().default(false),
    importantEventDate: isoDateSchema.optional(),

    // --- Seção 2: histórico ---
    trainingStatus: trainingStatusSchema,
    stoppedFor: stoppedForSchema.optional(),
    experience: trainingExperienceSchema,
    pastActivities: z.array(pastActivitySchema).max(11).default([]),
    consistencyBarriers: z.array(consistencyBarrierSchema).max(10).default([]),

    // --- Seção 3: rotina ---
    daysPerWeek: z.number().int().min(1).max(7),
    preferredDays: z.array(weekdaySchema).max(7).default([]),
    sessionDuration: sessionDurationSchema,
    location: trainingLocationSchema,
    preferredPeriod: preferredPeriodSchema,
    practicesOtherSport: z.boolean().default(false),
    otherSportDaysPerWeek: z.number().int().min(1).max(7).optional(),

    // --- Seção 5: preferências ---
    hasAvoidedExercise: z.boolean().default(false),
  })
  .superRefine((val, ctx) => {
    // "Corpo todo, sem preferência" é mutuamente exclusiva (Sofia §3.2).
    if (val.emphasis.includes('FULL_BODY') && val.emphasis.length > 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['emphasis'],
        message: '"Corpo todo, sem preferência" não combina com outra região de ênfase.',
      });
    }
    if (new Set(val.emphasis).size !== val.emphasis.length) {
      ctx.addIssue({ code: 'custom', path: ['emphasis'], message: 'Região de ênfase repetida.' });
    }
    // Revelar é tornar obrigatório (Sofia §3.3.6) — o servidor é a autoridade.
    if (val.trainingStatus === 'STOPPED' && !val.stoppedFor) {
      ctx.addIssue({
        code: 'custom',
        path: ['stoppedFor'],
        message: 'Informe há quanto tempo você está parado.',
      });
    }
    if (val.hasImportantEvent && !val.importantEventDate) {
      ctx.addIssue({
        code: 'custom',
        path: ['importantEventDate'],
        message: 'Informe a data do evento importante.',
      });
    }
    if (val.practicesOtherSport && val.otherSportDaysPerWeek === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['otherSportDaysPerWeek'],
        message: 'Informe quantos dias por semana você pratica esse esporte.',
      });
    }
  });
export type AnamnesisStructured = z.infer<typeof anamnesisStructuredSchema>;

/**
 * Payload completo da etapa 2 seções 1/2/3/5.
 *
 * O backend parte este objeto em dois destinos: `structured` → `data_block_3`
 * (jsonb) e `freeText` → `data_block_2` (cifrado). A UI envia junto; a separação
 * de sensibilidade é decisão do servidor, não do cliente.
 */
export const anamnesisV2Schema = z
  .object({
    structured: anamnesisStructuredSchema,
    freeText: anamnesisFreeTextSchema.default({}),
  })
  .superRefine((val, ctx) => {
    const { structured: s, freeText: f } = val;
    if (s.primaryGoal === 'OTHER' && !f.primaryGoalOther) {
      ctx.addIssue({
        code: 'custom',
        path: ['freeText', 'primaryGoalOther'],
        message: 'Conta em poucas palavras qual é seu objetivo.',
      });
    }
    if (s.hasImportantEvent && !f.importantEventDescription) {
      ctx.addIssue({
        code: 'custom',
        path: ['freeText', 'importantEventDescription'],
        message: 'Descreva o evento importante.',
      });
    }
    if (s.pastActivities.includes('OTHER') && !f.pastActivityOther) {
      ctx.addIssue({
        code: 'custom',
        path: ['freeText', 'pastActivityOther'],
        message: 'Informe qual outra atividade.',
      });
    }
    if (s.consistencyBarriers.includes('OTHER') && !f.consistencyBarrierOther) {
      ctx.addIssue({
        code: 'custom',
        path: ['freeText', 'consistencyBarrierOther'],
        message: 'Informe qual outra dificuldade.',
      });
    }
    if (s.practicesOtherSport && !f.otherSportName) {
      ctx.addIssue({
        code: 'custom',
        path: ['freeText', 'otherSportName'],
        message: 'Informe qual esporte.',
      });
    }
    if (s.hasAvoidedExercise && !f.avoidedExercise) {
      ctx.addIssue({
        code: 'custom',
        path: ['freeText', 'avoidedExercise'],
        message: 'Informe qual exercício você prefere não fazer.',
      });
    }
  });
export type AnamnesisV2 = z.infer<typeof anamnesisV2Schema>;

// ---------------------------------------------------------------------------
// Etapa 2, seção 4 — dores e limitações (LGPD Art. 11 — CIFRADO)
// ---------------------------------------------------------------------------

/** Uma dor localizada: região + intensidade 0-10 (uma escala por região — Sofia §7.1). */
export const painPointSchema = z.object({
  region: painRegionSchema,
  intensity: z.number().int().min(0).max(10),
  /** Preenchido quando `region === 'OTHER'`. */
  regionOther: z.string().trim().max(100).optional(),
});
export type PainPoint = z.infer<typeof painPointSchema>;

/**
 * Seção 4 completa. `hasPain=false` é a resposta da maioria e encerra a seção
 * (pergunta-porta — Sofia §5a): nenhum outro campo é coletado nem enviado.
 */
export const painAssessmentSchema = z
  .object({
    hasPain: z.boolean(),
    points: z.array(painPointSchema).max(10).default([]),
    trend: painTrendSchema.optional(),
    /** O que provoca a dor. */
    trigger: z.string().trim().max(FREE_TEXT_LONG).optional(),
    hasProfessionalExplanation: z.boolean().default(false),
    professionalExplanation: z.string().trim().max(200).optional(),
    underMedicalFollowUp: z.boolean().default(false),
    hasAvoidanceRecommendation: z.boolean().default(false),
    avoidanceRecommendation: z.string().trim().max(200).optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.hasPain) {
      if (val.points.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['points'],
          message: 'Sem dor informada, não se coletam regiões de dor.',
        });
      }
      return;
    }
    if (val.points.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['points'], message: 'Informe ao menos uma região.' });
    }
    if (new Set(val.points.map((p) => p.region)).size !== val.points.length) {
      ctx.addIssue({ code: 'custom', path: ['points'], message: 'Região de dor repetida.' });
    }
    if (val.points.some((p) => p.region === 'OTHER' && !p.regionOther)) {
      ctx.addIssue({ code: 'custom', path: ['points'], message: 'Informe qual outra região.' });
    }
    if (!val.trend) {
      ctx.addIssue({ code: 'custom', path: ['trend'], message: 'Informe a tendência da dor.' });
    }
    if (val.hasProfessionalExplanation && !val.professionalExplanation) {
      ctx.addIssue({
        code: 'custom',
        path: ['professionalExplanation'],
        message: 'Conte o que o profissional te explicou.',
      });
    }
    if (val.hasAvoidanceRecommendation && !val.avoidanceRecommendation) {
      ctx.addIssue({
        code: 'custom',
        path: ['avoidanceRecommendation'],
        message: 'Informe o que foi recomendado evitar.',
      });
    }
  });
export type PainAssessment = z.infer<typeof painAssessmentSchema>;

/** Payload da etapa 2: seções 1/2/3/5 + seção 4 numa chamada só. */
export const onboardingStep2Schema = z.object({
  anamnesis: anamnesisV2Schema,
  pain: painAssessmentSchema,
});
export type OnboardingStep2 = z.infer<typeof onboardingStep2Schema>;

// ---------------------------------------------------------------------------
// Etapa 3 — PAR-Q + 3 declarações finais
// ---------------------------------------------------------------------------

/**
 * Identificador versionado das 3 declarações finais (US-6.8 / TASK-6.8.2).
 *
 * Formato aprovado por Alexandre: **declaração anexa ao PAR-Q**, não linha em
 * `consents` — o enum de `consent_type` recebeu apenas `AI_DISCLOSURE` (§5.8,
 * regra nova 2). A prova é o registro versionado junto ao PAR-Q, no mesmo bloco
 * cifrado e com o mesmo carimbo de submissão.
 */
export const PARQ_DECLARATIONS_VERSION = 'parq-declaracoes-2026-08-v1';

export const PARQ_DECLARATIONS: readonly { id: string; label: string }[] = [
  {
    id: 'TRUTHFUL',
    label:
      'Declaro que as informações que forneci são verdadeiras e estão atualizadas nesta data.',
  },
  {
    id: 'WILL_REPORT_CHANGES',
    label:
      'Estou ciente de que devo comunicar à MOVIVO qualquer mudança na minha condição de saúde.',
  },
  {
    id: 'MAY_REQUIRE_REVIEW',
    label:
      'Estou ciente de que uma resposta positiva neste questionário pode exigir a análise do profissional de Educação Física responsável antes de o meu treino ser preparado.',
  },
] as const;

const DECLARATION_IDS = PARQ_DECLARATIONS.map((d) => d.id) as [string, ...string[]];

export const onboardingStep3Schema = z
  .object({
    parq: parqSchema,
    declarationsVersion: z.literal(PARQ_DECLARATIONS_VERSION),
    /** As 3 são obrigatórias: sem elas o "FINALIZAR AVALIAÇÃO" não passa no servidor. */
    declarations: z.array(z.enum(DECLARATION_IDS)).length(PARQ_DECLARATIONS.length),
  })
  .superRefine((val, ctx) => {
    const accepted = new Set(val.declarations);
    for (const declaration of PARQ_DECLARATIONS) {
      if (!accepted.has(declaration.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['declarations'],
          message: `Declaração obrigatória ausente: ${declaration.id}.`,
        });
      }
    }
  });
export type OnboardingStep3 = z.infer<typeof onboardingStep3Schema>;

// ---------------------------------------------------------------------------
// Verificação de posse do WhatsApp (US-6.5)
// ---------------------------------------------------------------------------

/** Comprimento do código enviado no WhatsApp. */
export const PHONE_CODE_LENGTH = 6;

export const sendPhoneCodeSchema = z.object({ phoneNumber: phoneE164Schema });
export type SendPhoneCodeInput = z.infer<typeof sendPhoneCodeSchema>;

export const verifyPhoneCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'O código tem 6 dígitos.'),
});
export type VerifyPhoneCodeInput = z.infer<typeof verifyPhoneCodeSchema>;

// ---------------------------------------------------------------------------
// Contratos de request/response
// ---------------------------------------------------------------------------

export const startAnamnesisSchema = z.object({
  primaryGoal: primaryGoalSchema.optional(),
});
export type StartAnamnesisInput = z.infer<typeof startAnamnesisSchema>;

/**
 * Resultado da submissão (Sofia §9.2): a UI **lê**, nunca deriva estado clínico.
 * `outcome` é derivado no servidor a partir do gate PAR-Q; a resposta jamais
 * devolve o que o usuário respondeu nem o motivo do bloqueio (Sofia §9.3).
 */
export const onboardingOutcomeSchema = z.enum(['READY', 'PENDING_REVIEW']);
export type OnboardingOutcome = z.infer<typeof onboardingOutcomeSchema>;
