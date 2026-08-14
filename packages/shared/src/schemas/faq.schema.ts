import { z } from 'zod';

import { controlCenterMetaSchema } from './control-center.schema';

export const FAQ_QUESTION_PATTERN = /^[A-Za-zÀ-ú0-9 ,.\-'()?!]{5,300}$/;

export const faqCandidateSchema = z.object({
  canonicalQuestion: z
    .string()
    .trim()
    .regex(FAQ_QUESTION_PATTERN, 'pergunta inválida (5-300 caracteres, sem marcação)'),
  answer: z.string().trim().min(10).max(1200),
});
export type FaqCandidate = z.infer<typeof faqCandidateSchema>;

export const publishFaqEntrySchema = faqCandidateSchema.extend({
  faqKey: z.uuid().optional(),
  changeNote: z.string().trim().min(5).max(500),
});
export type PublishFaqEntryInput = z.infer<typeof publishFaqEntrySchema>;

export const rollbackFaqEntrySchema = z.object({
  faqKey: z.uuid(),
  targetVersion: z.int().positive(),
  changeNote: z.string().trim().min(5).max(500),
});
export type RollbackFaqEntryInput = z.infer<typeof rollbackFaqEntrySchema>;

export const retireFaqEntrySchema = z.object({
  faqKey: z.uuid(),
  changeNote: z.string().trim().min(5).max(500),
});
export type RetireFaqEntryInput = z.infer<typeof retireFaqEntrySchema>;

export const faqEntryVersionSchema = faqCandidateSchema.extend({
  id: z.uuid(),
  faqKey: z.uuid(),
  version: z.int().positive(),
  status: z.enum(['PUBLISHED', 'RETIRED']),
  changeNote: z.string(),
  createdBy: z.string().nullable(),
  createdAt: z.iso.datetime(),
  current: z.boolean(),
});
export type FaqEntryVersion = z.infer<typeof faqEntryVersionSchema>;

export const faqEntriesResponseSchema = z.object({
  data: z.object({ versions: z.array(faqEntryVersionSchema) }),
  meta: controlCenterMetaSchema,
});
export type FaqEntriesResponse = z.infer<typeof faqEntriesResponseSchema>;
