/**
 * Comparação visual de fim de ciclo: início × agora, posição a posição. A visão descreve o que se
 * VÊ mudar (definição, volume, postura) em linguagem respeitosa e dá, no máximo, uma FAIXA de
 * gordura corporal com a incerteza que ela tem; nunca diagnostica. O resultado vira contexto
 * para a análise do ciclo e para o profissional, não um veredito.
 */
import { z } from 'zod';

import { photoAngleSchema, physiqueSchema } from '@movivo/shared';

import { defineAgentTask, type Validator, type Violation } from '../../core/agents/agent-task';
import { PHYSIQUE_READING_RULES, physiqueViolations } from '../body-assessment/physique-tasks';
import { fold, outputLanguageViolations } from '../planning/tasks/common';

export const photoComparisonInputSchema = z.object({
  /** Ordem das imagens enviadas: para cada posição, a de início e depois a de agora. */
  order: z
    .array(z.object({ angle: photoAngleSchema, when: z.enum(['START', 'NOW']) }))
    .min(2)
    .max(8),
  daysBetween: z.number().int().nullable(),
  biologicalSex: z.string().max(16).nullable(),
});
export type PhotoComparisonInput = z.infer<typeof photoComparisonInputSchema>;

export const photoComparisonSchema = z.object({
  /** As fotos permitem comparar (corpo inteiro, luz e distância parecidas)? */
  comparable: z.boolean(),
  /** O que se vê mudar, em frases curtas e respeitosas (vazio quando não dá para comparar). */
  visibleChanges: z.array(z.string().trim().min(8).max(200)).max(5),
  /** Faixa da gordura corporal AGORA; nunca um número único. `null` quando não dá para estimar. */
  bodyFatRange: z
    .object({ min: z.number().min(3).max(70), max: z.number().min(3).max(70) })
    .refine((r) => r.min <= r.max)
    .nullable(),
  confidence: z.enum(['LOW', 'MEDIUM']),
  /** Pontos de postura ou simetria só para avaliação profissional. */
  observationsForProfessional: z.array(z.string().trim().min(8).max(200)).max(4),
  /** Por que a leitura tem margem de erro (luz, ângulo, roupa, distância). */
  limitations: z.array(z.string().trim().min(8).max(200)).min(1).max(4),
  /** Avaliação física completa AGORA (grupos musculares, postura e simetria). */
  physique: physiqueSchema,
});
export type PhotoComparison = z.infer<typeof photoComparisonSchema>;

const HARSH = /\b(obes|gord[ao]\b|magro demais|flacid|desproporcional|feio|feia|horrivel)/;

export const photoComparisonValidators: Validator<PhotoComparisonInput, PhotoComparison>[] = [
  (_input, output) => {
    const violations: Violation[] = [];
    if (!output.comparable) {
      if (output.visibleChanges.length > 0 || output.bodyFatRange !== null) {
        violations.push({
          path: 'comparable',
          message: 'fotos que não permitem comparar não trazem mudanças nem faixa de gordura',
        });
      }
    } else if (output.bodyFatRange && output.bodyFatRange.max - output.bodyFatRange.min < 4) {
      violations.push({
        path: 'bodyFatRange',
        message: 'a estimativa visual tem margem de pelo menos 4 pontos percentuais',
      });
    }
    if (!output.comparable) {
      const { physique } = output;
      if (physique.muscleGroups.length + physique.posture.length > 0) {
        violations.push({
          path: 'physique',
          message: 'fotos que não permitem comparar não trazem avaliação física',
        });
      }
    }
    return violations;
  },
  (_input, output) => physiqueViolations(output.physique),
  (_input, output) =>
    HARSH.test(fold(JSON.stringify(output)))
      ? [
          {
            path: 'visibleChanges',
            message: 'sem julgamento estético nem termos pejorativos: descreva com neutralidade',
          },
        ]
      : [],
  (_input, output) => outputLanguageViolations(output),
];

export const photoComparisonTask = defineAgentTask<PhotoComparisonInput, PhotoComparison>({
  id: 'vision.compare_body_photos',
  role: 'Analista visual da MOVIVO para acompanhamento de evolução corporal. Você compara fotos padronizadas de início e de agora e descreve, com respeito e cautela, o que mudou.',
  instructions: `Compare as fotos do corpo do aluno: início × agora, na ordem indicada em "order".

Regras:
1. Antes de tudo, veja se dá para comparar: corpo inteiro, luz, distância e pose parecidas. Se não der, "comparable": false e explique em "limitations".
2. "visibleChanges": o que MUDOU de forma visível (definição muscular, volume, contorno da cintura, postura), uma observação por frase, com linguagem neutra e respeitosa. Não invente: se não vê mudança clara, diga que a mudança não é perceptível nas fotos.
3. "bodyFatRange": uma FAIXA para agora, sempre ampla (4 pontos percentuais ou mais) e com "confidence" LOW ou MEDIUM. Sem fotos claras, "null". Nunca um número único, nunca a afirmação de que é medida.
4. Postura e simetria vão em "observationsForProfessional" como pontos para avaliação de um profissional, nunca como diagnóstico.
5. Sem julgamento estético, sem comparar com padrão de beleza, sem comentar rosto ou identidade, sem diagnóstico, sem promessa.
6. Sempre traga ao menos uma limitação (luz, roupa, ângulo, horário das fotos, distância).
7. ${PHYSIQUE_READING_RULES} Faça a avaliação física pelas fotos de AGORA (as de início servem de referência para o que mudou). Se "comparable" for false, deixe tudo em "physique" vazio.`,
  tier: 'VISION',
  methodology: [],
  state: [],
  input: photoComparisonInputSchema,
  output: photoComparisonSchema,
  validators: photoComparisonValidators,
  maxCorrectionRounds: 2,
});
