/**
 * Regras que valem para QUALQUER agente que receba evidência da Base de Conhecimento (resposta ao
 * aluno, analistas da revisão semanal): o formato do trecho e a proibição de citar a fonte.
 */
import { z } from 'zod';

import { fold } from './rag-text';

/** Trecho de artigo da Base de Conhecimento que a busca (RAG) achou relevante. */
export const evidenceChunkSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().max(200),
  text: z.string().min(1).max(2_000),
});

/** Até 3 trechos de artigos curados; ausente quando o RAG está desligado ou nada serviu. */
export const evidenceListSchema = z.array(evidenceChunkSchema).max(3).optional();

/**
 * Política das fichas: o aluno nunca recebe citação de estudo, autor, revista ou link. Modelo de
 * linguagem inventa referência com facilidade, e uma citação falsa dita a um aluno é pior do que
 * nenhuma. Vale com ou sem evidência: a evidência embasa, não aparece.
 */
const CITATION_PATTERNS = [
  /\bet al\b/,
  /\bdoi\b/,
  /https?:|www\./,
  /\b(segundo|de acordo com|conforme)\b[^.]{0,40}\b(estudos?|pesquisas?|artigos?|meta[- ]?analises?|revisao|revisoes|consensos?|literatura|autores?|cientistas?|ciencia)\b/,
  /\b(estudos?|pesquisas?|artigos?|revisao|revisoes|meta[- ]?analises?)\b[^.]{0,25}\b(mostram?|indicam?|apontam?|comprovam?|demonstram?|sugerem?|diz|dizem)\b/,
];

export const CITATION_BAN_MESSAGE =
  'não cite estudo, pesquisa, autor, revista, ano nem link: use o conteúdo sem dizer de onde veio';

/** `true` se o texto cita fonte científica (estudo, autor, revista, link). */
export function citesSource(text: string): boolean {
  const folded = fold(text);
  return CITATION_PATTERNS.some((pattern) => pattern.test(folded));
}

/** Uma violação por padrão de citação encontrado, no formato dos validadores das tarefas. */
export function citationViolations(
  text: string,
  path: string,
): { path: string; message: string }[] {
  const folded = fold(text);
  return CITATION_PATTERNS.filter((pattern) => pattern.test(folded)).map(() => ({
    path,
    message: CITATION_BAN_MESSAGE,
  }));
}
