import { z } from 'zod';

import {
  photoAngleSchema,
  physiqueMuscleRegionSchema,
  physiqueMuscleStatusSchema,
  postureRegionSchema,
} from './body.schema';

/**
 * Avaliação física por foto, como a ficha do aluno a entrega para AUDITORIA (Control Center).
 *
 * É a leitura da IA já pronta para a tela: só texto e etiquetas. As imagens e os caminhos de
 * armazenamento nunca entram aqui. Os textos não repetem os limites de tamanho da geração
 * (`bodyAssessmentResultSchema`) de propósito: a tela de auditoria precisa abrir também
 * leituras antigas, gravadas antes de regras novas.
 */
export const photoAssessmentPostureDegreeSchema = z.enum(['NONE_VISIBLE', 'MILD', 'NOTABLE']);
export type PhotoAssessmentPostureDegree = z.infer<typeof photoAssessmentPostureDegreeSchema>;

export const photoAssessmentPhysiqueAuditSchema = z.object({
  muscleGroups: z.array(
    z.object({
      region: physiqueMuscleRegionSchema,
      status: physiqueMuscleStatusSchema,
      note: z.string(),
    }),
  ),
  posture: z.array(
    z.object({
      region: postureRegionSchema,
      finding: z.string(),
      degree: photoAssessmentPostureDegreeSchema,
      seenIn: z.array(photoAngleSchema),
    }),
  ),
  symmetry: z.string().nullable(),
  strengths: z.array(z.string()),
  attentionPoints: z.array(z.string()),
});
export type PhotoAssessmentPhysiqueAudit = z.infer<typeof photoAssessmentPhysiqueAuditSchema>;

export const photoAssessmentAuditSchema = z.object({
  id: z.uuid(),
  /** Dia da avaliação (`YYYY-MM-DD`). */
  assessedOn: z.iso.date(),
  /** Quantas fotos entraram na leitura (as imagens não vêm). */
  photoCount: z.number().int().nonnegative(),
  confidence: z.enum(['LOW', 'MEDIUM']),
  /** Gordura corporal sempre em faixa (%); `null` quando a foto não permitiu estimar. */
  bodyFatRange: z.object({ min: z.number(), max: z.number() }).nullable(),
  /** O que a IA comparou com a avaliação anterior, quando havia fotos comparáveis. */
  comparisonSummary: z.string().nullable(),
  observationsForProfessional: z.array(z.string()),
  limitations: z.array(z.string()),
  /** Avaliação física completa; `null` nas avaliações feitas antes da ampliação. */
  physique: photoAssessmentPhysiqueAuditSchema.nullable(),
});
export type PhotoAssessmentAudit = z.infer<typeof photoAssessmentAuditSchema>;

/**
 * A avaliação mais recente e a anterior (para comparar). As duas `null` quando o aluno não
 * enviou fotos, não autorizou o uso delas ou ainda não foi avaliado.
 */
export const studentPhotoAssessmentsSchema = z.object({
  latest: photoAssessmentAuditSchema.nullable(),
  previous: photoAssessmentAuditSchema.nullable(),
});
export type StudentPhotoAssessments = z.infer<typeof studentPhotoAssessmentsSchema>;
