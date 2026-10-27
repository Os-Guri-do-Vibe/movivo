import { z } from 'zod';

/**
 * Check-in adaptativo: o sistema escolhe só as perguntas que podem mudar a próxima decisão
 * (semana normal = poucas perguntas; queda de adesão ou esforço fora do padrão = perguntas
 * sobre esses fatores).
 */
export const checkInQuestionTypeSchema = z.enum([
  'SCALE_1_5',
  'YES_NO',
  'CHOICE',
  'NUMBER',
  'TEXT',
]);
export type CheckInQuestionType = z.infer<typeof checkInQuestionTypeSchema>;

export const checkInQuestionSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{1,39}$/),
    prompt: z.string().trim().min(1).max(200),
    type: checkInQuestionTypeSchema,
    options: z.array(z.string().trim().min(1).max(80)).min(2).max(8).optional(),
    /** Por que a pergunta entrou neste check-in (aparece no painel, não para o aluno). */
    reason: z.string().trim().min(1).max(160),
  })
  .refine((q) => (q.type === 'CHOICE') === (q.options !== undefined), {
    message: 'Só perguntas de escolha têm opções, e toda pergunta de escolha precisa delas.',
    path: ['options'],
  });
export type CheckInQuestion = z.infer<typeof checkInQuestionSchema>;

export const checkInAnswerSchema = z.union([z.number(), z.boolean(), z.string().max(1_000)]);
export const checkInAnswersSchema = z.record(z.string(), checkInAnswerSchema);
export type CheckInAnswers = z.infer<typeof checkInAnswersSchema>;

export const checkInStatusSchema = z.enum(['SENT', 'ANSWERED', 'EXPIRED']);
export type CheckInStatus = z.infer<typeof checkInStatusSchema>;

export const checkInKindSchema = z.enum(['WEEKLY', 'MILESTONE', 'AD_HOC']);
export type CheckInKind = z.infer<typeof checkInKindSchema>;
