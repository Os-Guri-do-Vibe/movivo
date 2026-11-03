/** Versão do extrator de texto dos artigos: entra no registro da extração (proveniência). */
export const PARSER_VERSION = 'article-text-v1';
/**
 * Receita do vetor. v2: o embedding é do trecho COM o cabeçalho do documento (título, tipo, ano,
 * domínio), para um trecho do meio do artigo ainda dizer de onde veio. O texto guardado é o mesmo.
 * Quem mudar a receita precisa regerar os artigos padrão (`knowledge:build-defaults`).
 */
export const EMBEDDING_RECIPE = 'embedding-port-v2';

const CHUNK_CHARS = 1800;
const OVERLAP_CHARS = 270;

export function chunkText(text: string, size = CHUNK_CHARS, overlap = OVERLAP_CHARS): string[] {
  const clean = text.trim();
  if (clean.length <= size) return [clean];
  const chunks: string[] = [];
  const step = size - overlap;
  for (let start = 0; start < clean.length; start += step) {
    chunks.push(clean.slice(start, start + size));
    if (start + size >= clean.length) break;
  }
  return chunks;
}
