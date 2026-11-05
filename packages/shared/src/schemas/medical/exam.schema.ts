/**
 * Exames enviados pelo aluno no WhatsApp: leitura dos valores (visão), comentário cauteloso ao
 * aluno (sem diagnóstico) e o que fica registrado para o médico (CRM) da equipe.
 */
import { z } from 'zod';

export const examValueFlagSchema = z.enum(['HIGH', 'LOW', 'NORMAL', 'UNCLEAR']);

export const examValueSchema = z.object({
  name: z.string().trim().min(1).max(80),
  value: z.string().trim().min(1).max(40),
  unit: z.string().trim().max(30).nullable(),
  referenceRange: z.string().trim().max(80).nullable(),
  /** Comparação com a referência impressa no próprio laudo; sem referência = UNCLEAR. */
  flag: examValueFlagSchema,
});
export type ExamValue = z.infer<typeof examValueSchema>;

/** Saída da leitura (visão): só o que está escrito no documento. */
export const examReadingSchema = z.object({
  isExam: z.boolean(),
  examType: z.string().trim().max(80).nullable(),
  examDate: z.iso.date().nullable(),
  values: z.array(examValueSchema).max(80),
  legibility: z.enum(['GOOD', 'PARTIAL', 'POOR']),
});
export type ExamReading = z.infer<typeof examReadingSchema>;

export const examUrgencySchema = z.enum(['ROUTINE', 'SOON', 'URGENT']);

/** Saída do comentário: mensagem ao aluno + o que vira contexto e registro para o médico. */
export const examCommentSchema = z.object({
  /** Texto enviado ao aluno no WhatsApp. */
  message: z.string().trim().min(1).max(1500),
  attentionPoints: z
    .array(
      z.object({
        marker: z.string().trim().min(1).max(80),
        status: examValueFlagSchema,
        note: z.string().trim().min(1).max(240),
      }),
    )
    .max(15),
  /** Especialidades médicas sugeridas para a consulta (ex.: Endocrinologia). */
  specialties: z.array(z.string().trim().min(1).max(60)).max(4),
  urgency: examUrgencySchema,
  /** Resumo curto que entra no contexto de saúde do aluno (planejamento e acompanhamento). */
  contextSummary: z.string().trim().min(1).max(300),
});
export type ExamComment = z.infer<typeof examCommentSchema>;

export const medicalExamStatusSchema = z.enum(['RECEIVED', 'COMMENTED', 'NOT_EXAM', 'FAILED']);

/** Exame na ficha do aluno (painel). */
export const medicalExamViewSchema = z.object({
  id: z.uuid(),
  receivedAt: z.iso.datetime({ offset: true }),
  status: medicalExamStatusSchema,
  reading: examReadingSchema.nullable(),
  comment: examCommentSchema.nullable(),
});
export type MedicalExamView = z.infer<typeof medicalExamViewSchema>;
