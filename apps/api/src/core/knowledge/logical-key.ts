import { createHash } from 'node:crypto';

/**
 * Chave lógica de um artigo: o título sem acento, em minúsculas e com hífens. Dois envios com o mesmo
 * título são versões do mesmo documento. É também o que a carga dos artigos padrão usa, para que um
 * artigo corrigido pela equipe (mesmo título) entre como nova versão e não conviva com o padrão.
 */
export function logicalKeyFor(title: string): string {
  const key = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return key || `documento-${createHash('sha256').update(title).digest('hex').slice(0, 12)}`;
}
