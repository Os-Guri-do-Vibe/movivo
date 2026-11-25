import { z } from 'zod';

export const modelVendorSchema = z.enum(['DEEPSEEK', 'OPENAI', 'ANTHROPIC']);
export const modelTierSchema = z.enum(['FAST', 'STANDARD', 'REASONING', 'VISION']);
export type ModelTierName = z.infer<typeof modelTierSchema>;

export const tierRouteSchema = z.object({
  vendor: modelVendorSchema,
  model: z.string().trim().min(1).max(80),
  maxOutputTokens: z.number().int().min(100).max(64_000),
  timeoutMs: z.number().int().min(1_000).max(600_000),
  temperature: z.number().min(0).max(1),
  vision: z.boolean(),
});

/** Rotas de um nível, em ordem de failover (a primeira é a preferida). */
export const saveTierRoutesRequestSchema = z
  .object({ routes: z.array(tierRouteSchema).min(1).max(4) })
  .refine((v) => new Set(v.routes.map((r) => `${r.vendor}:${r.model}`)).size === v.routes.length, {
    message: 'Rotas repetidas no mesmo nível.',
    path: ['routes'],
  });
export type SaveTierRoutesRequest = z.infer<typeof saveTierRoutesRequestSchema>;
