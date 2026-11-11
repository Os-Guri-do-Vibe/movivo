/**
 * Leitura da Tabela Brasileira de Composição de Alimentos (TACO, NEPA/UNICAMP) exportada em CSV.
 *
 * Aceita separador `;` ou `,`, aspas, e cabeçalhos com os nomes da planilha oficial (com ou sem
 * acento/unidade). Os símbolos seguem a legenda da própria TACO:
 *
 *   `Tr`     traço: vale 0.
 *   `NA`     "não aplicável": o nutriente não existe naquele alimento (proteína e carboidrato num
 *            óleo; energia no sal). Vale 0. Energia `NA` só vale 0 se o alimento foi de fato
 *            analisado (tem umidade medida) e nenhum macro a contradiz; linha toda `NA` é lixo.
 *   vazio    "análises não solicitadas": só vale 0 quando a energia do alimento foi informada (a
 *            cachaça, cuja energia vem do álcool). Sem energia, é falta de dado.
 *   `*`      "as análises estão sendo reavaliadas": a TACO retirou o valor de propósito. Nunca vira
 *            zero; o alimento sem energia ou macros fica de fora (iogurte, leite e coco verde).
 *
 * Micronutrientes e fibra ausentes ficam de fora do item: não viram zero.
 *
 * Coluna opcional `Fonte`: vazia (ou "TACO") é um alimento da TACO. Com outro valor (USDA, Embrapa,
 * Estimativa...), a linha é um COMPLEMENTO: um alimento que a TACO não publica, cadastrado com
 * valores de outra fonte. Ele fica separado da TACO (fonte `CUSTOM`, código `<Fonte>-<número>`),
 * então reimportar a TACO nunca o sobrescreve, e a tabela o mostra com o selo da fonte.
 */
import type { NutrientsPer100g } from '@movivo/shared';

import { searchName } from './food-totals';

export interface TacoFood {
  /** Código na fonte; nos complementos vem prefixado: `USDA-458`. */
  sourceCode: string;
  /** Quem publica os valores quando NÃO é a TACO (complemento); `null` para a TACO. */
  origin: string | null;
  name: string;
  category: string;
  per100g: NutrientsPer100g;
}

/** Nome curto da fonte de um complemento: vira prefixo do código e selo na tabela. */
const ORIGIN_LABEL = /^[\p{L}\p{N}]{2,16}$/u;

/** Coluna canônica → nomes aceitos no cabeçalho (já normalizados por `searchName`). */
const COLUMNS = {
  code: ['numero do alimento', 'numero', 'id', 'codigo'],
  name: ['descricao dos alimentos', 'descricao', 'alimento', 'nome'],
  category: ['categoria', 'grupo'],
  energyKcal: ['energia kcal', 'energia', 'kcal'],
  proteinG: ['proteina g', 'proteina'],
  fatG: ['lipideos g', 'lipideos', 'lipidios', 'gordura'],
  carbsG: ['carboidrato g', 'carboidrato', 'carboidratos'],
  fiberG: ['fibra alimentar g', 'fibra alimentar', 'fibra'],
  moisture: ['umidade'],
  origin: ['fonte'],
} as const satisfies Record<string, readonly string[]>;
type Column = keyof typeof COLUMNS;

/** Micronutrientes lidos quando presentes (chave canônica → nomes aceitos). */
const MICROS: Readonly<Record<string, readonly string[]>> = {
  calcium_mg: ['calcio mg', 'calcio'],
  iron_mg: ['ferro mg', 'ferro'],
  sodium_mg: ['sodio mg', 'sodio'],
  potassium_mg: ['potassio mg', 'potassio'],
  magnesium_mg: ['magnesio mg', 'magnesio'],
  zinc_mg: ['zinco mg', 'zinco'],
  vitamin_c_mg: ['vitamina c mg', 'vitamina c'],
  cholesterol_mg: ['colesterol mg', 'colesterol'],
};

function splitLine(line: string, separator: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (char === separator && !quoted) {
      cells.push(current.trim());
      current = '';
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}

/** `Tr` → 0; `NA`, `*`, `-` ou vazio → não analisado (`null`). */
function parseNumber(raw: string | undefined): number | null {
  const value = (raw ?? '').trim();
  if (/^tr$/i.test(value)) return 0;
  if (value === '' || /^(na|\*|-)$/i.test(value)) return null;
  const parsed = Number(value.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Como a TACO marcou uma célula de energia ou macronutriente. */
type Cell =
  | { kind: 'value'; value: number }
  | { kind: 'notApplicable' }
  | { kind: 'blank' }
  | { kind: 'withheld' };

function parseCell(raw: string | undefined): Cell {
  const text = (raw ?? '').trim();
  if (text === '') return { kind: 'blank' };
  if (/^na$/i.test(text)) return { kind: 'notApplicable' };
  const value = parseNumber(text);
  return value === null ? { kind: 'withheld' } : { kind: 'value', value };
}

/** Número, ou 0 quando "não aplicável"; o resto depende do contexto e é decidido por quem chama. */
function strictValue(cell: Cell): number | null {
  if (cell.kind === 'value') return cell.value;
  return cell.kind === 'notApplicable' ? 0 : null;
}

function columnIndex(header: string[], aliases: readonly string[]): number {
  return header.findIndex((cell) => aliases.includes(cell));
}

export function parseTacoCsv(text: string): { foods: TacoFood[]; skipped: number } {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  const first = lines[0] ?? '';
  const separator =
    (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0) ? ';' : ',';
  const header = splitLine(first, separator).map(searchName);
  const index = Object.fromEntries(
    (Object.keys(COLUMNS) as Column[]).map((key) => [key, columnIndex(header, COLUMNS[key])]),
  ) as Record<Column, number>;
  for (const required of ['name', 'energyKcal', 'proteinG', 'fatG', 'carbsG'] as const) {
    if (index[required] < 0) throw new Error(`coluna obrigatória ausente no CSV: ${required}`);
  }
  const microIndex = Object.entries(MICROS)
    .map(([key, aliases]) => [key, columnIndex(header, aliases)] as const)
    .filter(([, i]) => i >= 0);

  const foods: TacoFood[] = [];
  let skipped = 0;
  for (const [row, line] of lines.slice(1).entries()) {
    const cells = splitLine(line, separator);
    const name = cells[index.name]?.trim();
    const energyCell = parseCell(cells[index.energyKcal]);
    const proteinCell = parseCell(cells[index.proteinG]);
    const fatCell = parseCell(cells[index.fatG]);
    const carbsCell = parseCell(cells[index.carbsG]);
    // Energia "não aplicável" só vale 0 quando o alimento foi analisado (tem umidade) e nenhum macro
    // a contradiz (sal); um macro positivo ou faltando deixa a energia como falta de dado.
    const analysed = index.moisture >= 0 && parseNumber(cells[index.moisture]) !== null;
    const energy =
      energyCell.kind === 'value'
        ? energyCell.value
        : energyCell.kind === 'notApplicable' &&
            analysed &&
            [proteinCell, fatCell, carbsCell].every((cell) => strictValue(cell) === 0)
          ? 0
          : null;
    // Célula vazia vale 0 só quando a energia existe (cachaça); `*` nunca vale.
    const macro = (cell: Cell) =>
      strictValue(cell) ?? (cell.kind === 'blank' && energy !== null ? 0 : null);
    const protein = macro(proteinCell);
    const fat = macro(fatCell);
    const carbs = macro(carbsCell);
    const originCell = (index.origin >= 0 ? cells[index.origin] : '')?.trim() ?? '';
    const complement = originCell !== '' && searchName(originCell) !== 'taco';
    if (complement && !ORIGIN_LABEL.test(originCell)) {
      skipped += 1;
      continue;
    }
    if (!name || energy === null || protein === null || fat === null || carbs === null) {
      skipped += 1;
      continue;
    }
    const micros: Record<string, number> = {};
    for (const [key, i] of microIndex) {
      const value = parseNumber(cells[i]);
      if (value !== null) micros[key] = value;
    }
    const code = (index.code >= 0 ? cells[index.code] : '') || String(row + 1);
    foods.push({
      sourceCode: complement ? `${originCell}-${code}` : code,
      origin: complement ? originCell : null,
      name,
      category: (index.category >= 0 ? cells[index.category] : '') || 'Geral',
      per100g: {
        energyKcal: energy,
        proteinG: protein,
        fatG: fat,
        carbsG: carbs,
        fiberG: index.fiberG >= 0 ? parseNumber(cells[index.fiberG]) : null,
        micros,
      },
    });
  }
  return { foods, skipped };
}

/**
 * Valores fora do que a TACO pode ter por 100 g indicam coluna deslocada ou arquivo errado. Recusar
 * o arquivo inteiro evita gravar números trocados num catálogo de que o plano alimentar depende.
 * Devolve o motivo, ou `null` se o alimento é plausível.
 */
export function tacoImplausibility(food: TacoFood): string | null {
  const { energyKcal, proteinG, fatG, carbsG } = food.per100g;
  if (energyKcal < 0 || energyKcal > 950) return `energia de ${energyKcal} kcal`;
  for (const [label, value] of [
    ['proteína', proteinG],
    ['lipídeos', fatG],
    ['carboidrato', carbsG],
  ] as const) {
    if (value < 0 || value > 100) return `${label} de ${value} g`;
  }
  if (proteinG + fatG + carbsG > 105) return 'macronutrientes somam mais de 100 g';
  return null;
}
