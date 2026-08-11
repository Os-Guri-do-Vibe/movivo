/**
 * `data_block_2` — o bloco cifrado da anamnese v2 (US-6.3 / US-6.7 / US-6.8).
 *
 * É o ÚNICO lugar onde vive dado de saúde da sessão. Reúne, no mesmo `bytea`
 * cifrado por `HealthCipherService`:
 *  - **seção 4** (`pain`) — dor localizada, intensidade, tendência, diagnóstico
 *    informado, acompanhamento, recomendação de evitação (LGPD Art. 11);
 *  - **todo texto livre** da anamnese (`freeText`) — por recomendação vinculante de
 *    Alexandre §5.7: é o vetor pelo qual dado sensível entra em coluna não
 *    classificada como sensível, e é mais barato cifrar tudo que é livre do que
 *    auditar o que o usuário digitou;
 *  - o **PAR-Q** (`parq`) e as **3 declarações finais** (`declarations`).
 *
 * O bloco é escrito em duas etapas (2 e 3), então toda escrita é um **merge**:
 * decifra o que existe, funde o pedaço novo, recifra. Nunca sobrescreve o todo.
 */
import { z } from 'zod';

import {
  anamnesisFreeTextSchema,
  painAssessmentSchema,
  parqSchema,
  PARQ_DECLARATIONS_VERSION,
} from '@movivo/shared';

export const healthBlockSchema = z.object({
  pain: painAssessmentSchema.optional(),
  freeText: anamnesisFreeTextSchema.optional(),
  parq: parqSchema.optional(),
  declarations: z
    .object({
      version: z.literal(PARQ_DECLARATIONS_VERSION),
      accepted: z.array(z.string().max(40)),
      acceptedAt: z.string(),
    })
    .optional(),
});

export type HealthBlock = z.infer<typeof healthBlockSchema>;

/** O bloco está completo para o submit? (seção 4 respondida + PAR-Q + declarações). */
export function isHealthBlockComplete(block: HealthBlock): boolean {
  return block.pain !== undefined && block.parq !== undefined && block.declarations !== undefined;
}
