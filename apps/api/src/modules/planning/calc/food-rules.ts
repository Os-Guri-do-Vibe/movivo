/**
 * Regras de alimento compartilhadas pela geração do plano alimentar e pelas sugestões do
 * WhatsApp: restrições alimentares (lista de conferência, não substitui o nutricionista) e
 * alergias.
 */
import { fold } from '../tasks/common';

/** Termos de origem animal por restrição (lista de conferência, não substitui o nutricionista). */
export const FORBIDDEN_FOODS: Readonly<Record<string, readonly string[]>> = {
  VEGAN: [
    'carne',
    'frango',
    'peixe',
    'atum',
    'sardinha',
    'salmao',
    'tilapia',
    'ovo',
    'ovos',
    'leite',
    'queijo',
    'iogurte',
    'requeijao',
    'manteiga',
    'mel',
    'whey',
    'presunto',
    'peru',
    'bacon',
    'camarao',
    'linguica',
    'bife',
    'carne moida',
    'gelatina',
  ],
  VEGETARIAN: [
    'carne',
    'frango',
    'peixe',
    'atum',
    'sardinha',
    'salmao',
    'tilapia',
    'presunto',
    'peru',
    'bacon',
    'camarao',
    'linguica',
    'bife',
    'carne moida',
  ],
  LACTOSE_FREE: ['leite', 'queijo', 'iogurte', 'requeijao', 'manteiga', 'creme de leite', 'whey'],
  GLUTEN_FREE: [
    'pao',
    'macarrao',
    'trigo',
    'cevada',
    'centeio',
    'biscoito',
    'bolacha',
    'cuscuz de trigo',
  ],
};

/** Palavras que anulam a presença do termo ("leite vegetal", "sem lactose", "sem gluten"). */
export const NEGATIONS = [
  'sem lactose',
  'sem gluten',
  'vegetal',
  'de soja',
  'de amendoas',
  'de aveia',
  'de coco',
  'zero lactose',
  'sem leite',
];

export function mentions(text: string, term: string): boolean {
  const folded = fold(text);
  if (NEGATIONS.some((n) => folded.includes(n))) return false;
  return new RegExp(`(^|[^a-z])${term}([^a-z]|$)`).test(folded);
}
