/**
 * Texto do modelo que passou do limite do contrato.
 *
 * O contrato limita cada texto (nota de 300 caracteres, resumo de 600…). Recusar o protocolo
 * inteiro porque uma nota veio 20 caracteres maior é desproporcional: o texto é cortado na última
 * frase completa que cabe (ou na última palavra, com reticências) e segue para os validadores de
 * verdade. Tudo que não é texto longo demais continua sendo validado como antes.
 */

type JsonSchema = {
  type?: string | string[];
  maxLength?: number;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema | JsonSchema[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  const?: unknown;
};

const SENTENCE_END = /[.!?…](?=\s|$)/g;
/** Cortar muito cedo deixa o texto sem sentido: abaixo disto a frase inteira não vale. */
const MIN_KEPT_RATIO = 0.4;

/** O texto cabendo em `max`: na última frase completa; senão, na última palavra com reticências. */
export function cutAtSentence(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const window = trimmed.slice(0, max);
  let lastSentence = -1;
  for (const match of window.matchAll(SENTENCE_END)) lastSentence = match.index + 1;
  if (lastSentence >= max * MIN_KEPT_RATIO) return window.slice(0, lastSentence).trim();
  const room = window.slice(0, Math.max(1, max - 1));
  const lastSpace = room.lastIndexOf(' ');
  const base = (lastSpace > max * MIN_KEPT_RATIO ? room.slice(0, lastSpace) : room)
    .replace(/[\s,;:–—-]+$/u, '')
    .trimEnd();
  return `${base}…`;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Schema do campo `key` de um objeto: direto ou, em união discriminada, do ramo que combina. */
function propertySchema(schema: JsonSchema, value: Record<string, unknown>, key: string) {
  if (schema.properties?.[key]) return schema.properties[key];
  for (const branch of [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])]) {
    const fits = Object.entries(branch.properties ?? {}).every(
      ([name, property]) => property.const === undefined || value[name] === property.const,
    );
    if (fits && branch.properties?.[key]) return branch.properties[key];
  }
  return undefined;
}

/** Corta os textos que passam do `maxLength` do JSON Schema; o resto do valor não muda. */
export function fitLongTexts(value: unknown, schema: JsonSchema | undefined): unknown {
  if (!schema) return value;
  if (typeof value === 'string') {
    return typeof schema.maxLength === 'number' && value.trim().length > schema.maxLength
      ? cutAtSentence(value, schema.maxLength)
      : value;
  }
  if (Array.isArray(value)) {
    const items = Array.isArray(schema.items) ? undefined : schema.items;
    return value.map((item) => fitLongTexts(item, items));
  }
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        fitLongTexts(child, propertySchema(schema, value, key)),
      ]),
    );
  }
  return value;
}
