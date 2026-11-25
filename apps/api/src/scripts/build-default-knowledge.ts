/**
 * Gera (ou atualiza) o manifesto dos artigos padrão da Base de Conhecimento: `assets/knowledge/manifest.json`.
 *
 * Para cada arquivo de `assets/knowledge/articles/` calcula o hash do original, extrai e varre o texto,
 * corta em trechos e calcula o vetor de cada trecho COM o cabeçalho do documento (a mesma receita do
 * envio pelo painel). O deploy só LÊ esse manifesto (`seedDefaultArticles`), sem rede nem chave.
 *
 * Artigo que não mudou reaproveita os vetores do manifesto atual: só o que é novo ou editado paga
 * embedding. Precisa do embedding REAL (OPENAI_API_KEY + KNOWLEDGE_OPENAI_EMBEDDING_HEALTH_DATA_APPROVED):
 * vetor do embedding de desenvolvimento não vale e o script recusa.
 *
 *   pnpm --filter @movivo/api knowledge:build-defaults
 *   (dentro do container: node --enable-source-maps dist/scripts/build-default-knowledge.js)
 *
 * Depois de rodar, confira o `git diff` do manifesto e faça commit junto dos artigos.
 */
import 'reflect-metadata';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { scanArticleText } from '../modules/admin/knowledge-content-scanner';
import { extractArticleText } from '../modules/admin/knowledge-text-extractor';
import { CoreModule } from '../core/core.module';
import {
  defaultKnowledgeDir,
  encodeEmbedding,
  readManifest,
  titleOfArticle,
  type DefaultKnowledgeManifest,
  type ManifestArticle,
} from '../core/database/default-articles';
import { EMBEDDING_DIMENSIONS } from '../core/database/schema/vector';
import { chunkText, EMBEDDING_RECIPE } from '../core/knowledge/corpus-indexer';
import {
  EMBEDDING_PORT,
  FakeEmbedding,
  type EmbeddingPort,
} from '../core/knowledge/embedding.port';
import { contextHeader, contextualizeChunk, parseDocumentMeta } from '../core/knowledge/rag-text';

@Module({ imports: [CoreModule] })
class BuildDefaultKnowledgeModule {}

const out = (text = ''): void => {
  process.stdout.write(`${text}\n`);
};
const sha256Of = (value: string | Buffer): string =>
  createHash('sha256').update(value).digest('hex');

async function main(): Promise<void> {
  const apiRoot = process.cwd();
  const dir = resolve(defaultKnowledgeDir(apiRoot), 'articles');
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort();
  if (files.length === 0) throw new Error(`nenhum artigo em ${dir}`);

  const manifestPath = resolve(defaultKnowledgeDir(apiRoot), 'manifest.json');
  const previous = existsSync(manifestPath) ? readManifest(apiRoot) : null;
  const reusable =
    previous && previous.embeddingRecipe === EMBEDDING_RECIPE
      ? new Map(previous.articles.map((article) => [article.file, article]))
      : new Map<string, ManifestArticle>();

  const app = await NestFactory.createApplicationContext(BuildDefaultKnowledgeModule, {
    logger: ['error'],
  });
  try {
    const embedding = app.get<EmbeddingPort>(EMBEDDING_PORT);
    const articles: ManifestArticle[] = [];
    let embedded = 0;
    let reused = 0;

    for (const file of files) {
      const payload = readFileSync(resolve(dir, file));
      const sha256 = sha256Of(payload);
      const content = await extractArticleText(payload, 'md');
      scanArticleText(content);
      const title = titleOfArticle(content);
      const extractionSha256 = sha256Of(content);
      const pieces = chunkText(content);

      const old = reusable.get(file);
      if (
        old &&
        old.sha256 === sha256 &&
        old.extractionSha256 === extractionSha256 &&
        old.title === title &&
        old.chunks.length === pieces.length &&
        old.chunks.every((chunk, index) => chunk.sha256 === sha256Of(pieces[index] ?? ''))
      ) {
        articles.push(old);
        reused += 1;
        continue;
      }

      if (embedding instanceof FakeEmbedding) {
        throw new Error(
          `${file} é novo ou mudou e precisa de vetor, mas o embedding é o de desenvolvimento (falso). ` +
            'Rode com OPENAI_API_KEY e KNOWLEDGE_OPENAI_EMBEDDING_HEALTH_DATA_APPROVED=true.',
        );
      }
      const header = contextHeader(title, parseDocumentMeta(pieces[0] ?? ''));
      const vectors = await embedding.embedBatch(
        pieces.map((piece) => contextualizeChunk(header, piece)),
      );
      if (vectors.length !== pieces.length)
        throw new Error(`${file}: lote de embedding inconsistente`);
      articles.push({
        file,
        title,
        sha256,
        extractionSha256,
        chunks: pieces.map((piece, index) => ({
          sha256: sha256Of(piece),
          embedding: encodeEmbedding(vectors[index] ?? []),
        })),
      });
      embedded += pieces.length;
      out(`  vetores novos: ${file} (${pieces.length} trechos)`);
    }

    const manifest: DefaultKnowledgeManifest = {
      version: 1,
      embeddingRecipe: EMBEDDING_RECIPE,
      dimensions: EMBEDDING_DIMENSIONS,
      articles,
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    const chunks = articles.reduce((sum, article) => sum + article.chunks.length, 0);
    out(
      `\nManifesto gravado: ${articles.length} artigos, ${chunks} trechos ` +
        `(${embedded} vetores novos, ${reused} artigos reaproveitados).\n${manifestPath}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
