import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EMBEDDING_RECIPE } from '../knowledge/corpus-indexer';
import { parseDocumentMeta } from '../knowledge/rag-text';
import {
  decodeEmbedding,
  defaultKnowledgeDir,
  encodeEmbedding,
  loadDefaultArticles,
  readManifest,
  titleOfArticle,
} from './default-articles';
import { EMBEDDING_DIMENSIONS } from './schema/vector';

/** Vitest roda a partir de `apps/api`, a mesma raiz que o `migrate.ts` usa. */
const API_ROOT = process.cwd();
const ARTICLES_DIR = resolve(defaultKnowledgeDir(API_ROOT), 'articles');
/** Limite de envio pelo painel (KNOWLEDGE_UPLOAD_MAX_BYTES): o padrão não pode passar do que a equipe pode enviar. */
const UPLOAD_MAX_BYTES = 524_288;

describe('artigos padrão da Base de Conhecimento (assets/knowledge)', () => {
  const manifest = readManifest(API_ROOT);
  const files = readdirSync(ARTICLES_DIR).sort();

  it('o manifesto cobre exatamente os arquivos da pasta, sem sobra nem falta', () => {
    expect(manifest.articles.map((article) => article.file).sort()).toEqual(files);
    expect(files.length).toBeGreaterThanOrEqual(48);
  });

  it('só Markdown de artigo na pasta (as referências ficam em docs/, fora do RAG)', () => {
    for (const file of files) {
      expect(file, file).toMatch(/^[a-z0-9-]+\.md$/);
      expect(file, file).not.toMatch(/referencias/i);
    }
  });

  it('o manifesto foi gerado com a receita de vetor atual e a dimensão do banco', () => {
    expect(manifest.embeddingRecipe).toBe(EMBEDDING_RECIPE);
    expect(manifest.dimensions).toBe(EMBEDDING_DIMENSIONS);
  });

  it('carrega e confere tudo: hash do original e do texto, título, trechos e vetores', async () => {
    const articles = await loadDefaultArticles(API_ROOT);

    expect(articles).toHaveLength(manifest.articles.length);
    for (const article of articles) {
      expect(article.chunks.length, article.originalFilename).toBeGreaterThan(0);
      for (const chunk of article.chunks) expect(chunk.vector).toHaveLength(EMBEDDING_DIMENSIONS);
    }
  });

  it('título e chave lógica são únicos (o título é a primeira linha "# …" do arquivo)', async () => {
    const articles = await loadDefaultArticles(API_ROOT);

    expect(new Set(articles.map((a) => a.title)).size).toBe(articles.length);
    expect(new Set(articles.map((a) => a.logicalKey)).size).toBe(articles.length);
    for (const article of articles) {
      expect(article.title.length).toBeLessThanOrEqual(200);
      expect(article.title).toBe(titleOfArticle(article.content));
    }
  });

  it('cada artigo cabe no limite de envio e traz o cabeçalho que dá contexto ao vetor', () => {
    for (const file of files) {
      const text = readFileSync(resolve(ARTICLES_DIR, file), 'utf8');
      expect(Buffer.byteLength(text), file).toBeLessThanOrEqual(UPLOAD_MAX_BYTES);
      const meta = parseDocumentMeta(text);
      expect(meta.domains.length, `${file}: falta "Domínio:" no cabeçalho`).toBeGreaterThan(0);
      expect(meta.population, `${file}: falta "População:" no cabeçalho`).not.toBeNull();
      // O texto vira dado no prompt: `<` e `>` sairiam de qualquer jeito, melhor nem existirem.
      expect(text, file).not.toMatch(/[<>]/);
    }
  });

  it('nenhum artigo padrão cita autor, estudo ou link no corpo (o agente não pode citar)', () => {
    for (const file of files) {
      const text = readFileSync(resolve(ARTICLES_DIR, file), 'utf8');
      expect(text, file).not.toMatch(/https?:\/\/|\bdoi\b|\bet al\b/i);
    }
  });
});

describe('empacotamento', () => {
  it('o .dockerignore deixa os artigos entrarem na imagem (ele descarta todo *.md)', () => {
    const dockerignore = readFileSync(resolve(API_ROOT, '..', '..', '.dockerignore'), 'utf8');
    const lines = dockerignore.split('\n').map((line) => line.trim());
    const excludesMarkdown = lines.includes('**/*.md');
    const allowsArticles = lines.includes('!apps/api/assets/knowledge/articles/*.md');

    expect(!excludesMarkdown || allowsArticles).toBe(true);
  });
});

describe('titleOfArticle', () => {
  it('pega a primeira linha "# …", ignorando linhas em branco antes', () => {
    expect(titleOfArticle('\n\n# Volume semanal\n\ntexto')).toBe('Volume semanal');
  });

  it('recusa texto que não começa com título', () => {
    expect(() => titleOfArticle('Tipo: revisão\n\n# Depois')).toThrow(/título/);
    expect(() => titleOfArticle('')).toThrow(/título/);
  });
});

describe('vetor em base64 (float32)', () => {
  it('vai e volta sem perder nada, já que o banco também guarda float32', () => {
    const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) =>
      Math.fround(Math.sin(i) / 3),
    );

    expect(decodeEmbedding(encodeEmbedding(vector))).toEqual(vector);
  });

  it('recusa vetor com a dimensão errada, na ida e na volta', () => {
    expect(() => encodeEmbedding([0.1, 0.2])).toThrow(/dimensões/);
    expect(() => decodeEmbedding(Buffer.alloc(8).toString('base64'))).toThrow(/dimensões/);
  });
});
