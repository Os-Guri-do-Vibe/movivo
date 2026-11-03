/**
 * Texto do RAG: o que se calcula SOBRE o texto antes de buscar ou de entregar ao modelo. Só funções
 * puras, sem banco nem rede, para testar sem infraestrutura.
 */

export const fold = (value: string): string =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/* -------------------------------------------------------------------------- */
/* Contexto do trecho                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Metadados que o profissional escreve no topo do documento (Markdown ou texto), uma linha por
 * campo: `Tipo: meta-análise`, `Ano: 2023`, `Domínio: força, hipertrofia`, `População: adultos`.
 * Os campos desconhecidos (Autores, Periódico, DOI) são aceitos e ignorados.
 */
export interface DocumentMeta {
  type: string | null;
  year: string | null;
  domains: string[];
  population: string | null;
}

const HEADER_LINE = /^([\p{L} ]{2,24}?)\s*:\s*(.+)$/u;
const HEADER_MAX_LINES = 16;

export function parseDocumentMeta(text: string): DocumentMeta {
  const meta: DocumentMeta = { type: null, year: null, domains: [], population: null };
  let fields = 0;
  for (const raw of text.split(/\r?\n/).slice(0, HEADER_MAX_LINES)) {
    const line = raw.replace(/[*_]/g, '').trim();
    if (line === '') {
      if (fields > 0) break;
      continue;
    }
    if (line.startsWith('#') && fields === 0) continue;
    const match = HEADER_LINE.exec(line);
    if (!match?.[1] || !match[2]) break;
    fields += 1;
    const value = match[2].trim();
    switch (fold(match[1].trim())) {
      case 'tipo':
        meta.type = value.slice(0, 80);
        break;
      case 'ano':
        meta.year = /(?:19|20)\d{2}/.exec(value)?.[0] ?? null;
        break;
      case 'dominio':
        meta.domains = value
          .split(/[,;/]/)
          .map((domain) => domain.trim())
          .filter(Boolean)
          .slice(0, 6);
        break;
      case 'populacao':
        meta.population = value.slice(0, 80);
        break;
      default:
        break;
    }
  }
  return meta;
}

/** Cabeçalho que situa um trecho dentro do documento: é o "contexto" do contextual retrieval. */
export function contextHeader(title: string, meta: DocumentMeta): string {
  const kind = [meta.type, meta.year].filter(Boolean).join(', ');
  return [
    `Documento: ${title}${kind ? ` (${kind})` : ''}`,
    meta.domains.length > 0 ? `Domínio: ${meta.domains.join(', ')}` : null,
    meta.population ? `População: ${meta.population}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

/**
 * O que se envia para calcular o embedding: o cabeçalho do documento + o trecho. Só o vetor muda;
 * o texto guardado e verificado por hash (`knowledge_staged_chunks`) continua exatamente o mesmo.
 */
export const contextualizeChunk = (header: string, text: string): string => `${header}\n\n${text}`;

/* -------------------------------------------------------------------------- */
/* Consulta                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Contexto fixo que acompanha a pergunta SÓ no vetor, para os assuntos em que a pergunta coloquial
 * não se parece com o texto formal do artigo. Mensagem de motivação ("parei de treinar, tô sem
 * vontade") não usa as palavras de hábitos, retomada e constância, e sem isso a busca trazia
 * documentos de recuperação e de treino híbrido. O texto é fixo: nunca carrega dado do aluno.
 */
export const QUERY_HINTS = {
  MOTIVATION: 'Assunto: hábitos, motivação, constância e retomada da rotina de treino.',
} as const;
export type QueryHint = keyof typeof QUERY_HINTS;

const LEXICAL_TERM_LIMIT = 12;

/**
 * Pergunta → consulta textual no formato `websearch_to_tsquery`: os termos unidos por `or`, para
 * que uma pergunta inteira ("quantas séries de costas por semana?") encontre o trecho que tem só
 * parte das palavras. As palavras sem significado ("de", "por") o Postgres descarta sozinho. Sem
 * termos úteis devolve `''`, e a busca textual simplesmente não participa.
 */
export function lexicalQuery(question: string): string {
  const terms = question
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length >= 3);
  return [...new Set(terms)].slice(0, LEXICAL_TERM_LIMIT).join(' or ');
}

/* -------------------------------------------------------------------------- */
/* Entrega ao modelo                                                           */
/* -------------------------------------------------------------------------- */

/**
 * O texto do trecho entra na tarefa como DADO dentro de `<dados>`: sem `<` e `>`, ninguém fecha a
 * tag nem abre uma nova. (A varredura do upload já recusa instruções dirigidas a agentes; isto é a
 * segunda camada.)
 */
export function sanitizeEvidenceText(text: string): string {
  return text
    .replace(/[<>]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Os melhores trechos, no máximo `perDocument` por documento: três trechos do mesmo artigo repetem
 * a mesma ideia e tiram o lugar de outra fonte. `ranked` já vem do mais para o menos relevante.
 */
export function pickDiverse<T extends { documentId: string | null }>(
  ranked: readonly T[],
  topK: number,
  perDocument: number,
): T[] {
  const taken = new Map<string, number>();
  const picked: T[] = [];
  for (const item of ranked) {
    if (picked.length >= topK) break;
    const key = item.documentId ?? `solto-${picked.length}`;
    const count = taken.get(key) ?? 0;
    if (count >= perDocument) continue;
    taken.set(key, count + 1);
    picked.push(item);
  }
  return picked;
}
