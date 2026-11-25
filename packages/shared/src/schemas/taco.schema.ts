import { z } from 'zod';

import { controlCenterMetaSchema } from './control-center.schema';
import { nutrientsPer100gSchema } from './nutrition/nutrition.schema';

/** Teto do CSV da TACO enviado pelo painel (a tabela inteira tem ~600 linhas, bem abaixo disso). */
export const MAX_TACO_CSV_CHARS = 1_500_000;

export const importTacoSchema = z.object({
  csv: z.string().min(50).max(MAX_TACO_CSV_CHARS),
  fileName: z.string().trim().min(1).max(200).optional(),
});
export type ImportTacoInput = z.infer<typeof importTacoSchema>;

export const tacoCatalogResponseSchema = z.object({
  data: z.object({
    tacoCount: z.number().int().nonnegative(),
    otherCount: z.number().int().nonnegative(),
    lastImportedAt: z.iso.datetime().nullable(),
    categories: z.array(z.object({ name: z.string(), count: z.number().int().positive() })),
    /** Resultado da importação que acabou de rodar; `null` numa simples consulta. */
    lastImport: z
      .object({ imported: z.number().int().nonnegative(), skipped: z.number().int().nonnegative() })
      .nullable(),
  }),
  meta: controlCenterMetaSchema,
});
export type TacoCatalogResponse = z.infer<typeof tacoCatalogResponseSchema>;

/** Um alimento da base como está guardado: o que o painel mostra na tabela de conferência. */
export const tacoFoodSchema = z.object({
  id: z.string().min(1),
  /** Número do alimento na planilha oficial da TACO (ou o número que o complemento ocupa nela). */
  code: z.string().min(1).max(32),
  /** Quem publica os valores quando NÃO é a TACO (um complemento: USDA, Embrapa...); `null` na TACO. */
  origin: z.string().min(1).max(32).nullable(),
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(80),
  per100g: nutrientsPer100gSchema,
});
export type TacoCatalogFood = z.infer<typeof tacoFoodSchema>;

export const tacoFoodsResponseSchema = z.object({
  data: z.object({ foods: z.array(tacoFoodSchema) }),
  meta: controlCenterMetaSchema,
});
export type TacoFoodsResponse = z.infer<typeof tacoFoodsResponseSchema>;
