/**
 * Tarefa `nutrition.interpret_food_log`: transforma "almocei arroz, feijão e um bife" em itens
 * com porção em gramas. O modelo só interpreta o que o aluno disse; os totais saem da base de
 * alimentos (cálculo no servidor) e nada conta antes de o aluno confirmar.
 */
import { z } from 'zod';

import { mealSlotSchema } from '@movivo/shared';

import { defineAgentTask, type Validator, type Violation } from '../../core/agents/agent-task';
import type { Assertion, EvalCase, NamedCheck } from '../../core/agents/eval-case';
import { outputLanguageViolations } from '../planning/tasks/common';

export const foodLogInputSchema = z.object({
  text: z.string().trim().min(2).max(500),
  mealHint: mealSlotSchema.nullable(),
  /** Horário local do registro (HH:mm), para inferir a refeição quando o texto não diz. */
  localTime: z.string().regex(/^\d{2}:\d{2}$/),
});
export type FoodLogInput = z.infer<typeof foodLogInputSchema>;

export const foodLogOutputSchema = z.object({
  meal: mealSlotSchema,
  items: z
    .array(
      z.object({
        /** Nome do alimento no padrão de tabela de composição ("arroz branco cozido"). */
        label: z.string().trim().min(1).max(80),
        grams: z.number().min(1).max(3_000),
        portionSource: z.enum(['DECLARED', 'HOUSEHOLD_MEASURE', 'ESTIMATED']),
      }),
    )
    .max(20),
  /** Pergunta curta, só quando faltou algo essencial para interpretar. */
  needsClarification: z.string().trim().max(160).nullable(),
});
export type FoodLogOutput = z.infer<typeof foodLogOutputSchema>;

const validators: Validator<FoodLogInput, FoodLogOutput>[] = [
  (_input, output) => {
    const violations: Violation[] = [];
    if (output.items.length === 0 && !output.needsClarification) {
      violations.push({
        path: 'items',
        message: 'sem itens, faça uma pergunta curta em needsClarification',
      });
    }
    const labels = output.items.map((i) => i.label.toLowerCase());
    if (new Set(labels).size !== labels.length) {
      violations.push({ path: 'items', message: 'há alimentos repetidos; some as porções' });
    }
    return violations;
  },
  (_input, output) => outputLanguageViolations({ q: output.needsClarification }),
];

export const foodLogTask = defineAgentTask<FoodLogInput, FoodLogOutput>({
  id: 'nutrition.interpret_food_log',
  role: 'Nutricionista de IA da MOVIVO. Você interpreta o que o aluno contou que comeu e transforma em itens com porção em gramas, sem julgar o prato.',
  instructions: `Interprete o relato de refeição.

Regras:
1. Um item por alimento, com nome em português no padrão de tabela de composição ("arroz branco cozido", "feijão carioca cozido", "bife de patinho grelhado", "ovo de galinha mexido", "pão francês", "manteiga").
2. Porção em gramas. Medida declarada ("200 g") → DECLARED. Medida caseira → HOUSEHOLD_MEASURE e converta (referências: colher de sopa de arroz cozido ≈ 25 g; concha de feijão ≈ 90 g; fatia de pão de forma ≈ 25 g; pão francês ≈ 50 g; ovo ≈ 50 g; copo de leite ≈ 200 g; banana média ≈ 100 g; filé de frango médio ≈ 120 g; bife médio ≈ 100 g; colher de chá de azeite ≈ 4 g). Sem medida nenhuma → ESTIMATED com uma porção típica de adulto.
3. "meal": use "mealHint" se vier; senão, o que o texto diz ("almocei", "no café"); senão, o horário local (até 10h café da manhã, 10–12h lanche da manhã, 12–15h almoço, 15–18h lanche da tarde, 18–22h jantar, depois ceia).
4. Se o relato for vago demais para qualquer item ("comi bem"), items vazio e uma pergunta curta em "needsClarification". Não invente alimentos.
5. Não comente se a refeição é boa ou ruim, não diga calorias.`,
  tier: 'STANDARD',
  methodology: [],
  state: [],
  input: foodLogInputSchema,
  output: foodLogOutputSchema,
  validators,
  maxCorrectionRounds: 2,
});

// --- Casos de avaliação ---------------------------------------------------------------------

const path = (
  p: string,
  op: Extract<Assertion, { kind: 'path' }>['op'],
  value: unknown,
  description: string,
): Assertion => ({ kind: 'path', path: p, op, value, description });

const itemMatching = (output: unknown, pattern: RegExp) =>
  ((output as FoodLogOutput).items ?? []).find((item) => pattern.test(item.label.toLowerCase()));

const checks: Record<string, NamedCheck> = {
  doisOvosCercaDe100g: (output) => {
    const egg = itemMatching(output, /ovo/);
    const pass = egg !== undefined && egg.grams >= 80 && egg.grams <= 125;
    return { pass, detail: egg ? `${egg.label}: ${egg.grams} g` : 'sem ovo' };
  },
  arrozFeijaoBifeSalada: (output) => {
    const missing = [/arroz/, /feij/, /(bife|carne)/, /(salada|alface|tomate)/].filter(
      (pattern) => itemMatching(output, pattern) === undefined,
    );
    return { pass: missing.length === 0, detail: missing.map(String).join(', ') || 'ok' };
  },
  semItemInventado: (output) => {
    const items = (output as FoodLogOutput).items ?? [];
    return { pass: items.length === 0, detail: `${items.length} item(ns)` };
  },
};

const baseCase = {
  taskId: foodLogTask.id,
  safetyCritical: false,
  state: {},
  minScore: 1,
} as const;

export const foodLogCases: EvalCase[] = [
  {
    ...baseCase,
    id: 'almoco-completo',
    title: 'Almoço com arroz, feijão, bife e salada',
    input: { text: 'almocei arroz, feijão, um bife e salada', mealHint: null, localTime: '13:10' },
    assertions: [
      path('meal', 'eq', 'LUNCH', 'reconhece o almoço'),
      { kind: 'check', name: 'arrozFeijaoBifeSalada', description: 'traz os quatro itens' },
      path('items.*.grams', 'gte', 1, 'toda porção tem gramas'),
    ],
  },
  {
    ...baseCase,
    id: 'cafe-com-medida-caseira',
    title: 'Café da manhã com medidas caseiras',
    input: {
      text: 'tomei café com 2 ovos mexidos e um pão francês com manteiga',
      mealHint: null,
      localTime: '07:30',
    },
    assertions: [
      path('meal', 'eq', 'BREAKFAST', 'reconhece o café da manhã'),
      { kind: 'check', name: 'doisOvosCercaDe100g', description: '2 ovos ≈ 100 g' },
      path('items', 'lengthGte', 3, 'ovo, pão e manteiga'),
    ],
  },
  {
    ...baseCase,
    id: 'relato-vago',
    title: 'Relato vago pede esclarecimento em vez de inventar itens',
    input: { text: 'comi bem hoje', mealHint: null, localTime: '20:00' },
    assertions: [
      { kind: 'check', name: 'semItemInventado', description: 'não inventa alimentos' },
      path('needsClarification', 'exists', undefined, 'faz uma pergunta curta'),
    ],
  },
];

export const foodLogChecks = checks;
