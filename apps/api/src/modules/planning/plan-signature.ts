import { createHash } from 'node:crypto';

/** JSON com chaves em ordem fixa: o mesmo conteúdo gera sempre o mesmo hash. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** SHA-256 do conteúdo do protocolo: prova, meses depois, que o entregue é o que foi assinado. */
export function signatureHashOf(structure: unknown): string {
  return createHash('sha256').update(canonical(structure)).digest('hex');
}
