/**
 * Cap table e distribuição por sócio (US-8.7).
 *
 * A distribuição é aritmética simples — lucro do período × participação vigente — e
 * exatamente por isso as três ressalvas de governança viajam **no payload**, não em
 * comentário de código nem em texto solto do frontend: qualquer consumidor da rota
 * recebe o número junto com o que ele não é.
 */
import { z } from 'zod';

import { controlCenterMetaSchema } from './control-center.schema';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar em `YYYY-MM-DD`.');

/** Total de pontos-base de um cap table fechado. 2000 bps = 20%. */
export const TOTAL_SHARE_BASIS_POINTS = 10_000;

/**
 * Ressalvas obrigatórias na resposta (validadas com Alexandre e Eduardo).
 *
 * (a) e o gap de vesting vêm de `06-relatorio-alexandre.md`; (b) e (c) de
 * `07-relatorio-eduardo.md`. Exibir distribuição sem elas daria aparência de acordo
 * formalizado a algo que não está formalizado.
 */
export const PARTNER_DISTRIBUTION_CAVEATS: readonly string[] = [
  'Não considera vesting: o Acordo de Sócios com cliff de 12 meses e vesting total de 48 meses ainda não foi formalizado. O cálculo usa a participação atual registrada.',
  'Não considera reserva de caixa: é distribuição bruta de referência gerencial. Distribuir 100% do lucro de um mês bom é como se quebra uma empresa financiada pelo próprio caixa.',
  'Não é pró-labore nem dividendo declarado: é número gerencial. A forma de retirada e a implicação tributária no Simples Nacional (Anexo III) são definição do contador.',
];

export const partnerShareSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  /** Pontos-base inteiros — nunca percentual em float. */
  shareBasisPoints: z.number().int(),
  validFrom: isoDate,
  validTo: isoDate.nullable(),
  notes: z.string().nullable(),
});
export type PartnerShare = z.infer<typeof partnerShareSchema>;

export const partnerDistributionResponseSchema = z.object({
  data: z.object({
    /** `YYYY-MM` do período apurado (mês corrente, fuso America/Sao_Paulo). */
    period: z.string(),
    /** Lucro do período em centavos inteiros. Negativo é prejuízo e é exibido como tal. */
    profitCents: z.number().int(),
    /** `false` quando não há despesa lançada: sem custo não existe lucro a distribuir. */
    profitAvailable: z.boolean(),
    profitDefinition: z.string(),
    partners: z.array(
      partnerShareSchema.extend({
        /** `profitCents × shareBasisPoints ÷ 10.000`, truncado para centavo inteiro. */
        amountCents: z.number().int(),
      }),
    ),
    totalBasisPoints: z.number().int(),
    caveats: z.array(z.string()),
  }),
  // Mesmo envelope dos demais setores do Control Center — o fuso é literal para que a
  // resposta case com `ControlCenterMeta` sem cast na UI.
  meta: controlCenterMetaSchema,
});
export type PartnerDistributionResponse = z.infer<typeof partnerDistributionResponseSchema>;

/**
 * Nova composição societária, sempre **completa**: a lista enviada substitui a vigente
 * inteira, e é ela que precisa somar 10.000 bps. Alterar um sócio isolado deixaria o cap
 * table aberto por construção — por isso não existe endpoint de "editar participação".
 */
export const replacePartnersSchema = z.object({
  validFrom: isoDate,
  partners: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(160),
        shareBasisPoints: z.number().int().positive().max(TOTAL_SHARE_BASIS_POINTS),
        notes: z.string().trim().max(500).nullish(),
      }),
    )
    .min(1)
    .max(50),
  reason: z.string().trim().min(3).max(500),
});
export type ReplacePartnersInput = z.input<typeof replacePartnersSchema>;
