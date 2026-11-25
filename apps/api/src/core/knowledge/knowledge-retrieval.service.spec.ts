import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { PinoLogger } from 'nestjs-pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppConfigService } from '../config';
import type { TenantDatabase } from '../database/tenant-database.service';
import type { EmbeddingPort } from './embedding.port';
import { KnowledgeRetrievalService } from './knowledge-retrieval.service';

const dialect = new PgDialect();

function row(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    document_id: 'doc-1',
    chunk_index: 0,
    title: 'Currier 2023',
    chunk_text: `texto do trecho ${id}`,
    cosine: '0.41',
    score: '0.0328',
    ...over,
  };
}

function build(
  options: {
    enabled?: boolean;
    proactiveEnabled?: boolean;
    rows?: unknown[];
    embed?: () => Promise<number[]>;
  } = {},
) {
  const { enabled = true, proactiveEnabled = true, rows = [], embed } = options;
  const execute = vi.fn(async (_query: SQL) => rows);
  const db = {
    runAsSystem: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb({ execute })),
  } as unknown as TenantDatabase;
  const embedding = {
    embed: vi.fn(embed ?? (async () => [0.1, 0.2, 0.3])),
    embedBatch: vi.fn(),
  } as unknown as EmbeddingPort;
  const config = {
    rag: {
      enabled,
      proactiveEnabled,
      minCosine: 0.25,
      topK: 3,
      candidates: 20,
      rerankMinScore: 0.5,
    },
  } as unknown as AppConfigService;
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const service = new KnowledgeRetrievalService(
    config,
    db,
    embedding,
    logger as unknown as PinoLogger,
  );
  return { service, execute, embedding, logger, db };
}

afterEach(() => vi.useRealTimers());

describe('KnowledgeRetrievalService.evidenceFor', () => {
  it('desligado: não busca, não gasta embedding e devolve vazio', async () => {
    const { service, embedding, db } = build({ enabled: false, rows: [row('a')] });

    expect(await service.evidenceFor('quantas séries de costas por semana?')).toEqual([]);
    expect(embedding.embed).not.toHaveBeenCalled();
    expect(db.runAsSystem).not.toHaveBeenCalled();
  });

  it('ligado: devolve só o que o modelo precisa (id, título, texto) e registra ids e notas', async () => {
    const { service, logger } = build({ rows: [row('a'), row('b', { document_id: 'doc-2' })] });

    const evidence = await service.evidenceFor('quantas séries de costas por semana?');

    expect(evidence).toEqual([
      { id: 'a', title: 'Currier 2023', text: 'texto do trecho a' },
      { id: 'b', title: 'Currier 2023', text: 'texto do trecho b' },
    ]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'rag_retrieval',
        returned: 2,
        chunkIds: ['a', 'b'],
        cosines: [0.41, 0.41],
      }),
      expect.any(String),
    );
  });

  it('a pergunta do aluno nunca vai para o log', async () => {
    const { service, logger } = build({ rows: [row('a')] });
    await service.evidenceFor('tenho dor no joelho e tomo remédio X, qual treino faço?');

    const logged = JSON.stringify([...logger.info.mock.calls, ...logger.warn.mock.calls]);
    expect(logged).not.toContain('joelho');
    expect(logged).not.toContain('remédio');
  });

  it('qualquer falha vira lista vazia: a resposta ao aluno segue sem evidência', async () => {
    const { service, logger } = build({
      embed: async () => {
        throw new Error('provedor fora do ar');
      },
    });

    expect(await service.evidenceFor('quantas séries de costas por semana?')).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'rag_retrieval_failed' }),
      expect.any(String),
    );
  });

  it('busca lenta demais (mais de 4 s) é abandonada', async () => {
    vi.useFakeTimers();
    const { service } = build({ embed: () => new Promise(() => undefined) });

    const pending = service.evidenceFor('quantas séries de costas por semana?');
    await vi.advanceTimersByTimeAsync(4_100);

    expect(await pending).toEqual([]);
  });
});

describe('KnowledgeRetrievalService · contexto de assunto (motivação)', () => {
  const question = 'parei de treinar faz duas semanas e tô sem vontade de voltar';

  it('o contexto vai só no vetor: a busca textual segue com as palavras da pergunta', async () => {
    const { service, embedding, execute } = build({ rows: [] });

    await service.evidenceFor(question, { hint: 'MOTIVATION' });

    const sent = vi.mocked(embedding.embed).mock.calls[0]?.[0] ?? '';
    expect(sent).toContain('parei de treinar');
    expect(sent).toContain('hábitos, motivação, constância e retomada da rotina');
    const { params } = dialect.sqlToQuery(execute.mock.calls[0]?.[0] as SQL);
    const lexical = String(params[1]);
    expect(lexical).toContain('treinar');
    expect(lexical).not.toContain('constância');
  });

  it('sem contexto, o vetor leva só a pergunta (treino e nutrição não mudam)', async () => {
    const { service, embedding } = build({ rows: [] });

    await service.evidenceFor('quantas séries de costas por semana?');

    const sent = vi.mocked(embedding.embed).mock.calls[0]?.[0] ?? '';
    expect(sent).not.toContain('Assunto:');
  });

  it('o contexto é um texto fixo e o log só registra o nome dele', async () => {
    const { service, logger } = build({ rows: [row('a')] });

    await service.evidenceFor(question, { hint: 'MOTIVATION' });

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ hint: 'MOTIVATION', source: 'question' }),
      expect.any(String),
    );
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('parei de treinar');
  });

  it('desligado, o contexto não faz a busca acontecer', async () => {
    const { service, embedding } = build({ enabled: false });

    expect(await service.evidenceFor(question, { hint: 'MOTIVATION' })).toEqual([]);
    expect(embedding.embed).not.toHaveBeenCalled();
  });
});

describe('KnowledgeRetrievalService.evidenceForTopic (mensagens proativas)', () => {
  const topic = 'adesão ao treino: manter a consistência e retomar a rotina com o menor passo';

  it('liga com as duas chaves: devolve id, título e texto e marca a origem no log', async () => {
    const { service, logger } = build({ rows: [row('a')] });

    expect(await service.evidenceForTopic(topic)).toEqual([
      { id: 'a', title: 'Currier 2023', text: 'texto do trecho a' },
    ]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'rag_retrieval', source: 'proactive' }),
      expect.any(String),
    );
  });

  it('RAG_PROACTIVE_ENABLED desligada: não busca nem gasta embedding', async () => {
    const { service, embedding, db } = build({ proactiveEnabled: false, rows: [row('a')] });

    expect(await service.evidenceForTopic(topic)).toEqual([]);
    expect(embedding.embed).not.toHaveBeenCalled();
    expect(db.runAsSystem).not.toHaveBeenCalled();
  });

  it('RAG_ENABLED desligada vale mais que a chave proativa', async () => {
    const { service, embedding } = build({ enabled: false, proactiveEnabled: true });

    expect(await service.evidenceForTopic(topic)).toEqual([]);
    expect(embedding.embed).not.toHaveBeenCalled();
  });

  it('falha vira lista vazia: a revisão segue só pelos números do aluno', async () => {
    const { service } = build({
      embed: async () => {
        throw new Error('provedor fora do ar');
      },
    });

    expect(await service.evidenceForTopic(topic)).toEqual([]);
  });

  it('a pergunta do aluno também marca a origem como "question"', async () => {
    const { service, logger } = build({ rows: [row('a')] });
    await service.evidenceFor('quantas séries de costas por semana?');

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'question' }),
      expect.any(String),
    );
  });
});

describe('KnowledgeRetrievalService.search', () => {
  it('pergunta curta demais ou sem termos úteis nem chega ao provedor', async () => {
    const { service, embedding } = build({ rows: [row('a')] });

    expect(await service.search('e jejum')).toEqual([]);
    expect(await service.search('a b c d e f g h i')).toEqual([]);
    expect(embedding.embed).not.toHaveBeenCalled();
  });

  it('anonimiza a pergunta antes de mandá-la ao provedor de embedding', async () => {
    const { service, embedding } = build({ rows: [] });

    await service.search(
      'meu email é aluno@exemplo.com e o telefone (11) 91234-5678: quanto de proteína?',
    );

    const sent = vi.mocked(embedding.embed).mock.calls[0]?.[0] ?? '';
    expect(sent).not.toContain('aluno@exemplo.com');
    expect(sent).not.toContain('91234');
    expect(sent).toContain('proteína');
  });

  it('manda ao banco o vetor, a consulta textual, os candidatos, o piso e o limite', async () => {
    const { service, execute } = build({ rows: [] });

    await service.search('quantas séries de costas por semana?');

    const { sql: text, params } = dialect.sqlToQuery(execute.mock.calls[0]?.[0] as SQL);
    expect(text).toContain('websearch_to_tsquery');
    expect(text).toContain('unaccent');
    expect(text).toContain('<=>');
    expect(params).toEqual([
      '[0.1,0.2,0.3]',
      'quantas or séries or costas or por or semana',
      20,
      20,
      60,
      60,
      0.25,
      9,
    ]);
  });

  it('opções sobrescrevem o piso e o top-K (a avaliação offline varre limiares)', async () => {
    const { service, execute } = build({ rows: [] });

    await service.search('quantas séries de costas por semana?', { topK: 5, minCosine: 0.4 });

    const { params } = dialect.sqlToQuery(execute.mock.calls[0]?.[0] as SQL);
    expect(params.slice(-2)).toEqual([0.4, 15]);
  });

  it('no máximo 2 trechos por documento, e o texto chega sem < nem >', async () => {
    const { service } = build({
      rows: [
        row('a1', { chunk_text: 'abre <dados> e fecha </dados>' }),
        row('a2'),
        row('a3'),
        row('b1', { document_id: 'doc-2' }),
        row('c1', { document_id: 'doc-3' }),
      ],
    });

    const found = await service.search('quantas séries de costas por semana?');

    expect(found.map((chunk) => chunk.id)).toEqual(['a1', 'a2', 'b1']);
    expect(found[0]?.text).not.toMatch(/[<>]/);
    expect(found[0]).toMatchObject({ cosine: 0.41, score: 0.0328, documentId: 'doc-1' });
  });

  it('search não depende da chave RAG_ENABLED (é o que a avaliação offline usa)', async () => {
    const { service } = build({ enabled: false, rows: [row('a')] });
    expect(await service.search('quantas séries de costas por semana?')).toHaveLength(1);
  });
});
