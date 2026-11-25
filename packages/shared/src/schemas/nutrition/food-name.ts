/**
 * Nome de alimento legível para o aluno e para o profissional.
 *
 * A TACO escreve o nome como uma lista de atributos separados por vírgula ("Ovo, de galinha,
 * inteiro, cozido", "Pão, trigo, francês", "Frango, peito, sem pele, cozido"). No protocolo
 * alimentar isso vira o nome que se fala: "Ovo de galinha cozido", "Pão francês", "Peito de frango
 * cozido sem pele". A função é pura e idempotente: um nome já normalizado volta igual, então
 * serve tanto na criação do plano quanto na exibição de planos que já estavam salvos.
 */

/** Modo de preparo: vai logo depois do alimento ("Peito de frango cozido sem pele"). */
const PREPARATIONS: ReadonlySet<string> = new Set([
  'cru',
  'crua',
  'cozido',
  'cozida',
  'grelhado',
  'grelhada',
  'assado',
  'assada',
  'frito',
  'frita',
  'refogado',
  'refogada',
  'ensopado',
  'ensopada',
  'à milanesa',
  'no vapor',
  'na chapa',
]);

/** Cortes de frango que viram o nome principal ("Frango, peito" → "Peito de frango"). */
const CHICKEN_CUTS: ReadonlySet<string> = new Set([
  'peito',
  'coxa',
  'sobrecoxa',
  'fígado',
  'coração',
  'filé',
  'asa',
  'moela',
  'pele',
]);

/** Cortes bovinos e o gênero com que concordam ("Patinho bovino", "Maminha bovina"). */
const BEEF_CUTS_MASCULINE: ReadonlySet<string> = new Set([
  'acém',
  'bucho',
  'contra-filé',
  'coxão duro',
  'coxão mole',
  'cupim',
  'fígado',
  'filé mignon',
  'contra-filé de costela',
  'miolo de alcatra',
  'flanco',
  'lagarto',
  'músculo',
  'patinho',
  'peito',
  'rabo',
  'coração',
]);
const BEEF_CUTS_FEMININE: ReadonlySet<string> = new Set([
  'alcatra',
  'costela',
  'fraldinha',
  'maminha',
  'picanha',
  'paleta',
  'língua',
  'capa de contra-filé',
  'ponta de agulha',
]);

/** Nomes que nenhuma regra acerta bem. A chave é o nome da TACO sem acento e em minúsculas. */
const OVERRIDES: ReadonlyMap<string, string> = new Map([
  ['soja, queijo (tofu)', 'Tofu'],
  ['nhoque, batata, cozido', 'Nhoque de batata cozido'],
]);

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase('pt-BR') + text.slice(1);
const lower = (text: string) => text.charAt(0).toLocaleLowerCase('pt-BR') + text.slice(1);

/** Ruído de tabela ("cozido/10minutos" → "cozido"); espaços repetidos e nas pontas saem. */
function tidy(text: string): string {
  return text
    .replace(/\s*\/\s*\d+\s*minutos?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const isQualifier = (token: string) => /^(com|sem)\s/i.test(token);
const isPreparation = (token: string) => PREPARATIONS.has(token.toLocaleLowerCase('pt-BR'));

/** Atributos que a TACO usa só para classificar e que ninguém fala ("Pão, trigo, francês"). */
function refine(head: string, token: string): string | null {
  const key = fold(token);
  const food = fold(head);
  if (food === 'ovo' && key === 'inteiro') return null;
  if (['pao', 'macarrao', 'biscoito'].includes(food) && key === 'trigo') return null;
  if (food === 'leite' && key === 'de vaca') return null;
  if (food === 'arroz' && key === 'tipo 1') return 'branco';
  // A TACO escreveu "mingnon"; o nome do corte é filé mignon.
  if (key === 'file mingnon') return 'filé mignon';
  if (food === 'pao') {
    if (key === 'forma') return 'de forma';
    if (['aveia', 'centeio', 'milho'].includes(key)) return `de ${key}`;
  }
  return token;
}

/** Nome do alimento sem a nomenclatura de tabela. */
export function normalizeFoodName(raw: string): string {
  const text = tidy(raw);
  if (text === '') return text;
  const override = OVERRIDES.get(fold(text));
  if (override) return override;

  const [first = '', ...others] = text.split(',').map((token) => token.trim());
  const tokens = others.filter(Boolean);
  if (tokens.length === 0) return capitalize(first);

  let head = first;
  let rest = tokens.flatMap((token) => {
    const refined = refine(first, token);
    return refined === null ? [] : [refined];
  });

  const next = rest[0] ? fold(rest[0]) : '';
  const trailingDe = /^(.+) de$/i.exec(rest[0] ?? '');
  const eggPart =
    fold(head) === 'ovo' ? rest.find((t) => ['gema', 'clara'].includes(fold(t))) : undefined;
  if (eggPart) {
    // "Ovo, de galinha, gema, cozida" → "Gema de ovo cozida" (a espécie só aparece fora da galinha).
    head = `${capitalize(eggPart)} de ovo`;
    rest = rest.filter((token) => token !== eggPart && fold(token) !== 'de galinha');
  } else if (trailingDe) {
    // "Coco, água de" → "Água de coco"; "Cana, caldo de" → "Caldo de cana".
    head = `${capitalize(trailingDe[1] ?? '')} de ${lower(head)}`;
    rest = rest.slice(1);
  } else if (fold(head) === 'queijo' && next.startsWith('requeijao')) {
    head = 'Requeijão';
    rest = rest.slice(1);
  } else if (
    fold(head) === 'frango' &&
    CHICKEN_CUTS.has(rest[0]?.toLocaleLowerCase('pt-BR') ?? '')
  ) {
    head = `${capitalize(rest[0] ?? '')} de frango`;
    rest = rest.slice(1);
  } else if (
    fold(head) === 'porco' &&
    rest[0] &&
    !isPreparation(rest[0]) &&
    !isQualifier(rest[0])
  ) {
    head = `${capitalize(rest[0])} de porco`;
    rest = rest.slice(1);
  } else if (fold(head) === 'carne' && next === 'bovina') {
    const cut = rest[1]?.toLocaleLowerCase('pt-BR') ?? '';
    if (cut === 'seca') {
      head = 'Carne seca';
      rest = rest.slice(2);
    } else if (cut === 'charque') {
      head = 'Charque';
      rest = rest.slice(2);
    } else if (cut === 'almôndegas') {
      head = 'Almôndegas bovinas';
      rest = rest.slice(2);
    } else if (BEEF_CUTS_MASCULINE.has(cut)) {
      head = `${capitalize(cut)} bovino`;
      rest = rest.slice(2);
    } else if (BEEF_CUTS_FEMININE.has(cut)) {
      head = `${capitalize(cut)} bovina`;
      rest = rest.slice(2);
    }
  } else if (rest[0]?.toLocaleLowerCase('pt-BR') === 'filé') {
    head = `Filé de ${lower(head)}`;
    rest = rest.slice(1);
  }

  const preparations = rest.filter(isPreparation);
  const qualifiers = rest.filter((token) => !isPreparation(token) && isQualifier(token));
  const core = rest.filter((token) => !isPreparation(token) && !isQualifier(token));
  return capitalize([head, ...core, ...preparations, ...qualifiers].join(' '));
}
