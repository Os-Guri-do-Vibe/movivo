/**
 * Tarefas de visão: ler um print de treino (relógio/app) e identificar itens de uma refeição.
 *
 * A visão só PROPÕE: os números de treino viram métricas NÃO confirmadas (o aluno confere com
 * um toque) e os itens da refeição viram um rascunho cujos totais saem da base de alimentos.
 * Micronutriente nunca é "visto" numa foto, e valor que não está legível na tela fica de fora.
 */
import { z } from 'zod';

import { enduranceMetricsSchema, mealSlotSchema } from '@movivo/shared';

import { defineAgentTask, type Validator, type Violation } from '../../core/agents/agent-task';
import { outputLanguageViolations } from '../planning/tasks/common';

// --- Print de treino ----------------------------------------------------------------------

export const workoutScreenshotInputSchema = z.object({
  /** Modalidade que o aluno esperava registrar (ajuda a desambiguar; não é prova). */
  expectedModality: z.enum(['RUNNING', 'HYROX', 'STRENGTH', 'EXTERNAL_SPORT']).nullable(),
});
export type WorkoutScreenshotInput = z.infer<typeof workoutScreenshotInputSchema>;

export const workoutScreenshotOutputSchema = z.object({
  kind: z.enum([
    'RUNNING',
    'CYCLING',
    'WALKING',
    'SWIMMING',
    'STRENGTH',
    'OTHER_WORKOUT',
    'NOT_A_WORKOUT',
  ]),
  /** Só o que está LEGÍVEL na imagem. Campo ausente na tela fica ausente aqui. */
  metrics: enduranceMetricsSchema,
  confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  /** Linhas principais lidas, como aparecem na tela (para o aluno conferir). */
  visibleText: z.array(z.string().trim().min(1).max(120)).max(10),
  note: z.string().trim().max(200).nullable(),
});
export type WorkoutScreenshotOutput = z.infer<typeof workoutScreenshotOutputSchema>;

export const workoutScreenshotValidators: Validator<
  WorkoutScreenshotInput,
  WorkoutScreenshotOutput
>[] = [
  (_input, output) => {
    const violations: Violation[] = [];
    const m = output.metrics;
    if (output.kind === 'NOT_A_WORKOUT' && Object.keys(m).length > 0) {
      violations.push({ path: 'metrics', message: 'imagem que não é treino não tem métricas' });
    }
    if (
      m.avgHeartRate !== undefined &&
      m.maxHeartRate !== undefined &&
      m.avgHeartRate > m.maxHeartRate
    ) {
      violations.push({ path: 'metrics.avgHeartRate', message: 'FC média acima da máxima' });
    }
    const seconds = m.movingSeconds ?? m.elapsedSeconds;
    if (m.distanceMeters && seconds && m.avgPaceSecondsPerKm) {
      const implied = (seconds / m.distanceMeters) * 1000;
      if (Math.abs(implied - m.avgPaceSecondsPerKm) / m.avgPaceSecondsPerKm > 0.08) {
        violations.push({
          path: 'metrics.avgPaceSecondsPerKm',
          message: `o ritmo informado (${m.avgPaceSecondsPerKm}s/km) não bate com distância e tempo (${Math.round(implied)}s/km): releia os números`,
        });
      }
    }
    if (
      output.kind !== 'NOT_A_WORKOUT' &&
      output.confidence !== 'LOW' &&
      !m.distanceMeters &&
      !seconds &&
      output.kind !== 'STRENGTH'
    ) {
      violations.push({
        path: 'confidence',
        message: 'sem distância nem tempo legíveis a confiança não pode passar de LOW',
      });
    }
    return violations;
  },
  (_input, output) => outputLanguageViolations({ note: output.note }),
];

export const workoutScreenshotTask = defineAgentTask<
  WorkoutScreenshotInput,
  WorkoutScreenshotOutput
>({
  id: 'vision.extract_workout_screenshot',
  role: 'Analista visual da MOVIVO. Você lê prints de aplicativos e relógios de treino e transcreve os números que estão claramente visíveis, sem inventar nada.',
  instructions: `Leia o print anexado e extraia o resumo do treino.

Regras:
1. "kind": o tipo de atividade que a tela mostra. Se a imagem NÃO é um resumo de treino (conversa, foto, outra tela), use NOT_A_WORKOUT e deixe "metrics" vazio ({}).
2. "metrics": só o que está LEGÍVEL. Converta unidades: distância em METROS (5,02 km → 5020; "32.4 km" → 32400), tempos em SEGUNDOS (28:14 → 1694; 1:12:05 → 4325), ritmo em segundos por km (5:37 /km → 337). Velocidade em km/h NÃO é ritmo: se a tela traz só km/h, calcule o ritmo apenas se distância e tempo estiverem visíveis (senão omita). Cadência em passos por minuto. Campo que não aparece na tela NÃO entra na resposta.
3. Decimal brasileiro usa vírgula ("5,02") e inglês usa ponto ("5.02"): leia pelo contexto.
4. "visibleText": as linhas principais como aparecem na tela (ex.: "Distância 5,02 km"), para o aluno conferir.
5. "confidence": HIGH só quando todos os números principais estão nítidos; LOW se a imagem está cortada, borrada ou ambígua. Se não der para ler, diga em "note".
6. Nunca interprete desempenho, saúde ou frequência cardíaca; apenas transcreva.`,
  tier: 'VISION',
  methodology: [],
  state: [],
  input: workoutScreenshotInputSchema,
  output: workoutScreenshotOutputSchema,
  validators: workoutScreenshotValidators,
  maxCorrectionRounds: 2,
});

// --- Foto de refeição ---------------------------------------------------------------------

export const mealPhotoInputSchema = z.object({
  mealHint: mealSlotSchema.nullable(),
  /** Descrição que o aluno escreveu junto da foto, se houver. */
  caption: z.string().trim().max(200).nullable(),
});
export type MealPhotoInput = z.infer<typeof mealPhotoInputSchema>;

export const mealPhotoOutputSchema = z.object({
  notFood: z.boolean(),
  mealSlotGuess: mealSlotSchema.nullable(),
  items: z
    .array(
      z.object({
        /** Nome do alimento em português, como na tabela de composição (ex.: "arroz branco cozido"). */
        label: z.string().trim().min(1).max(80),
        /** Porção estimada em gramas (estimativa visual, o aluno ajusta). */
        estimatedGrams: z.number().min(5).max(1_500),
        confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']),
      }),
    )
    .max(12),
  note: z.string().trim().max(200).nullable(),
});
export type MealPhotoOutput = z.infer<typeof mealPhotoOutputSchema>;

export const mealPhotoValidators: Validator<MealPhotoInput, MealPhotoOutput>[] = [
  (_input, output) => {
    const violations: Violation[] = [];
    if (output.notFood && output.items.length > 0) {
      violations.push({ path: 'items', message: 'imagem sem comida não tem itens' });
    }
    if (!output.notFood && output.items.length === 0) {
      violations.push({ path: 'items', message: 'liste os alimentos visíveis ou marque notFood' });
    }
    const labels = output.items.map((i) => i.label.toLowerCase());
    if (new Set(labels).size !== labels.length) {
      violations.push({ path: 'items', message: 'há alimentos repetidos; junte as porções' });
    }
    const total = output.items.reduce((sum, i) => sum + i.estimatedGrams, 0);
    if (total > 2_500) {
      violations.push({
        path: 'items',
        message: `porção total de ${total} g é implausível para uma refeição`,
      });
    }
    return violations;
  },
  (_input, output) => outputLanguageViolations({ note: output.note }),
];

export const mealPhotoTask = defineAgentTask<MealPhotoInput, MealPhotoOutput>({
  id: 'vision.identify_meal',
  role: 'Analista visual da MOVIVO. Você identifica os alimentos de uma foto de refeição e estima as porções em gramas, deixando claro que é estimativa.',
  instructions: `Identifique os alimentos da foto da refeição.

Regras:
1. Se a imagem não mostra comida, "notFood": true e "items": [].
2. Um item por alimento distinto, com nome em português no padrão de tabela de composição (ex.: "arroz branco cozido", "peito de frango grelhado", "feijão carioca cozido", "salada de alface"). Molhos e óleos visíveis entram como itens.
3. "estimatedGrams": estimativa da porção servida (use o prato, talheres e a mão como referência). É sempre estimativa: confidence MEDIUM ou LOW quando a porção é difícil de julgar.
4. NUNCA estime calorias, macros ou micronutrientes: o cálculo é feito depois, a partir da tabela de alimentos. Não comente saúde nem dieta.
5. Use "caption" e "mealHint" só para desambiguar; o que vale é o que se vê.`,
  tier: 'VISION',
  methodology: [],
  state: [],
  input: mealPhotoInputSchema,
  output: mealPhotoOutputSchema,
  validators: mealPhotoValidators,
  maxCorrectionRounds: 2,
});
