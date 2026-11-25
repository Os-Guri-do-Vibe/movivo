/**
 * Artigos padrão da Base de Conhecimento: os artigos científicos que os profissionais já validaram,
 * versionados em `assets/knowledge/` (ver o README de lá). Chamado no fim do `migrate.ts`, então todo
 * ambiente (dev, staging e produção) nasce com a base pronta e a busca (RAG) já tem o que consultar,
 * sem enviar nada pelo painel.
 *
 * ## Por que os vetores vão no repositório
 * O deploy não pode depender de rede nem da chave do provedor de embedding. Cada artigo traz, no
 * `manifest.json`, o hash do original, o hash do texto extraído e, por trecho, o hash e o vetor já
 * calculados (`knowledge:build-defaults` os gera). A carga RECONFERE tudo antes de gravar: se um
 * artigo mudou sem o manifesto ser regerado, o migrate falha, em vez de publicar vetor de outro texto.
 *
 * ## O que grava (a mesma proveniência do envio pelo painel)
 * documento, original, cadeia de eventos até PUBLISHED, texto extraído atestado por hash, trechos
 * imutáveis, vetores e o corpus (`knowledge_base`). É carga do sistema, como as fichas dos agentes e
 * a metodologia padrão: `uploaded_by` fica nulo e não há revisão por pessoa. A função
 * `publish_knowledge_document` não é usada de propósito, porque ela exige uma revisão assinada por
 * um profissional ou administrador, e o canal aqui é o próprio repositório (revisado por código).
 *
 * ## Quando NÃO grava (nunca sobrescreve a equipe)
 * - já existe documento com o mesmo hash ou com a mesma chave lógica (a equipe enviou a versão dela,
 *   ou o padrão já está lá): pula;
 * - a equipe EXCLUIU o artigo pelo painel: a auditoria guarda o hash e a chave (a "lápide"), e ele
 *   não volta no deploy seguinte. Para tirar um padrão de vez, basta excluí-lo no painel.
 *
 * Idempotente: rodar a cada deploy custa a leitura e a conferência de ~50 arquivos.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type postgres from 'postgres';

import { scanArticleText } from '../../modules/admin/knowledge-content-scanner';
import { articleFormatOf, extractArticleText } from '../../modules/admin/knowledge-text-extractor';
import { chunkText, EMBEDDING_RECIPE, PARSER_VERSION } from '../knowledge/corpus-indexer';
import { logicalKeyFor } from '../knowledge/logical-key';
import { EMBEDDING_DIMENSIONS } from './schema/vector';

/** Mesmos valores do envio pelo painel (`knowledge-admin.service.ts`). */
const ARTICLE_TOPIC = 'evidência científica';
const ARTICLE_CATEGORY = 'SCIENTIFIC_EVIDENCE';
const MANIFEST_VERSION = 1;
const ORIGINAL_RETENTION = '365 days';

export interface ManifestChunk {
  /** SHA-256 do texto do trecho. */
  sha256: string;
  /** Vetor do trecho COM o cabeçalho do documento, em float32 little-endian, base64. */
  embedding: string;
}

export interface ManifestArticle {
  /** Arquivo em `assets/knowledge/articles/`. */
  file: string;
  /** Título (a primeira linha `# …` do arquivo): vai para o painel e para o cabeçalho do vetor. */
  title: string;
  /** SHA-256 do original, igual ao que o envio pelo painel gravaria. */
  sha256: string;
  /** SHA-256 do texto extraído. */
  extractionSha256: string;
  chunks: ManifestChunk[];
}

export interface DefaultKnowledgeManifest {
  version: number;
  /** Receita do vetor (`EMBEDDING_RECIPE`) com que o manifesto foi gerado. */
  embeddingRecipe: string;
  dimensions: number;
  articles: ManifestArticle[];
}

export interface DefaultArticle {
  title: string;
  logicalKey: string;
  originalFilename: string;
  payload: Buffer;
  sha256: string;
  content: string;
  contentSha256: string;
  chunks: { text: string; sha256: string; vector: number[] }[];
}

const sha256Of = (value: string | Buffer): string =>
  createHash('sha256').update(value).digest('hex');

/** Título de um artigo padrão: a primeira linha `# …` do texto. */
export function titleOfArticle(content: string): string {
  const first = content.split(/\r?\n/).find((line) => line.trim() !== '');
  const match = first ? /^#\s+(.+?)\s*$/.exec(first) : null;
  if (!match?.[1]) throw new Error('o artigo precisa começar com um título "# …"');
  return match[1].slice(0, 200);
}

/** float32 little-endian em base64 → números. Falha se o tamanho não for o do vetor. */
export function decodeEmbedding(encoded: string): number[] {
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.byteLength !== EMBEDDING_DIMENSIONS * 4) {
    throw new Error(
      `vetor com ${bytes.byteLength / 4} dimensões; o esperado é ${EMBEDDING_DIMENSIONS}`,
    );
  }
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => bytes.readFloatLE(index * 4));
}

/** Números → float32 little-endian em base64 (o inverso de `decodeEmbedding`). */
export function encodeEmbedding(vector: readonly number[]): string {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`vetor com ${vector.length} dimensões; o esperado é ${EMBEDDING_DIMENSIONS}`);
  }
  const bytes = Buffer.alloc(vector.length * 4);
  vector.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  return bytes.toString('base64');
}

export const defaultKnowledgeDir = (apiRoot: string): string =>
  resolve(apiRoot, 'assets', 'knowledge');

export function readManifest(apiRoot: string): DefaultKnowledgeManifest {
  return JSON.parse(
    readFileSync(resolve(defaultKnowledgeDir(apiRoot), 'manifest.json'), 'utf8'),
  ) as DefaultKnowledgeManifest;
}

/**
 * Lê e valida os artigos padrão. Qualquer divergência entre o arquivo e o manifesto é bug do
 * repositório: falha, e o deploy não publica vetor que não é do texto.
 */
export async function loadDefaultArticles(apiRoot: string): Promise<DefaultArticle[]> {
  const manifest = readManifest(apiRoot);
  if (manifest.version !== MANIFEST_VERSION) {
    throw new Error(`[db:migrate] manifesto de artigos padrão na versão ${manifest.version}.`);
  }
  if (
    manifest.embeddingRecipe !== EMBEDDING_RECIPE ||
    manifest.dimensions !== EMBEDDING_DIMENSIONS
  ) {
    throw new Error(
      `[db:migrate] os vetores dos artigos padrão são da receita "${manifest.embeddingRecipe}" ` +
        `(${manifest.dimensions} dimensões) e o código usa "${EMBEDDING_RECIPE}" ` +
        `(${EMBEDDING_DIMENSIONS}). Rode knowledge:build-defaults.`,
    );
  }
  const articles: DefaultArticle[] = [];
  for (const entry of manifest.articles) {
    const where = `[db:migrate] artigo padrão ${entry.file}`;
    const spec = articleFormatOf(entry.file);
    if (spec?.format !== 'md') throw new Error(`${where}: só Markdown.`);
    const payload = readFileSync(resolve(defaultKnowledgeDir(apiRoot), 'articles', entry.file));
    if (sha256Of(payload) !== entry.sha256) {
      throw new Error(`${where}: o arquivo mudou e o manifesto não foi regerado.`);
    }
    const content = await extractArticleText(payload, 'md');
    scanArticleText(content);
    if (sha256Of(content) !== entry.extractionSha256) {
      throw new Error(`${where}: o texto extraído não confere com o manifesto.`);
    }
    if (titleOfArticle(content) !== entry.title) {
      throw new Error(`${where}: o título do manifesto não é o do arquivo.`);
    }
    const pieces = chunkText(content);
    if (pieces.length !== entry.chunks.length) {
      throw new Error(
        `${where}: o arquivo gera ${pieces.length} trechos e o manifesto tem ${entry.chunks.length}.`,
      );
    }
    const chunks = pieces.map((text, index) => {
      const manifestChunk = entry.chunks[index];
      if (!manifestChunk || sha256Of(text) !== manifestChunk.sha256) {
        throw new Error(`${where}: o trecho ${index} não confere com o manifesto.`);
      }
      return {
        text,
        sha256: manifestChunk.sha256,
        vector: decodeEmbedding(manifestChunk.embedding),
      };
    });
    articles.push({
      title: entry.title,
      logicalKey: logicalKeyFor(entry.title),
      originalFilename: entry.file,
      payload,
      sha256: entry.sha256,
      content,
      contentSha256: entry.extractionSha256,
      chunks,
    });
  }
  const keys = articles.map((article) => article.logicalKey);
  if (new Set(keys).size !== keys.length) {
    throw new Error('[db:migrate] artigos padrão com título repetido (mesma chave lógica).');
  }
  return articles;
}

const EVENTS: { status: string; stage: string; note: string }[] = [
  {
    status: 'QUARANTINED',
    stage: 'QUEUE',
    note: 'Carga padrão da aplicação: artigo versionado no repositório.',
  },
  { status: 'PROCESSING', stage: 'INGESTION', note: 'Texto extraído e varrido na carga padrão.' },
  { status: 'READY_FOR_REVIEW', stage: 'REVIEW', note: 'Trechos conferidos contra o manifesto.' },
  {
    status: 'APPROVED',
    stage: 'INDEXING',
    note: 'Carga do sistema: dispensa revisão por pessoa (o repositório é o canal).',
  },
  { status: 'INDEXING', stage: 'INDEXING', note: 'Vetores pré-calculados, conferidos por hash.' },
  { status: 'PUBLISHED', stage: 'PUBLISHED', note: 'Publicado pela carga padrão do deploy.' },
];

/** O artigo já está na base, ou a equipe o excluiu de propósito? (`true` = não gravar.) */
async function shouldSkip(sql: postgres.Sql, article: DefaultArticle): Promise<boolean> {
  const [present] = await sql<{ found: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM knowledge_documents
      WHERE sha256 = ${article.sha256} OR logical_key = ${article.logicalKey}
    ) AS found`;
  if (present?.found) return true;
  const [deleted] = await sql<{ found: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM audit_logs
      WHERE action = 'knowledge.delete'
        AND (changes ->> 'sha256' = ${article.sha256}
          OR changes ->> 'logicalKey' = ${article.logicalKey})
    ) AS found`;
  return deleted?.found === true;
}

/** Grava um artigo padrão, todo na mesma transação: ou entra inteiro, ou não entra. */
async function insertArticle(sql: postgres.Sql, article: DefaultArticle): Promise<boolean> {
  return sql.begin(async (tx) => {
    // O mesmo lock do envio pelo painel: duas cargas ou um envio concorrente não duplicam a versão.
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`knowledge-version:${article.logicalKey}`}, 0))`;
    const [taken] = await tx<{ found: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM knowledge_documents
        WHERE sha256 = ${article.sha256} OR logical_key = ${article.logicalKey}
      ) AS found`;
    if (taken?.found) return false;

    const [document] = await tx<{ id: string }[]>`
      INSERT INTO knowledge_documents (
        title, topic, category, logical_key, version, original_filename, mime_type, size_bytes,
        sha256, uploaded_by
      ) VALUES (
        ${article.title}, ${ARTICLE_TOPIC}, ${ARTICLE_CATEGORY}::knowledge_document_category,
        ${article.logicalKey}, 1, ${article.originalFilename}, 'text/markdown',
        ${article.payload.byteLength}, ${article.sha256}, NULL
      ) RETURNING id`;
    if (!document) throw new Error('documento não gravado');
    const documentId = document.id;

    await tx`
      INSERT INTO knowledge_document_blobs (document_id, payload, retained_until)
      VALUES (${documentId}::uuid, ${article.payload}, now() + ${ORIGINAL_RETENTION}::interval)`;
    for (const [index, event] of EVENTS.entries()) {
      await tx`
        INSERT INTO knowledge_document_events (document_id, sequence, status, stage, note)
        VALUES (${documentId}::uuid, ${index + 1},
          ${event.status}::knowledge_document_status, ${event.stage}, ${event.note})`;
    }
    await tx`
      INSERT INTO knowledge_document_extractions (
        document_id, content, content_sha256, parser_version, detected_mime_type
      ) VALUES (
        ${documentId}::uuid, ${article.content}, ${article.contentSha256}, ${PARSER_VERSION},
        'text/markdown'
      )`;
    for (const [index, chunk] of article.chunks.entries()) {
      const [staged] = await tx<{ id: string }[]>`
        INSERT INTO knowledge_staged_chunks (
          document_id, chunk_index, chunk_text, chunk_sha256, extraction_sha256
        ) VALUES (
          ${documentId}::uuid, ${index}, ${chunk.text}, ${chunk.sha256}, ${article.contentSha256}
        ) RETURNING id`;
      if (!staged) throw new Error('trecho não gravado');
      const literal = `[${chunk.vector.join(',')}]`;
      await tx`
        INSERT INTO knowledge_chunk_embeddings (staged_chunk_id, chunk_sha256, embedding, model)
        VALUES (${staged.id}::uuid, ${chunk.sha256}, ${literal}::vector, ${EMBEDDING_RECIPE})`;
    }
    // O corpus que a busca lê: o mesmo que `publish_knowledge_document` gravaria.
    const published = await tx`
      INSERT INTO knowledge_base (
        document_id, chunk_index, chunk_text, embedding, topic, title, source_url,
        reliability, published_at
      )
      SELECT staged.document_id, staged.chunk_index, staged.chunk_text, embedding.embedding,
        document.topic, document.title, document.source_url, 5, now()
      FROM knowledge_staged_chunks staged
      JOIN knowledge_chunk_embeddings embedding
        ON embedding.staged_chunk_id = staged.id AND embedding.chunk_sha256 = staged.chunk_sha256
      JOIN knowledge_documents document ON document.id = staged.document_id
      WHERE staged.document_id = ${documentId}::uuid
      RETURNING id`;
    if (published.length !== article.chunks.length) {
      throw new Error(
        `corpus com ${published.length} trechos; o esperado é ${article.chunks.length}`,
      );
    }
    return true;
  });
}

/** Grava os artigos padrão que faltam. Devolve quantos entraram nesta execução. */
export async function seedDefaultArticles(sql: postgres.Sql, apiRoot: string): Promise<number> {
  const articles = await loadDefaultArticles(apiRoot);
  let inserted = 0;
  for (const article of articles) {
    if (await shouldSkip(sql, article)) continue;
    if (await insertArticle(sql, article)) inserted += 1;
  }
  return inserted;
}
