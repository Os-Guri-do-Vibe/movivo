import { z } from 'zod';

/** Aprovar a proposta pendente: a nota é opcional. */
export const approveExceptionRequestSchema = z.object({
  note: z.string().trim().max(1_000).optional(),
});

/** Recusar a proposta ou encerrar o caso exige dizer por quê (fica na trilha). */
export const closeExceptionRequestSchema = z.object({
  note: z.string().trim().min(3).max(1_000),
});
export type CloseExceptionRequest = z.infer<typeof closeExceptionRequestSchema>;
