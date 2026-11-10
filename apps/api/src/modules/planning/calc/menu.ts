/**
 * Cardápio do plano alimentar: o modelo ESCOLHE os alimentos e as proporções; o código calcula
 * tudo o que é número. Porções ajustadas à meta da refeição, nutrientes da TACO, trocas
 * equivalentes (mesma energia, mesmo grupo de alimento) e a seleção dos alimentos que o agente
 * pode usar (sem restrição, sem alergia, sem o que o aluno evita, com o que ele gosta primeiro).
 * Funções puras: a mesma entrada gera sempre o mesmo cardápio.
 */
import { z } from 'zod';

import {
  mealSlotSchema,
  mealUnitSchema,
  normalizeFoodName,
  type MealItem,
  type MealOption,
  type MealSwap,
  type MealTotals,
  type MealUnit,
} from '@movivo/shared';

import { fold } from '../tasks/common';
import { FORBIDDEN_FOODS, mentions } from './food-rules';

// --- Alimentos candidatos --------------------------------------------------------------------

/** Alimento da base (por 100 g) que o agente pode usar no cardápio. */
export const foodCandidateSchema = z.object({
  id: z.string().min(1).max(60),
  name: z.string().min(1).max(120),
  category: z.string().max(80),
  energyKcal: z.number().min(0).max(1_000),
  proteinG: z.number().min(0).max(100),
  carbsG: z.number().min(0).max(100),
  fatG: z.number().min(0).max(100),
  fiberG: z.number().min(0).max(100),
});
export type FoodCandidate = z.infer<typeof foodCandidateSchema>;

/** Linha da base de alimentos, como o banco devolve. */
export interface FoodRow {
  id: string;
  name: string;
  category: string;
  per100g: {
    energyKcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG: number | null;
  };
}

const EXCLUDED_CATEGORIES = new Set([
  'Bebidas (alcoólicas e não alcoólicas)',
  'Produtos açucarados',
  'Miscelâneas',
  'Outros alimentos industrializados',
  'Alimentos preparados',
]);
/** Categorias em que o alimento cru não é comido (arroz cru, frango cru). */
const COOKED_ONLY = [
  'Cereais e derivados',
  'Carnes e derivados',
  'Pescados',
  'Leguminosas',
  'Ovos',
];
const PROCESSED = [
  'linguica',
  'salsicha',
  'mortadela',
  'presunto',
  'bacon',
  'hamburguer',
  'empanado',
  'nugget',
  'apresuntado',
  'salame',
  'defumad',
  'toucinho',
  'paio',
  'chouric',
  'carne seca',
  'charque',
  'miojo',
  'macarrao instantaneo',
  'coxinha',
  'empada',
  'pastel',
  'torta',
  'bolo',
  'biscoito',
  'bolacha',
  'pacoca',
  'pe-de-moleque',
  'doce',
  'curau',
  'condensado',
  'sorvete',
  'chocolate',
  'goiabada',
  'geleia',
  'molho',
  'extrato',
  'pure',
  'milanesa',
  'frit',
  'dende',
  'creme de leite',
  'instantaneo',
  'coracao',
  'farinha, de arroz',
];
/** Cereais comidos crus (aveia em flocos). */
const RAW_OK = /^(aveia|granola|quinoa)/;
/** Pronto para comer: ganha prioridade sobre o cru entre os alimentos que se cozinham. */
const READY = /, (cozid|assad|grelhad)/;
/** Tubérculos e raízes que ninguém come crus. */
const RAW_TUBER = /(mandioca|inhame|batata|abobora|chuchu|vagem)[^,]*, cru/;
/** Produto em pó ("Creme de arroz, pó"): não é alimento do prato. */
const POWDER = /(,|\bem) po$|, po,/;
const STAPLES = [
  'frango',
  'peito',
  'coxa',
  'patinho',
  'alcatra',
  'acem',
  'coxao',
  'musculo',
  'carne, moida',
  'lombo',
  'ovo',
  'atum',
  'sardinha',
  'tilapia',
  'merluza',
  'salmao',
  'pescada',
  'arroz',
  'feijao',
  'pao',
  'macarrao',
  'batata',
  'mandioca',
  'aipim',
  'inhame',
  'banana',
  'maca',
  'laranja',
  'mamao',
  'abacaxi',
  'melancia',
  'manga',
  'uva',
  'morango',
  'leite',
  'iogurte',
  'queijo',
  'ricota',
  'requeijao',
  'aveia',
  'tapioca',
  'cuscuz',
  'milho',
  'lentilha',
  'grao-de-bico',
  'ervilha',
  'soja',
  'brocolis',
  'cenoura',
  'tomate',
  'alface',
  'couve',
  'abobora',
  'abobrinha',
  'pepino',
  'beterraba',
  'chuchu',
  'espinafre',
  'azeite',
  'castanha',
  'amendoim',
  'pera',
  'goiaba',
  'melao',
  'tangerina',
  'mexerica',
  'abacate',
  'ameixa',
  'pessego',
  'kiwi',
  'couve-flor',
  'repolho',
  'rucula',
  'agriao',
  'vagem',
  'pimentao',
  'berinjela',
  'porco, lombo',
  'queijo, minas',
  'queijo, cottage',
  'tofu',
  'linhaca',
  'noz',
  'castanha',
  'azeite, de oliva',
];

const MIN_PER_CATEGORY = 6;

const CATEGORY_CAP: ReadonlyArray<[string, number]> = [
  ['Cereais e derivados', 26],
  ['Carnes e derivados', 24],
  ['Pescados', 12],
  ['Leguminosas', 12],
  ['Leite e derivados', 12],
  ['Frutas e derivados', 22],
  ['Verduras, hortaliças e derivados', 34],
  ['Ovos e derivados', 4],
  ['Nozes e sementes', 8],
  ['Gorduras e óleos', 4],
];

/** Nome da TACO como se fala ("Ovo, de galinha, inteiro, cozido" → "Ovo de galinha cozido"). */
export function cleanFoodName(name: string): string {
  return normalizeFoodName(name);
}

/** Palavras do texto livre do aluno ("arroz, frango e banana") com 3 letras ou mais. */
export function tokensOf(text: string | null | undefined): string[] {
  if (!text) return [];
  return fold(text)
    .split(/[^a-z]+/)
    .filter(
      (token) => token.length >= 3 && !['que', 'com', 'sem', 'tudo', 'gosto'].includes(token),
    );
}

export interface CandidateFilter {
  dietaryRestrictions: readonly string[];
  allergenTerms: readonly string[];
  likedFoods?: string | null;
  dislikedFoods?: string | null;
}

/**
 * Alimentos que o agente pode usar: sem restrição, sem alergia e sem o que o aluno evita; o que
 * ele gosta e os básicos de mercado vêm primeiro, com teto por categoria para a lista caber no
 * prompt e cobrir todos os grupos.
 */
export function selectFoodCandidates(
  rows: readonly FoodRow[],
  filter: CandidateFilter,
): FoodCandidate[] {
  const disliked = tokensOf(filter.dislikedFoods);
  const liked = tokensOf(filter.likedFoods);
  const forbidden = filter.dietaryRestrictions.flatMap((r) => FORBIDDEN_FOODS[r] ?? []);
  const scored: Array<{ food: FoodCandidate; score: number; category: string }> = [];
  for (const row of rows) {
    if (EXCLUDED_CATEGORIES.has(row.category)) continue;
    const name = fold(row.name);
    if (PROCESSED.some((term) => name.includes(term)) || POWDER.test(name)) continue;
    if (
      COOKED_ONLY.some((c) => row.category.startsWith(c)) &&
      /\bcru[a-z]*\b/.test(name) &&
      !RAW_OK.test(name)
    ) {
      continue;
    }
    if (RAW_TUBER.test(name)) continue;
    if (filter.allergenTerms.some((term) => name.includes(term))) continue;
    if (forbidden.some((term) => mentions(row.name, term))) continue;
    if (disliked.some((token) => name.includes(token))) continue;
    if (row.per100g.energyKcal <= 0) continue;
    const score =
      (liked.some((token) => name.includes(token)) ? 2 : 0) +
      (STAPLES.some((term) => name.includes(term)) ? 1 : 0) +
      (READY.test(name) && !row.category.startsWith('Frutas') ? 0.5 : 0);
    scored.push({
      score,
      category: row.category,
      food: {
        id: row.id,
        name: cleanFoodName(row.name),
        category: row.category,
        energyKcal: Math.round(row.per100g.energyKcal),
        proteinG: round1(row.per100g.proteinG),
        carbsG: round1(row.per100g.carbsG),
        fatG: round1(row.per100g.fatG),
        fiberG: round1(row.per100g.fiberG ?? 0),
      },
    });
  }
  const picked: FoodCandidate[] = [];
  for (const [category, cap] of CATEGORY_CAP) {
    // Os gostos e os básicos primeiro; dentro do mesmo peso, o nome mais curto (o alimento simples).
    const ranked = scored
      .filter((s) => s.category.startsWith(category))
      .sort((a, b) => b.score - a.score || a.food.name.length - b.food.name.length);
    // Só os básicos e o que o aluno gosta; os demais entram apenas para a categoria não ficar vazia.
    const common = ranked.filter((s) => s.score > 0);
    const chosen = common.length >= MIN_PER_CATEGORY ? common : ranked;
    picked.push(...chosen.slice(0, cap).map((s) => s.food));
  }
  return picked;
}

// --- Grupos de troca ---------------------------------------------------------------------------

export type FoodGroup =
  'STARCH' | 'LEGUME' | 'PROTEIN' | 'DAIRY' | 'FRUIT' | 'VEG' | 'FAT' | 'OTHER';

/** Grupo de substituição: arroz troca com batata e macarrão; frango com carne e ovo; fruta com fruta. */
export function groupOf(food: FoodCandidate): FoodGroup {
  const category = food.category;
  if (category.startsWith('Cereais')) return 'STARCH';
  if (category.startsWith('Leguminosas')) return 'LEGUME';
  if (
    category.startsWith('Carnes') ||
    category.startsWith('Pescados') ||
    category.startsWith('Ovos')
  ) {
    return 'PROTEIN';
  }
  if (category.startsWith('Leite')) return 'DAIRY';
  if (category.startsWith('Frutas')) return 'FRUIT';
  if (category.startsWith('Nozes') || category.startsWith('Gorduras')) return 'FAT';
  if (category.startsWith('Verduras')) {
    // Raízes e tubérculos (batata, mandioca) são amido; folhas e legumes, não.
    return food.energyKcal >= 45 && food.carbsG * 4 >= food.energyKcal * 0.7 ? 'STARCH' : 'VEG';
  }
  return 'OTHER';
}

// --- Cardápio ------------------------------------------------------------------------------------

export const draftUnitSchema = mealUnitSchema;

export const draftSwapSchema = z.object({
  foodId: z.string().min(1).max(60),
  unit: draftUnitSchema.optional(),
});
export type DraftSwap = z.infer<typeof draftSwapSchema>;

export const draftItemSchema = z.object({
  foodId: z.string().min(1).max(60),
  /** Quantidade que o modelo propõe; o servidor ajusta as proporções à meta da refeição. */
  grams: z.number().min(5).max(1_500),
  unit: draftUnitSchema.optional(),
  swaps: z.array(draftSwapSchema).max(3),
});
export type DraftItem = z.infer<typeof draftItemSchema>;

export const draftOptionSchema = z.object({
  title: z.string().trim().min(1).max(80),
  /** Custo estimado da opção em reais (preço de mercado no Brasil). */
  estimatedCostBrl: z.number().min(0.3).max(200),
  items: z.array(draftItemSchema).min(1).max(8),
});
export type DraftOption = z.infer<typeof draftOptionSchema>;

export const draftMealSchema = z.object({
  slot: mealSlotSchema,
  energyShare: z.number().min(0).max(1),
  proteinG: z.number().int().min(0).max(150),
  guidance: z.string().trim().min(1).max(300),
  options: z.array(draftOptionSchema).min(2).max(3).optional(),
});
export type DraftMeal = z.infer<typeof draftMealSchema>;

/** Quanto a opção pode se afastar da meta de energia da refeição depois do ajuste das porções. */
export const ENERGY_TOLERANCE = 0.12;
/** Faixa de proteína aceita em relação à meta da refeição. */
export const PROTEIN_TOLERANCE = { min: 0.8, max: 1.35 };
/** O ajuste das porções não pode mexer mais que isso: sinal de que as proporções estão erradas. */
export const FIT_FACTOR = { min: 0.6, max: 1.6 };
/** Quanto a quantidade da troca pode diferir da do alimento original. */
export const SWAP_VOLUME = { min: 0.3, max: 3.5 };
/** Nenhuma troca passa disso (um prato não comporta quase 1 kg de um só alimento). */
export const MAX_SWAP_GRAMS = 600;
/** Custo plausível por 1.000 kcal de comida (R$): abaixo ou acima disso a estimativa não fecha. */
export const COST_PER_1000_KCAL = { min: 1.5, max: 40 };

const round1 = (value: number) => Math.round(value * 10) / 10;
const roundTo = (value: number, step: number) => Math.round(value / step) * step;

/** Medidas de volume, não de contagem: o aluno não conta colheres de arroz; pesa em gramas. */
const NOT_COUNTABLE = /colher|concha|x[ií]cara|copo|punhado|por[cç][aã]o|pitada|fio\b|scoop|dose/i;

/**
 * Só o que se conta em unidades inteiras fica como medida (ovo, banana, fatia, pão, pote). O
 * resto sai em gramas, ou em ml para líquidos: uma unidade só por alimento, sem "3,5 ovos".
 */
export function countableUnit(unit: MealUnit | undefined): MealUnit | undefined {
  return unit && !NOT_COUNTABLE.test(unit.singular) ? unit : undefined;
}

/** Líquidos que o aluno mede em ml (leite, bebida vegetal, suco); 1 ml ≈ 1 g. */
const LIQUID =
  /^(leite(?!,? (condensado|em p[oó]))|bebida|suco|[aá]gua|caldo|vitamina|refresco|caf[eé]|ch[aá])\b/i;
export function isLiquid(name: string): boolean {
  return LIQUID.test(name.trim());
}

/** Gramas finais de um item: unidades inteiras da medida contável ou múltiplos de 5 g. */
function snap(grams: number, unit: MealUnit | undefined): { grams: number; units?: number } {
  if (unit) {
    const units = Math.max(1, Math.round(grams / unit.grams));
    return { grams: Math.round(units * unit.grams), units };
  }
  const step = grams < 20 ? 1 : 5;
  return { grams: Math.max(step, roundTo(grams, step)) };
}

function nutrients(food: FoodCandidate, grams: number) {
  const factor = grams / 100;
  return {
    energyKcal: food.energyKcal * factor,
    proteinG: food.proteinG * factor,
    carbsG: food.carbsG * factor,
    fatG: food.fatG * factor,
    fiberG: food.fiberG * factor,
  };
}

export function sumTotals(
  items: ReadonlyArray<{ energyKcal: number; proteinG: number; carbsG: number; fatG: number }>,
  fiberG: number,
): MealTotals {
  return {
    energyKcal: Math.round(items.reduce((s, i) => s + i.energyKcal, 0)),
    proteinG: round1(items.reduce((s, i) => s + i.proteinG, 0)),
    carbsG: round1(items.reduce((s, i) => s + i.carbsG, 0)),
    fatG: round1(items.reduce((s, i) => s + i.fatG, 0)),
    fiberG: round1(fiberG),
  };
}

export interface MealTarget {
  /** Energia da refeição (kcal) e proteína (g) que as opções precisam atingir. */
  energyKcal: number;
  proteinG: number;
}

export interface BuiltOption {
  option: MealOption;
  /** Problemas que o modelo precisa corrigir (alimento fora da lista, meta errada, troca inválida). */
  issues: string[];
}

/** Troca equivalente: mesma energia do item original, quantidade calculada pelo servidor. */
function buildSwap(
  item: MealItem,
  itemFood: FoodCandidate,
  draft: DraftSwap,
  foods: ReadonlyMap<string, FoodCandidate>,
  issues: string[],
  path: string,
): MealSwap | null {
  const food = foods.get(draft.foodId);
  if (!food) {
    issues.push(`${path}: o alimento "${draft.foodId}" não está na lista permitida`);
    return null;
  }
  if (food.id === itemFood.id || groupOf(food) !== groupOf(itemFood)) {
    issues.push(
      `${path}: "${food.name}" não é uma troca equivalente de "${itemFood.name}" (use o mesmo grupo de alimento)`,
    );
    return null;
  }
  const raw = (item.energyKcal / food.energyKcal) * 100;
  const unit = countableUnit(draft.unit);
  const snapped = snap(raw, unit);
  // Troca que pede um volume muito diferente do alimento original não é prática (arroz por
  // batata-inglesa, que é pouco calórica, daria quase 1 kg).
  if (
    snapped.grams > MAX_SWAP_GRAMS ||
    snapped.grams > item.grams * SWAP_VOLUME.max ||
    snapped.grams < item.grams * SWAP_VOLUME.min
  ) {
    issues.push(
      `${path}: "${food.name}" pediria ${snapped.grams} g para igualar a energia de ${item.grams} g de "${itemFood.name}"; escolha uma troca de densidade parecida`,
    );
    return null;
  }
  return {
    foodId: food.id,
    name: food.name,
    grams: snapped.grams,
    ...(unit ? { unit, units: snapped.units } : {}),
    energyKcal: Math.round(nutrients(food, snapped.grams).energyKcal),
  };
}

/**
 * Monta uma opção de cardápio: ajusta as porções para a energia da refeição (mantendo as
 * proporções que o modelo escolheu), calcula os nutrientes e as trocas equivalentes. Com
 * `fit: false` (edição do profissional) as quantidades ficam como foram prescritas e só se
 * recalculam os totais.
 */
export function buildOption(
  draft: DraftOption,
  target: MealTarget,
  foods: ReadonlyMap<string, FoodCandidate>,
  path: string,
  fit = true,
): BuiltOption {
  const issues: string[] = [];
  const known = draft.items.flatMap((item) => {
    const food = foods.get(item.foodId);
    if (!food) {
      issues.push(`${path}: o alimento "${item.foodId}" não está na lista permitida`);
      return [];
    }
    return [{ item, food }];
  });
  const rawKcal = known.reduce(
    (s, { item, food }) => s + nutrients(food, item.grams).energyKcal,
    0,
  );
  let factor = 1;
  if (fit && rawKcal > 0) {
    factor = target.energyKcal / rawKcal;
    if (factor < FIT_FACTOR.min || factor > FIT_FACTOR.max) {
      issues.push(
        `${path}: as quantidades somam ~${Math.round(rawKcal)} kcal e a refeição pede ~${Math.round(target.energyKcal)} kcal; ajuste as proporções`,
      );
      factor = Math.min(FIT_FACTOR.max, Math.max(FIT_FACTOR.min, factor));
    }
  }

  const items: MealItem[] = [];
  let fiber = 0;
  for (const { item, food } of known) {
    const unit = countableUnit(item.unit);
    const snapped = fit ? snap(item.grams * factor, unit) : snap(item.grams, unit);
    const grams = fit ? snapped.grams : Math.round(item.grams);
    const n = nutrients(food, grams);
    fiber += n.fiberG;
    const built: MealItem = {
      foodId: food.id,
      name: food.name,
      grams,
      ...(unit ? { unit, units: fit ? snapped.units : round1(grams / unit.grams) } : {}),
      energyKcal: Math.round(n.energyKcal),
      proteinG: round1(n.proteinG),
      carbsG: round1(n.carbsG),
      fatG: round1(n.fatG),
      swaps: [],
    };
    built.swaps = item.swaps.flatMap((swap, i) => {
      const made = buildSwap(
        built,
        food,
        swap,
        foods,
        issues,
        `${path}.items.${items.length}.swaps.${i}`,
      );
      return made ? [made] : [];
    });
    items.push(built);
  }

  const totals = sumTotals(items, fiber);
  const option: MealOption = {
    title: draft.title,
    items,
    totals,
    estimatedCostBrl: Math.round(draft.estimatedCostBrl * 100) / 100,
  };
  if (fit && items.length > 0) {
    const deviation = Math.abs(totals.energyKcal - target.energyKcal) / target.energyKcal;
    if (deviation > ENERGY_TOLERANCE) {
      issues.push(
        `${path}: depois de arredondar as quantidades a opção tem ${totals.energyKcal} kcal; a meta é ~${Math.round(target.energyKcal)} kcal`,
      );
    }
    if (target.proteinG > 0) {
      const ratio = totals.proteinG / target.proteinG;
      if (ratio < PROTEIN_TOLERANCE.min || ratio > PROTEIN_TOLERANCE.max) {
        issues.push(
          `${path}: a opção tem ${totals.proteinG} g de proteína e a meta da refeição é ${target.proteinG} g; troque ou ajuste as fontes de proteína`,
        );
      }
    }
    const perThousand = (draft.estimatedCostBrl / Math.max(totals.energyKcal, 1)) * 1_000;
    if (perThousand < COST_PER_1000_KCAL.min || perThousand > COST_PER_1000_KCAL.max) {
      issues.push(
        `${path}: o custo estimado de R$ ${draft.estimatedCostBrl.toFixed(2)} não é plausível para ${totals.energyKcal} kcal de comida`,
      );
    }
  }
  return { option, issues };
}

/** Energia que cada refeição precisa entregar: a média dos dois tipos de dia. */
export function mealTarget(
  meal: { energyShare: number; proteinG: number },
  days: {
    trainingDay: { energyKcal: { min: number; max: number } };
    restDay: { energyKcal: { min: number; max: number } };
  },
): MealTarget {
  const mean =
    (days.trainingDay.energyKcal.min +
      days.trainingDay.energyKcal.max +
      days.restDay.energyKcal.min +
      days.restDay.energyKcal.max) /
    4;
  return { energyKcal: meal.energyShare * mean, proteinG: meal.proteinG };
}

/** Custo estimado de um dia: a média das opções de cada refeição, somada. */
export function dailyCost(
  meals: ReadonlyArray<{ options?: ReadonlyArray<{ estimatedCostBrl: number }> }>,
): number {
  return meals.reduce((sum, meal) => {
    const options = meal.options ?? [];
    if (options.length === 0) return sum;
    return sum + options.reduce((s, o) => s + o.estimatedCostBrl, 0) / options.length;
  }, 0);
}

/** Nome de cada alimento citado numa refeição (itens e trocas), para conferir restrições. */
export function foodNamesOf(
  meal: DraftMeal,
  foods: ReadonlyMap<string, FoodCandidate>,
): Array<{ path: string; name: string }> {
  const names: Array<{ path: string; name: string }> = [];
  (meal.options ?? []).forEach((option, oi) =>
    option.items.forEach((item, ii) => {
      const food = foods.get(item.foodId);
      if (food) names.push({ path: `options.${oi}.items.${ii}`, name: food.name });
      item.swaps.forEach((swap, si) => {
        const swapFood = foods.get(swap.foodId);
        if (swapFood)
          names.push({ path: `options.${oi}.items.${ii}.swaps.${si}`, name: swapFood.name });
      });
    }),
  );
  return names;
}

/** Escala as quantidades de um cardápio já montado (ajuste de meta de energia). */
export function rescaleOption(option: MealOption, factor: number): MealOption {
  const scaleItem = <T extends MealItem | MealSwap>(entry: T): T => {
    const grams = entry.unit
      ? Math.round(
          Math.max(1, Math.round((entry.grams * factor) / entry.unit.grams)) * entry.unit.grams,
        )
      : Math.max(1, roundTo(entry.grams * factor, entry.grams * factor < 20 ? 1 : 5));
    const ratio = grams / entry.grams;
    return {
      ...entry,
      grams,
      ...(entry.unit ? { units: Math.round(grams / entry.unit.grams) } : {}),
      energyKcal: Math.round(entry.energyKcal * ratio),
    };
  };
  const items = option.items.map((item): MealItem => {
    const scaled = scaleItem(item);
    const ratio = scaled.grams / item.grams;
    return {
      ...scaled,
      proteinG: round1(item.proteinG * ratio),
      carbsG: round1(item.carbsG * ratio),
      fatG: round1(item.fatG * ratio),
      swaps: item.swaps.map(scaleItem),
    };
  });
  const fiber =
    option.totals.fiberG *
    (items.reduce((s, i) => s + i.grams, 0) /
      Math.max(
        option.items.reduce((s, i) => s + i.grams, 0),
        1,
      ));
  return { ...option, items, totals: sumTotals(items, fiber) };
}

/**
 * Quantidade como o aluno mede: unidades inteiras para o que se conta ("3 ovos"), ml para
 * líquido ("250 ml") e gramas para o resto ("150 g"). Uma medida só, sem misturar.
 */
export function quantityLabel(entry: {
  grams: number;
  name?: string;
  unit?: { singular: string; plural: string };
  units?: number;
}): string {
  if (entry.unit && entry.units && Number.isInteger(entry.units)) {
    return `${entry.units} ${entry.units === 1 ? entry.unit.singular : entry.unit.plural}`;
  }
  if (entry.name && isLiquid(entry.name)) return `${entry.grams} ml`;
  return `${entry.grams} g`;
}
