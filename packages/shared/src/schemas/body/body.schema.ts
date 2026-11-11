import { z } from 'zod';

export const measurementKindSchema = z.enum([
  'WEIGHT',
  'WAIST',
  'HIP',
  'CHEST',
  'ARM',
  'THIGH',
  'CALF',
  'BODY_FAT_PERCENT',
]);
export type MeasurementKind = z.infer<typeof measurementKindSchema>;

export const MEASUREMENT_LABELS: Readonly<Record<MeasurementKind, string>> = {
  WEIGHT: 'Peso',
  WAIST: 'Cintura',
  HIP: 'Glúteos',
  CHEST: 'Peitoral',
  ARM: 'Braço',
  THIGH: 'Coxa',
  CALF: 'Panturrilha',
  BODY_FAT_PERCENT: '% de gordura',
};

/** Unidade fixa por tipo de medida — o servidor nunca converte nem aceita outra. */
export const MEASUREMENT_UNITS: Readonly<Record<MeasurementKind, 'kg' | 'cm' | '%'>> = {
  WEIGHT: 'kg',
  WAIST: 'cm',
  HIP: 'cm',
  CHEST: 'cm',
  ARM: 'cm',
  THIGH: 'cm',
  CALF: 'cm',
  BODY_FAT_PERCENT: '%',
};

/** Como a medida foi obtida — muda a confiança da leitura. */
export const measurementMethodSchema = z.enum([
  'SELF_TAPE',
  'SCALE',
  'BIOIMPEDANCE',
  'SKINFOLD',
  'DEXA',
  'ESTIMATED',
]);
export type MeasurementMethod = z.infer<typeof measurementMethodSchema>;

/** Faixa plausível de cada medida (a mesma que a API aplica e o formulário mostra). */
export const MEASUREMENT_BOUNDS: Readonly<Record<MeasurementKind, readonly [number, number]>> = {
  WEIGHT: [30, 300],
  WAIST: [40, 250],
  HIP: [50, 250],
  CHEST: [50, 200],
  ARM: [15, 70],
  THIGH: [30, 110],
  CALF: [20, 70],
  BODY_FAT_PERCENT: [3, 70],
};

export const measurementInputSchema = z
  .object({
    kind: measurementKindSchema,
    value: z.number(),
    method: measurementMethodSchema,
    measuredOn: z.iso.date(),
  })
  .refine(
    (m) => {
      const [min, max] = MEASUREMENT_BOUNDS[m.kind];
      return m.value >= min && m.value <= max;
    },
    { message: 'Valor fora da faixa plausível para essa medida.', path: ['value'] },
  );
export type MeasurementInput = z.infer<typeof measurementInputSchema>;

/** As quatro posições da avaliação corporal: frontal, lado direito, costas e lado esquerdo. */
export const photoAngleSchema = z.enum(['FRONT', 'RIGHT', 'BACK', 'LEFT']);
export type PhotoAngle = z.infer<typeof photoAngleSchema>;

/** Verificação de padronização da foto (feita pela visão antes de qualquer análise). */
export const photoQualitySchema = z.object({
  usable: z.boolean(),
  issues: z.array(
    z.enum(['LIGHTING', 'DISTANCE', 'POSE', 'CLOTHING', 'FRAMING', 'BLUR', 'NOT_A_BODY_PHOTO']),
  ),
});
export type PhotoQuality = z.infer<typeof photoQualitySchema>;

// --- Avaliação física completa por foto ---------------------------------------------------

/** Grupos musculares lidos na foto (o braço junta bíceps e tríceps, que a foto não separa). */
export const physiqueMuscleRegionSchema = z.enum([
  'CHEST',
  'BACK',
  'SHOULDERS',
  'ARMS',
  'ABS_CORE',
  'QUADS',
  'HAMSTRINGS',
  'GLUTES',
  'CALVES',
]);
export type PhysiqueMuscleRegion = z.infer<typeof physiqueMuscleRegionSchema>;

export const PHYSIQUE_MUSCLE_LABELS: Readonly<Record<PhysiqueMuscleRegion, string>> = {
  CHEST: 'Peitoral',
  BACK: 'Costas',
  SHOULDERS: 'Ombros',
  ARMS: 'Braços',
  ABS_CORE: 'Abdômen e core',
  QUADS: 'Quadríceps',
  HAMSTRINGS: 'Posterior de coxa',
  GLUTES: 'Glúteos',
  CALVES: 'Panturrilhas',
};

/** Grupos do catálogo de exercícios por região lida na foto (o mesmo vocabulário da ênfase). */
export const PHYSIQUE_CATALOG_GROUPS: Readonly<Record<PhysiqueMuscleRegion, readonly string[]>> = {
  CHEST: ['peito'],
  BACK: ['costas'],
  SHOULDERS: ['ombro'],
  ARMS: ['bíceps', 'tríceps'],
  ABS_CORE: ['core'],
  QUADS: ['quadríceps'],
  HAMSTRINGS: ['posterior de coxa'],
  GLUTES: ['glúteo'],
  CALVES: ['panturrilha'],
};

/** Leitura do desenvolvimento do grupo: ponto forte, equilibrado, a desenvolver ou fora de vista. */
export const physiqueMuscleStatusSchema = z.enum([
  'STRENGTH',
  'BALANCED',
  'TO_DEVELOP',
  'NOT_ASSESSABLE',
]);
export type PhysiqueMuscleStatus = z.infer<typeof physiqueMuscleStatusSchema>;

/** Segmentos do alinhamento observados (cabeça e cervical até os pés). */
export const postureRegionSchema = z.enum([
  'HEAD_NECK',
  'SHOULDERS',
  'THORACIC',
  'LUMBAR',
  'PELVIS',
  'KNEES',
  'FEET',
]);
export type PostureRegion = z.infer<typeof postureRegionSchema>;

export const POSTURE_REGION_LABELS: Readonly<Record<PostureRegion, string>> = {
  HEAD_NECK: 'Cabeça e cervical',
  SHOULDERS: 'Ombros',
  THORACIC: 'Coluna torácica',
  LUMBAR: 'Coluna lombar',
  PELVIS: 'Pelve',
  KNEES: 'Joelhos',
  FEET: 'Pés',
};

/**
 * Avaliação física visual: grupos musculares (pontos fortes e a desenvolver), observações de
 * postura e simetria, e os destaques. Tudo é leitura de foto, com margem de erro: descreve o que
 * se vê e serve de leitura para a auditoria e para o aluno buscar avaliação profissional; nunca é diagnóstico.
 */
export const physiqueSchema = z.object({
  muscleGroups: z
    .array(
      z.object({
        region: physiqueMuscleRegionSchema,
        status: physiqueMuscleStatusSchema,
        note: z.string().trim().min(4).max(140),
      }),
    )
    .max(9),
  posture: z
    .array(
      z.object({
        region: postureRegionSchema,
        /** O que se vê, em linguagem descritiva (ex.: "ombros projetados à frente"). */
        finding: z.string().trim().min(8).max(200),
        degree: z.enum(['NONE_VISIBLE', 'MILD', 'NOTABLE']),
        /** Em quais posições da foto a observação aparece. */
        seenIn: z.array(photoAngleSchema).max(4),
      }),
    )
    .max(7),
  /** Assimetrias entre os lados, quando a foto deixa ver. */
  symmetry: z.string().trim().min(8).max(200).nullable(),
  strengths: z.array(z.string().trim().min(8).max(160)).max(4),
  attentionPoints: z.array(z.string().trim().min(8).max(160)).max(4),
});
export type Physique = z.infer<typeof physiqueSchema>;

/**
 * Resultado da análise visual. Sempre FAIXA + incerteza; observações posturais são só
 * pontos para avaliação profissional, nunca diagnóstico.
 */
export const bodyAssessmentResultSchema = z.object({
  bodyFatRange: z
    .object({ min: z.number().min(3).max(70), max: z.number().min(3).max(70) })
    .refine((r) => r.min <= r.max)
    .nullable(),
  confidence: z.enum(['LOW', 'MEDIUM']),
  /** Comparação com a avaliação anterior, quando houver fotos comparáveis. */
  comparison: z
    .object({
      previousAssessmentId: z.uuid(),
      summary: z.string().trim().min(1).max(400),
    })
    .nullable(),
  observationsForProfessional: z.array(z.string().trim().min(1).max(200)).max(5),
  limitations: z.array(z.string().trim().min(1).max(200)).min(1).max(5),
  /** Avaliação física completa (avaliações anteriores à ampliação não trazem). */
  physique: physiqueSchema.optional(),
});
export type BodyAssessmentResult = z.infer<typeof bodyAssessmentResultSchema>;
