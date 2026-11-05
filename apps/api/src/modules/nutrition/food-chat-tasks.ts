/**
 * Retorno de cada refeição registrada pelo WhatsApp: a lista e os números vêm do código; o
 * nutricionista (na voz da persona) escreve só a observação curta que fecha a mensagem.
 */
import { z } from 'zod';

import { defineAgentTask, type Validator } from '../../core/agents/agent-task';
import { languageViolations } from '../planning/tasks/common';
import { toneViolations } from '../progress/tasks';
import { numbersIn, unknownNumbers } from './meal-routine';

export const foodLogAckInputSchema = z.object({
  firstName: z.string().max(60).nullable(),
  mealLabel: z.string().max(40),
  items: z.array(z.object({ label: z.string().max(80), grams: z.number() })).max(20),
  meal: z.object({
    energyKcal: z.number(),
    proteinG: z.number(),
    carbsG: z.number(),
    fatG: z.number(),
  }),
  /** O que o plano previa para essa refeição (energia e proteína), se houver. */
  planned: z.object({ energyKcal: z.number(), proteinG: z.number() }).nullable(),
  dayTotals: z.object({
    energyKcal: z.number(),
    proteinG: z.number(),
    carbsG: z.number(),
    fatG: z.number(),
  }),
  dayTargets: z
    .object({ energyMinKcal: z.number(), energyMaxKcal: z.number(), proteinG: z.number() })
    .nullable(),
  /** Refeições que ainda faltam no dia. */
  remainingMeals: z.array(z.string().max(40)).max(8),
  /** Itens que a base de alimentos não reconheceu (os totais ficam subestimados). */
  unmatchedItems: z.number().int().min(0),
  source: z.enum(['TEXT', 'PHOTO']),
});
export type FoodLogAckInput = z.infer<typeof foodLogAckInputSchema>;

export const foodLogAckOutputSchema = z.object({
  /** Uma observação curta e útil, no máximo duas frases. */
  comment: z.string().trim().min(5).max(280),
});
export type FoodLogAckOutput = z.infer<typeof foodLogAckOutputSchema>;

export const foodLogAckValidators: Validator<FoodLogAckInput, FoodLogAckOutput>[] = [
  (input, output) => {
    const extras = unknownNumbers(output.comment, [
      ...numbersIn(input),
      ...(input.dayTargets
        ? [
            input.dayTargets.proteinG - input.dayTotals.proteinG,
            input.dayTargets.energyMinKcal - input.dayTotals.energyKcal,
            input.dayTargets.energyMaxKcal - input.dayTotals.energyKcal,
          ]
        : []),
    ]);
    return extras.length > 0
      ? [{ path: 'comment', message: `números fora dos dados: ${extras.join(', ')}` }]
      : [];
  },
  (_input, output) =>
    languageViolations(output.comment, 'comment').concat(
      toneViolations([{ path: 'comment', text: output.comment }]),
    ),
];

export const foodLogAckTask = defineAgentTask<FoodLogAckInput, FoodLogAckOutput>({
  id: 'nutrition.ack_food_log',
  role: 'Nutricionista da MOVIVO acompanhando o aluno pelo WhatsApp (a persona). Quando ele registra uma refeição você responde como quem está do lado: curto, humano e útil.',
  instructions: `O aluno acabou de registrar uma refeição e o sistema já mostra a lista e os números. Escreva só a observação que fecha a mensagem.

Regras:
1. No máximo 2 frases curtas. Reconheça algo concreto do prato (proteína, fibra, variedade, boa escolha) e, se fizer sentido, UMA orientação prática para o resto do dia, olhando "dayTotals" contra "dayTargets" e "remainingMeals" (ex.: "ainda faltam uns 40 g de proteína; o jantar com frango fecha").
2. Cite apenas números dos dados (ou a diferença entre eles). Se "unmatchedItems" for maior que zero, diga com leveza que algum item foi estimado.
3. Fora do plano, sem julgar: registre como dado e, se couber, mostre como encaixar no dia. Nunca diga "pecou", "errou", "estourou".
4. Se foi por foto ("source" PHOTO), lembre que as porções são estimativas e que ele pode corrigir, só se couber naturalmente.
5. Sem diagnóstico, sem suplemento, sem promessa. Estratégia de restrição energética: nunca estimule pular refeição.`,
  tier: 'FAST',
  methodology: ['NUTRITION', 'COMMUNICATION'],
  state: ['memory', 'conversation'],
  input: foodLogAckInputSchema,
  output: foodLogAckOutputSchema,
  validators: foodLogAckValidators,
  maxCorrectionRounds: 2,
});
