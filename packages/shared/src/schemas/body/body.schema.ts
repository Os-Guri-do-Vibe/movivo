import { z } from 'zod';

export const measurementKindSchema = z.enum([
  'WEIGHT',
  'WAIST',
  'HIP',
  'NECK',
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
  HIP: 'Quadril',
  NECK: 'Pescoço',
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
  NECK: 'cm',
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

const MEASUREMENT_BOUNDS: Readonly<Record<MeasurementKind, [number, number]>> = {
  WEIGHT: [30, 300],
  WAIST: [40, 250],
  HIP: [50, 250],
  NECK: [20, 70],
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

export const photoAngleSchema = z.enum(['FRONT', 'SIDE', 'BACK']);
export type PhotoAngle = z.infer<typeof photoAngleSchema>;

/** Verificação de padronização da foto (feita pela visão antes de qualquer análise). */
export const photoQualitySchema = z.object({
  usable: z.boolean(),
  issues: z.array(
    z.enum(['LIGHTING', 'DISTANCE', 'POSE', 'CLOTHING', 'FRAMING', 'BLUR', 'NOT_A_BODY_PHOTO']),
  ),
});
export type PhotoQuality = z.infer<typeof photoQualitySchema>;

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
});
export type BodyAssessmentResult = z.infer<typeof bodyAssessmentResultSchema>;
