/**
 * Avaliação OFFLINE da busca (RAG): mede se, para uma pergunta, os trechos certos aparecem entre os
 * primeiros e se perguntas fora do assunto voltam sem nada. É a régua para calibrar
 * `RAG_MIN_COSINE` e para decidir se vale ligar `RAG_ENABLED`.
 *
 * Funções puras: o script (`src/scripts/rag-eval.ts`) é quem fala com o banco e o provedor.
 */
import { z } from 'zod';

export const goldenQuestionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    question: z.string().min(8),
    topic: z.enum(['TRAINING', 'NUTRITION', 'RECOVERY', 'HABITS', 'GENERAL']),
    /**
     * Pergunta que o corpus DEVE saber responder: acerta se, em algum dos trechos devolvidos, o
     * título ou o texto contém QUALQUER um destes termos (sem diferenciar acento nem caixa).
     */
    expectAny: z.array(z.string().min(2)).min(1).optional(),
    /** Contexto de assunto que a produção aplica a esta pergunta (ver `QUERY_HINTS`). */
    hint: z.enum(['MOTIVATION']).optional(),
    /** Pergunta fora do assunto: o certo é a busca devolver NADA. */
    expectNone: z.literal(true).optional(),
    note: z.string().optional(),
  })
  .refine((q) => (q.expectAny !== undefined) !== (q.expectNone === true), {
    message:
      'use `expectAny` (tem resposta no corpus) OU `expectNone` (fora do assunto), nunca os dois',
  });
export type GoldenQuestion = z.infer<typeof goldenQuestionSchema>;

export const goldenSetSchema = z
  .object({
    version: z.number().int().positive(),
    /** Situação do conjunto: enquanto os profissionais não validam, é rascunho e diz isso. */
    status: z.string().min(1),
    questions: z.array(goldenQuestionSchema).min(1),
  })
  .refine((set) => new Set(set.questions.map((q) => q.id)).size === set.questions.length, {
    message: 'ids de perguntas repetidos',
  });
export type GoldenSet = z.infer<typeof goldenSetSchema>;

const fold = (value: string): string => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export interface ScoredChunk {
  title: string;
  text: string;
  cosine: number;
}

export interface QuestionOutcome {
  id: string;
  kind: 'ANSWERABLE' | 'OUT_OF_SCOPE';
  returned: number;
  /** Respondível: algum trecho tem o que se esperava. Fora do assunto: não se aplica (`null`). */
  hit: boolean | null;
  /** Fora do assunto devolvido vazio = acerto. Respondível: não se aplica (`null`). */
  abstained: boolean | null;
  topCosine: number | null;
  topTitle: string | null;
}

/** Julga uma pergunta contra o que a busca devolveu (já com o piso aplicado). */
export function judgeQuestion(
  question: GoldenQuestion,
  chunks: readonly ScoredChunk[],
): QuestionOutcome {
  const top = chunks[0];
  const base = {
    id: question.id,
    returned: chunks.length,
    topCosine: top ? top.cosine : null,
    topTitle: top ? top.title : null,
  };
  if (question.expectNone) {
    return { ...base, kind: 'OUT_OF_SCOPE', hit: null, abstained: chunks.length === 0 };
  }
  const wanted = (question.expectAny ?? []).map(fold);
  const hit = chunks.some((chunk) => {
    const haystack = fold(`${chunk.title}\n${chunk.text}`);
    return wanted.some((term) => haystack.includes(term));
  });
  return { ...base, kind: 'ANSWERABLE', hit, abstained: null };
}

export interface RetrievalSummary {
  answerable: number;
  /** Respondíveis em que algum trecho devolvido tinha o que se esperava. */
  hits: number;
  /** hits / answerable: de quantas perguntas respondíveis a busca trouxe o trecho certo. */
  recall: number;
  /** Respondíveis que voltaram vazias: o piso está alto demais para elas. */
  falseAbstentions: number;
  outOfScope: number;
  /** Fora do assunto que voltaram vazias (o certo). */
  correctAbstentions: number;
  /** correctAbstentions / outOfScope: quão bem a busca se cala quando não tem o que dizer. */
  abstentionRate: number;
  /** Média de trechos devolvidos nas respondíveis (custo de contexto). */
  avgReturnedAnswerable: number;
}

const ratio = (part: number, total: number): number => (total === 0 ? 0 : part / total);

export function summarize(outcomes: readonly QuestionOutcome[]): RetrievalSummary {
  const answerable = outcomes.filter((o) => o.kind === 'ANSWERABLE');
  const outOfScope = outcomes.filter((o) => o.kind === 'OUT_OF_SCOPE');
  const hits = answerable.filter((o) => o.hit).length;
  const correctAbstentions = outOfScope.filter((o) => o.abstained).length;
  return {
    answerable: answerable.length,
    hits,
    recall: ratio(hits, answerable.length),
    falseAbstentions: answerable.filter((o) => o.returned === 0).length,
    outOfScope: outOfScope.length,
    correctAbstentions,
    abstentionRate: ratio(correctAbstentions, outOfScope.length),
    avgReturnedAnswerable: ratio(
      answerable.reduce((sum, o) => sum + o.returned, 0),
      answerable.length,
    ),
  };
}

/** O piso (`RAG_MIN_COSINE`) aplicado depois da busca: permite varrer vários pisos com uma só consulta. */
export function applyFloor<T extends { cosine: number }>(chunks: readonly T[], floor: number): T[] {
  return chunks.filter((chunk) => chunk.cosine >= floor);
}
