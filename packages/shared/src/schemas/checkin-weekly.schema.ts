/**
 * Formulário web de check-in semanal (achado 2026-09-13, substitui o fluxo de botão de
 * WhatsApp). 8 perguntas, envio único — sem salvamento de progresso por etapa como a
 * renovação de mesociclo, porque o formulário é curto o bastante para ser respondido numa
 * única visita.
 *
 * Pergunta 1 reaproveita `renewalSleepQualitySchema` (mesmas opções do formulário de fim
 * de mesociclo, pedido explícito do fundador) — nunca redeclara esse vocabulário.
 */
import { z } from 'zod';

import { renewalSleepQualitySchema } from './protocol-renewal.schema';

export { renewalSleepQualitySchema as checkinWeeklySleepQualitySchema };

export const checkinWeeklyMoodSchema = z.enum([
  'MUITO_FELIZ',
  'FELIZ',
  'NEUTRO',
  'TRISTE',
  'DESMOTIVADO',
  'PREFIRO_NAO_RESPONDER',
]);
export type CheckinWeeklyMood = z.infer<typeof checkinWeeklyMoodSchema>;

export const checkinWeeklyChangeSchema = z.enum([
  'FORCA',
  'RESISTENCIA',
  'MASSA_MUSCULAR',
  'QUALIDADE_SONO',
  'TECNICA',
  'BEM_ESTAR_MENTAL',
  'OUTRAS',
]);
export type CheckinWeeklyChange = z.infer<typeof checkinWeeklyChangeSchema>;

export const checkinWeeklyDurationFitSchema = z.enum(['ADEQUADA', 'MAIS_CURTOS', 'MAIS_LONGOS']);
export type CheckinWeeklyDurationFit = z.infer<typeof checkinWeeklyDurationFitSchema>;

export const checkinWeeklySubmitSchema = z
  .object({
    /** Pergunta 1 — mesmas opções da pergunta de sono da renovação de mesociclo. */
    sleepQuality: renewalSleepQualitySchema,
    /** Pergunta 2. */
    mood: checkinWeeklyMoodSchema,
    /** Pergunta 3 — 0 = alimentação muito ruim, 10 = excelente. */
    nutritionScore: z.number().int().min(0).max(10),
    /** Pergunta 4 — 0 = não realizou nenhum treino planejado, 10 = todos. */
    adherenceScore: z.number().int().min(0).max(10),
    /**
     * Pergunta 5 — texto livre, vazio = "nenhuma dificuldade". Vai para o bloco cifrado
     * (pode mencionar dor/desconforto — LGPD Art. 11).
     */
    difficultExerciseDescription: z.string().trim().max(2000).optional(),
    /** Pergunta 6 — múltipla escolha; `OUTRAS` exige `changesOther`. */
    changesNoticed: z.array(checkinWeeklyChangeSchema).default([]),
    changesOther: z.string().trim().max(300).optional(),
    /** Pergunta 7. */
    durationFit: checkinWeeklyDurationFitSchema,
    /** Pergunta 8 — opcional, texto livre. Vai para o bloco cifrado. */
    improvementFeedback: z.string().trim().max(2000).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.changesNoticed.includes('OUTRAS') && !val.changesOther) {
      ctx.addIssue({
        code: 'custom',
        path: ['changesOther'],
        message: 'Conte quais mudanças você percebeu.',
      });
    }
  });
export type CheckinWeeklySubmit = z.infer<typeof checkinWeeklySubmitSchema>;

/**
 * Projeção pública de uma sessão de check-in (`GET session/:token`) — nunca inclui os
 * campos de texto livre cifrados (mesma regra do bloco 3 da renovação de mesociclo:
 * dado sensível nunca volta em claro depois de gravado).
 */
export const checkinWeeklySessionViewSchema = z.object({
  status: z.enum(['PENDING', 'SUBMITTED', 'EXPIRED']),
  firstName: z.string().nullable(),
  weekNumber: z.number().int(),
});
export type CheckinWeeklySessionView = z.infer<typeof checkinWeeklySessionViewSchema>;
