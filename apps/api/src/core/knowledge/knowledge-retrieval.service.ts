/**
 * Busca nos artigos da Base de Conhecimento (a metade de "recuperação" do RAG).
 *
 * A pergunta do aluno vira um vetor (embedding) e uma consulta textual. As duas buscas correm no
 * mesmo SQL e se fundem por RRF (Reciprocal Rank Fusion): o vetor pega o sentido ("quanto de
 * proteína" ≈ "ingestão proteica"); o texto pega o termo exato ("creatina", "RIR") e vale mesmo
 * sem acento. Um trecho só entra se tiver similaridade mínima com a pergunta (`RAG_MIN_COSINE`),
 * então pergunta fora do corpus devolve NADA — e "nada" é um resultado correto.
 *
 * Princípios:
 * - Quem chama nunca fica pior do que sem RAG: desligado, sem corpus, abaixo do piso, lento ou com
 *   erro, o resultado é uma lista vazia e a resposta segue como antes.
 * - A pergunta pode ter dado de saúde: é anonimizada antes de ir ao provedor de embedding e NUNCA
 *   vai para o log (só ids e notas dos trechos).
 */
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import { scrubPII } from '../ai/pii-scrubber';
import { AppConfigService } from '../config';
import { TenantDatabase } from '../database/tenant-database.service';
import { EMBEDDING_PORT, type EmbeddingPort } from './embedding.port';
import {
  lexicalQuery,
  pickDiverse,
  QUERY_HINTS,
  sanitizeEvidenceText,
  type QueryHint,
} from './rag-text';

/** O que o modelo recebe de cada trecho. */
export interface EvidenceChunk {
  id: string;
  title: string;
  text: string;
}

/** O que a busca devolve, com as notas que a avaliação offline e o log precisam. */
export interface RetrievedChunk extends EvidenceChunk {
  documentId: string | null;
  chunkIndex: number | null;
  /** Similaridade de cosseno entre a pergunta e o trecho (0–1). */
  cosine: number;
  /** Nota RRF (vetor + texto): só serve para ordenar. */
  score: number;
}

export interface SearchOptions {
  topK?: number;
  minCosine?: number;
  /** Contexto de assunto que vai só no vetor (ver `QUERY_HINTS`); a busca textual não muda. */
  hint?: QueryHint;
}

/** Perguntas curtas demais ("e jejum?") não carregam sentido para buscar. */
const MIN_QUESTION_CHARS = 8;
/** Dois trechos do mesmo artigo repetem a mesma ideia; mais que isso tira o lugar de outra fonte. */
const MAX_CHUNKS_PER_DOCUMENT = 2;
/** Constante clássica do RRF: suaviza a diferença entre as primeiras posições. */
const RRF_K = 60;
/** A resposta ao aluno não espera a busca mais que isso: passou, segue sem evidência. */
const RETRIEVAL_TIMEOUT_MS = 4_000;

interface Row {
  id: string;
  document_id: string | null;
  chunk_index: number | null;
  title: string;
  chunk_text: string;
  cosine: number | string;
  score: number | string;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`busca nos artigos passou de ${ms} ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

@Injectable()
export class KnowledgeRetrievalService {
  constructor(
    private readonly config: AppConfigService,
    private readonly db: TenantDatabase,
    @Inject(EMBEDDING_PORT) private readonly embedding: EmbeddingPort,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(KnowledgeRetrievalService.name);
  }

  get enabled(): boolean {
    return this.config.rag.enabled;
  }

  /**
   * A evidência que o agente recebe para responder `question`. Lista vazia quando o RAG está
   * desligado ou nada passa do piso de similaridade. Nunca lança.
   */
  async evidenceFor(
    question: string,
    options: { hint?: QueryHint } = {},
  ): Promise<EvidenceChunk[]> {
    if (!this.enabled) return [];
    return this.retrieve(question, 'question', options.hint);
  }

  /**
   * A evidência para uma mensagem proativa (revisão semanal): `topic` é uma consulta montada pelo
   * código a partir de rótulos fixos dos sinais, NUNCA texto do aluno nem dado de saúde. Exige
   * `RAG_ENABLED` e `RAG_PROACTIVE_ENABLED`. Nunca lança.
   */
  async evidenceForTopic(topic: string): Promise<EvidenceChunk[]> {
    if (!this.enabled || !this.config.rag.proactiveEnabled) return [];
    return this.retrieve(topic, 'proactive');
  }

  private async retrieve(
    query: string,
    source: 'question' | 'proactive',
    hint?: QueryHint,
  ): Promise<EvidenceChunk[]> {
    const started = Date.now();
    try {
      const chunks = await withTimeout(this.search(query, { hint }), RETRIEVAL_TIMEOUT_MS);
      this.logger.info(
        {
          event: 'rag_retrieval',
          source,
          ...(hint ? { hint } : {}),
          returned: chunks.length,
          chunkIds: chunks.map((chunk) => chunk.id),
          cosines: chunks.map((chunk) => Number(chunk.cosine.toFixed(3))),
          ms: Date.now() - started,
        },
        'busca nos artigos',
      );
      return chunks.map(({ id, title, text }) => ({ id, title, text }));
    } catch (error) {
      this.logger.warn(
        { event: 'rag_retrieval_failed', err: error, ms: Date.now() - started },
        'busca nos artigos falhou; a resposta segue sem evidência',
      );
      return [];
    }
  }

  /**
   * A busca completa, ignorando a chave `RAG_ENABLED`: a avaliação offline (`rag:eval`) precisa
   * medi-la antes de o RAG ser ligado.
   */
  async search(question: string, options: SearchOptions = {}): Promise<RetrievedChunk[]> {
    const { topK: defaultTopK, minCosine: defaultMinCosine, candidates } = this.config.rag;
    const topK = options.topK ?? defaultTopK;
    const minCosine = options.minCosine ?? defaultMinCosine;

    const text = scrubPII(question, {}).trim();
    const lexical = lexicalQuery(text);
    if (text.length < MIN_QUESTION_CHARS || lexical === '') return [];

    // O contexto de assunto só entra no vetor: a busca textual segue só com as palavras da pergunta.
    const vector = await this.embedding.embed(
      options.hint ? `${text}\n${QUERY_HINTS[options.hint]}` : text,
    );
    const literal = `[${vector.join(',')}]`;
    const rows = await this.db.runAsSystem(async (tx) => {
      const result = await tx.execute(sql`
        WITH q AS (
          SELECT ${literal}::vector AS v,
                 websearch_to_tsquery('portuguese', unaccent(${lexical}::text)) AS tsq
        ),
        dense AS (
          SELECT kb.id, row_number() OVER (ORDER BY kb.embedding <=> q.v) AS rank
          FROM knowledge_base kb, q
          ORDER BY kb.embedding <=> q.v
          LIMIT ${candidates}::int
        ),
        lexical AS (
          SELECT kb.id, row_number() OVER (ORDER BY ts_rank_cd(doc.tsv, q.tsq) DESC) AS rank
          FROM knowledge_base kb
          CROSS JOIN q
          CROSS JOIN LATERAL (
            SELECT to_tsvector('portuguese', unaccent(kb.title || ' ' || kb.chunk_text)) AS tsv
          ) doc
          WHERE doc.tsv @@ q.tsq
          ORDER BY ts_rank_cd(doc.tsv, q.tsq) DESC
          LIMIT ${candidates}::int
        )
        SELECT kb.id, kb.document_id, kb.chunk_index, kb.title, kb.chunk_text,
               1 - (kb.embedding <=> q.v) AS cosine,
               COALESCE(1.0 / (${RRF_K}::int + d.rank), 0)
                 + COALESCE(1.0 / (${RRF_K}::int + l.rank), 0) AS score
        FROM knowledge_base kb
        CROSS JOIN q
        LEFT JOIN dense d ON d.id = kb.id
        LEFT JOIN lexical l ON l.id = kb.id
        WHERE (d.id IS NOT NULL OR l.id IS NOT NULL)
          AND 1 - (kb.embedding <=> q.v) >= ${minCosine}::float8
        ORDER BY score DESC, cosine DESC
        LIMIT ${topK * 3}::int
      `);
      return result as unknown as Row[];
    });

    const ranked: RetrievedChunk[] = rows.map((row) => ({
      id: row.id,
      documentId: row.document_id,
      chunkIndex: row.chunk_index,
      title: row.title,
      text: sanitizeEvidenceText(row.chunk_text),
      cosine: Number(row.cosine),
      score: Number(row.score),
    }));
    return pickDiverse(ranked, topK, MAX_CHUNKS_PER_DOCUMENT);
  }
}
