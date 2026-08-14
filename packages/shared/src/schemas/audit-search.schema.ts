import { z } from 'zod';

import { controlCenterMetaSchema } from './control-center.schema';

export const auditSearchQuerySchema = z.object({
  actorId: z.uuid().optional(),
  action: z.string().trim().min(1).max(80).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
});
export type AuditSearchQuery = z.infer<typeof auditSearchQuerySchema>;

export const auditSearchEventSchema = z.object({
  id: z.number().int().nonnegative(),
  actorId: z.uuid(),
  actorName: z.string().nullable(),
  subjectId: z.uuid(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.uuid(),
  createdAt: z.iso.datetime(),
});

export const auditSearchResponseSchema = z.object({
  data: z.object({
    events: z.array(auditSearchEventSchema),
    actors: z.array(z.object({ id: z.uuid(), name: z.string().nullable() })),
    actions: z.array(z.string()),
    pagination: z.object({
      page: z.number().int().positive(),
      pageSize: z.number().int().positive(),
      total: z.number().int().nonnegative(),
      totalPages: z.number().int().nonnegative(),
    }),
  }),
  meta: controlCenterMetaSchema,
});
export type AuditSearchResponse = z.infer<typeof auditSearchResponseSchema>;
