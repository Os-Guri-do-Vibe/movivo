/**
 * Allowlist estrita de propriedades nas bordas da API (OWASP API3:2023 — BOPLA /
 * Mass Assignment).
 *
 * Por que isto existe: os controllers recebem `@Body() body: unknown` e validam com Zod, então o
 * `ValidationPipe` global (`whitelist`/`forbidNonWhitelisted`, `main.ts`) **não age** — sem
 * classe de DTO não há metadado para ele inspecionar. E o `z.object()` padrão do Zod só
 * *descarta* campo desconhecido em silêncio: o cliente que manda `role: "ADMIN"` recebe 200 e
 * nunca descobre que o campo foi ignorado, o que esconde sondagem e deixa a defesa depender de
 * ninguém jamais espalhar o corpo cru (`{ ...body }`) numa escrita.
 *
 * Aqui a regra vira **rejeição**: qualquer chave fora do schema, em qualquer nível de
 * aninhamento, devolve 400 (`unrecognized_keys`). A verificação é uma travessia só de leitura
 * do schema contra o valor — não reconstrói nem altera o schema, então a semântica de
 * validação existente não muda; só passa a recusar o que antes era descartado. Schema novo
 * herda a proteção sem precisar lembrar de `.strict()`.
 */
import { ZodError, type ZodType } from 'zod';
import type { $ZodIssue } from 'zod/v4/core';

/** Estrutura interna do Zod 4 que a travessia precisa ler (`schema._zod.def`). */
interface ZodDef {
  type: string;
  shape?: Record<string, ZodType>;
  catchall?: ZodType;
  element?: ZodType;
  innerType?: ZodType;
  options?: readonly ZodType[];
  left?: ZodType;
  right?: ZodType;
  in?: ZodType;
  out?: ZodType;
  keyType?: ZodType;
  valueType?: ZodType;
  items?: readonly ZodType[];
  rest?: ZodType | null;
  getter?: () => ZodType;
}

type Path = readonly (string | number)[];

/** Profundidade máxima da travessia — corpo JSON legítimo nunca chega perto disso. */
const MAX_DEPTH = 32;

/**
 * Wrappers que apenas embrulham outro schema sem mudar o formato do valor.
 *
 * `catch` fica de fora de propósito: `.catch(fallback)` é a declaração explícita de "este
 * campo nunca invalida a request" (ex.: `attributionInputSchema` — atribuição de marketing
 * vinda do `sessionStorage` não pode impedir o cadastro). Rejeitar chave extra ali
 * contradiria o contrato; o saneamento desse campo é feito por quem o consome.
 */
const TRANSPARENT_WRAPPERS: ReadonlySet<string> = new Set([
  'optional',
  'nullable',
  'default',
  'prefault',
  'nonoptional',
  'readonly',
  'promise',
]);

function defOf(schema: ZodType): ZodDef {
  return (schema as unknown as { _zod: { def: ZodDef } })._zod.def;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function join(path: Path, key: string | number): Path {
  return [...path, key];
}

/**
 * Caminhos de todas as chaves que `value` carrega e `schema` não declara.
 * Vazio significa "nada além do contrato" — não significa que o valor é válido.
 */
export function findUnknownKeys(schema: ZodType, value: unknown): Path[] {
  return walk(schema, value, [], 0);
}

function walk(schema: ZodType, value: unknown, path: Path, depth: number): Path[] {
  if (depth > MAX_DEPTH || value === null || value === undefined) return [];
  const def = defOf(schema);

  if (TRANSPARENT_WRAPPERS.has(def.type) && def.innerType) {
    return walk(def.innerType, value, path, depth + 1);
  }

  switch (def.type) {
    case 'object':
      return walkObject(def, value, path, depth);
    case 'array':
      return Array.isArray(value) && def.element
        ? value.flatMap((item, i) => walk(def.element as ZodType, item, join(path, i), depth + 1))
        : [];
    case 'tuple':
      return Array.isArray(value) ? walkTuple(def, value, path, depth) : [];
    case 'record':
      return isPlainObject(value) && def.valueType
        ? Object.entries(value).flatMap(([k, v]) =>
            walk(def.valueType as ZodType, v, join(path, k), depth + 1),
          )
        : [];
    case 'lazy':
      return def.getter ? walk(def.getter(), value, path, depth + 1) : [];
    case 'pipe':
      return walkPipe(def, value, path, depth);
    case 'union':
      return walkUnion(def, value, path, depth);
    case 'intersection':
      return walkIntersection(def, value, path, depth);
    default:
      return [];
  }
}

function walkObject(def: ZodDef, value: unknown, path: Path, depth: number): Path[] {
  if (!isPlainObject(value)) return [];
  const shape = def.shape ?? {};
  const catchall = def.catchall;
  const unknown: Path[] = [];
  for (const [key, child] of Object.entries(value)) {
    const known = Object.prototype.hasOwnProperty.call(shape, key) ? shape[key] : undefined;
    if (known) {
      unknown.push(...walk(known, child, join(path, key), depth + 1));
    } else if (catchall && defOf(catchall).type !== 'never') {
      // `.catchall(schema)` / `.passthrough()` declaram aceitar o resto de forma explícita.
      unknown.push(...walk(catchall, child, join(path, key), depth + 1));
    } else {
      unknown.push(join(path, key));
    }
  }
  return unknown;
}

function walkTuple(def: ZodDef, value: readonly unknown[], path: Path, depth: number): Path[] {
  const items = def.items ?? [];
  return value.flatMap((item, i) => {
    const child = items[i] ?? def.rest ?? undefined;
    return child ? walk(child, item, join(path, i), depth + 1) : [];
  });
}

function walkPipe(def: ZodDef, value: unknown, path: Path, depth: number): Path[] {
  if (!def.in || !def.out) return [];
  // `z.preprocess(fn, schema)` é `pipe(transform, schema)`: o schema da entrada é opaco, então
  // o contrato verificável é o do lado de saída.
  const entry = defOf(def.in).type === 'transform' ? def.out : def.in;
  return walk(entry, value, path, depth + 1);
}

function walkUnion(def: ZodDef, value: unknown, path: Path, depth: number): Path[] {
  const options = def.options ?? [];
  // Só opções que de fato aceitam o valor contam — senão `z.string() | z.object()` daria
  // "nada desconhecido" pelo ramo de string e esconderia a chave extra do ramo de objeto.
  const matching = options.filter((option) => option.safeParse(value).success);
  if (matching.length === 0) return [];
  const candidates = matching.map((option) => walk(option, value, path, depth + 1));
  return candidates.reduce((best, current) => (current.length < best.length ? current : best));
}

function walkIntersection(def: ZodDef, value: unknown, path: Path, depth: number): Path[] {
  if (!def.left || !def.right) return [];
  // Uma chave é conhecida se QUALQUER lado a declara; desconhecida só se nenhum declara.
  const left = walk(def.left, value, path, depth + 1).map((p) => p.join('\u0000'));
  const right = new Set(walk(def.right, value, path, depth + 1).map((p) => p.join('\u0000')));
  return left.filter((key) => right.has(key)).map((key) => key.split('\u0000'));
}

/** Agrupa por objeto-pai: um issue `unrecognized_keys` por nível, como o próprio Zod emite. */
function toIssues(unknown: readonly Path[]): $ZodIssue[] {
  const byParent = new Map<string, { path: Path; keys: string[] }>();
  for (const full of unknown) {
    const parent = full.slice(0, -1);
    const id = JSON.stringify(parent);
    const entry = byParent.get(id) ?? { path: parent, keys: [] };
    entry.keys.push(String(full[full.length - 1]));
    byParent.set(id, entry);
  }
  return [...byParent.values()].map(({ path, keys }) => ({
    code: 'unrecognized_keys' as const,
    keys,
    path: [...path],
    input: undefined,
    message: `Campo não permitido: ${keys.map((k) => `"${k}"`).join(', ')}`,
  }));
}

/**
 * Caminhos de strings (valor ou chave) com byte nulo (`\u0000`). O Postgres não armazena esse
 * caractere em `text` nem em `jsonb` ("unsupported Unicode escape sequence"): sem esta checagem
 * ele atravessa o Zod e vira 500 na gravação. Não é injeção — é robustez —, mas barrar na borda
 * devolve 400 e evita que um corpo hostil derrube a escrita (e os retries) de um worker.
 */
export function findNullBytes(value: unknown, path: Path = [], depth = 0): Path[] {
  if (depth > MAX_DEPTH) return [];
  if (typeof value === 'string') return value.includes('\u0000') ? [path] : [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findNullBytes(item, join(path, index), depth + 1));
  }
  if (isPlainObject(value)) {
    return Object.entries(value).flatMap(([key, item]) => [
      ...(key.includes('\u0000') ? [join(path, key)] : []),
      ...findNullBytes(item, join(path, key), depth + 1),
    ]);
  }
  return [];
}

export type StrictParseResult<T> =
  { success: true; data: T } | { success: false; error: ZodError<unknown> };

/**
 * `schema.safeParse(data)` que também **rejeita** chave desconhecida em qualquer nível e texto
 * com byte nulo (`findNullBytes`).
 * Troca direta de `safeParse` — mantém o formato do resultado para o chamador seguir
 * tratando o erro como já fazia.
 */
export function strictSafeParse<T>(schema: ZodType<T>, data: unknown): StrictParseResult<T> {
  const unknownKeys = findUnknownKeys(schema, data);
  const nullBytes = findNullBytes(data);
  const result = schema.safeParse(data);
  if (result.success && unknownKeys.length === 0 && nullBytes.length === 0) {
    return { success: true, data: result.data };
  }
  const issues: $ZodIssue[] = result.success ? [] : [...result.error.issues];
  issues.push(...toIssues(unknownKeys));
  issues.push(
    ...nullBytes.map((path) => ({
      code: 'custom' as const,
      path: [...path],
      input: undefined,
      message: 'Texto contém caractere inválido.',
    })),
  );
  return { success: false, error: new ZodError(issues) };
}

/**
 * Valida o corpo de uma request e lança `ZodError` quando inválido ou quando traz propriedade
 * fora da allowlist. O `ZodExceptionFilter` global (`CoreModule`) converte em 400 com mensagem
 * genérica — sem nome de campo nem valor na resposta, para não dar mapa da API a quem sonda.
 */
export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = strictSafeParse(schema, body);
  if (!result.success) throw result.error;
  return result.data;
}
