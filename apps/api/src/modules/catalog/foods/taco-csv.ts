/**
 * Leitura da Tabela Brasileira de Composição de Alimentos (TACO, NEPA/UNICAMP) exportada em CSV.
 *
 * Aceita separador `;` ou `,`, aspas, e cabeçalhos com os nomes da planilha oficial (com ou sem
 * acento/unidade). Na TACO, `Tr` (traço) vale 0 e `NA`/`*`/vazio é "não analisado" — o nutriente
 * fica de fora do item, nunca vira zero inventado.
 */
import type { NutrientsPer100g } from '@movivo/shared';

import { searchName } from './food-totals';

export interface TacoFood {
  sourceCode: string;
  name: string;
  category: string;
  per100g: NutrientsPer100g;
}

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
    const energy = parseNumber(cells[index.energyKcal]);
    const protein = parseNumber(cells[index.proteinG]);
    const fat = parseNumber(cells[index.fatG]);
    const carbs = parseNumber(cells[index.carbsG]);
    if (!name || energy === null || protein === null || fat === null || carbs === null) {
      skipped += 1;
      continue;
    }
    const micros: Record<string, number> = {};
    for (const [key, i] of microIndex) {
      const value = parseNumber(cells[i]);
      if (value !== null) micros[key] = value;
    }
    foods.push({
      sourceCode: (index.code >= 0 ? cells[index.code] : '') || String(row + 1),
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
