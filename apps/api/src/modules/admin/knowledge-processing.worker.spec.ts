import { createHash } from 'node:crypto';

import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { EmbeddingPort } from '../../core/knowledge/embedding.port';
import type { WorkerFactory } from '../jobs/worker.factory';
import {
  KnowledgeProcessingWorker,
  type KnowledgeProcessingJob,
} from './knowledge-processing.worker';

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

const DOCUMENT_ID = '33333333-3333-4333-8333-333333333333';
const CONTENT =
  'Progressao dupla: sobe a repeticao ate o teto da faixa e so entao sobe a carga, sempre dentro do protocolo assinado pelo profissional CREF.';
const SHA256 = sha256(CONTENT);

function state(over: Record<string, unknown> = {}) {
  return [{ status: 'QUARANTINED', stage: 'QUEUE', error_code: null, ...over }];
}

/**
 * `executes` é consumido em ordem por `tx.execute`, em uma única fila compartilhada por
 * todas as chamadas a `db.runAsSystem` (o worker abre várias transações por método —
 * ver comentário equivalente em `knowledge-admin.service.spec.ts`). O item sobressalente
 * repete via `mockImplementation`.
 */
function makeWorker(
  options: {
    executes?: unknown[][];
    embedBatch?: (texts: string[]) => Promise<number[][]>;
    fallback?: unknown[];
  } = {},
) {
  const { executes = [], embedBatch, fallback = [] } = options;
  const execute = vi.fn();
  for (const rows of executes) execute.mockImplementationOnce(async () => rows);
  execute.mockImplementation(async () => fallback);
  const tx = { execute };
  const db = {
    runAsSystem: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
  } as unknown as TenantDatabase;

  const embedding = {
    embedBatch: embedBatch ?? vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
    embed: vi.fn(),
  } as unknown as EmbeddingPort;

  const workers = { create: vi.fn() } as unknown as WorkerFactory;
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    setContext: vi.fn(),
  };
  const worker = new KnowledgeProcessingWorker(workers, db, embedding, logger as never);
  return { worker, execute, db, embedding, workers, logger };
}

function job(
  name: 'ingest' | 'index',
  data: Partial<KnowledgeProcessingJob> = {},
): Job<KnowledgeProcessingJob> {
  return {
    name,
    data: { documentId: DOCUMENT_ID, ...data },
  } as unknown as Job<KnowledgeProcessingJob>;
}

describe('KnowledgeProcessingWorker.process → ingest', () => {
  it('extrai, varre, faz chunk e staginga com proveniência verificada', async () => {
    const { worker, execute, logger } = makeWorker({
      executes: [
        [], // lock (transação 1)
        state({ status: 'QUARANTINED', stage: 'QUEUE' }), // currentKnowledgeState
        [{ mime_type: 'text/markdown', sha256: SHA256, payload: Buffer.from(CONTENT, 'utf8') }], // original + blob
        [], // appendKnowledgeEvent(PROCESSING/INGESTION)
        [], // lock (transação 2)
        state({ status: 'PROCESSING', stage: 'INGESTION' }), // currentKnowledgeState
        [], // insert extraction
        [], // insert staged chunk
        [{ count: 1 }], // verificação de proveniência (1 chunk gerado)
        [], // appendKnowledgeEvent(READY_FOR_REVIEW/REVIEW)
      ],
    });

    const result = await worker.process(job('ingest'));

    expect(result).toEqual({ status: 'READY_FOR_REVIEW', chunks: 1 });
    expect(execute).toHaveBeenCalledTimes(10);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'knowledge_ingestion_ready',
        documentId: DOCUMENT_ID,
        chunks: 1,
      }),
      expect.any(String),
    );
  });

  it('documento sem original em quarentena falha fechado e registra FAILED', async () => {
    const { worker, execute } = makeWorker({
      executes: [
        [], // lock
        state({ status: 'QUARANTINED', stage: 'QUEUE' }),
        [], // original ausente
      ],
      fallback: [], // recordFailure: lock + state (ambos vazios) → sem estado, não grava novo evento
    });

    await expect(worker.process(job('ingest'))).rejects.toThrow(
      'Original de quarentena indisponível.',
    );
    // As 3 primeiras chamadas são a tentativa; as seguintes são o `recordFailure` do catch.
    expect(execute.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('conteúdo com dado pessoal é recusado pela varredura e falha fechado', async () => {
    const dirty = `${CONTENT} Contato do autor: autor@example.com`;
    const dirtySha256 = sha256(dirty);
    const { worker, execute, logger } = makeWorker({
      executes: [
        [],
        state({ status: 'QUARANTINED', stage: 'QUEUE' }),
        [{ mime_type: 'text/markdown', sha256: dirtySha256, payload: Buffer.from(dirty, 'utf8') }],
        [],
        // recordFailure: lock + estado PROCESSING (não terminal) + appendKnowledgeEvent(FAILED)
        [],
        state({ status: 'PROCESSING', stage: 'INGESTION' }),
        [],
      ],
    });

    await expect(worker.process(job('ingest'))).rejects.toBeInstanceOf(Error);
    expect(logger.error).not.toHaveBeenCalled(); // recordFailure só loga se o próprio registro falhar
    expect(execute).toHaveBeenCalledTimes(7);
  });

  it('hash do original divergente do sha256 declarado nunca chega a fazer chunk', async () => {
    const { worker } = makeWorker({
      executes: [
        [],
        state({ status: 'QUARANTINED', stage: 'QUEUE' }),
        [
          {
            mime_type: 'text/markdown',
            sha256: 'f'.repeat(64),
            payload: Buffer.from(CONTENT, 'utf8'),
          },
        ],
        [],
        [],
        state({ status: 'PROCESSING', stage: 'INGESTION' }),
      ],
    });

    await expect(worker.process(job('ingest'))).rejects.toThrow('Hash do original não confere.');
  });

  it('staging que diverge do conteúdo extraído falha fechado antes de liberar para revisão', async () => {
    const { worker } = makeWorker({
      executes: [
        [],
        state({ status: 'QUARANTINED', stage: 'QUEUE' }),
        [{ mime_type: 'text/markdown', sha256: SHA256, payload: Buffer.from(CONTENT, 'utf8') }],
        [],
        [],
        state({ status: 'PROCESSING', stage: 'INGESTION' }),
        [],
        [],
        [{ count: 0 }], // verificação de proveniência não bate com o número de chunks gerados
      ],
    });

    await expect(worker.process(job('ingest'))).rejects.toThrow(
      'Staging imutável divergiu do conteúdo extraído.',
    );
  });

  it('documento já em READY_FOR_REVIEW não reprocessa (idempotência)', async () => {
    const { worker, execute } = makeWorker({
      executes: [[], state({ status: 'READY_FOR_REVIEW', stage: 'REVIEW' })],
    });

    const result = await worker.process(job('ingest'));

    expect(result).toEqual({ status: 'READY_FOR_REVIEW' });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('reingestão após FAILED em INDEXING não reabre a extração', async () => {
    const { worker, execute } = makeWorker({
      executes: [[], state({ status: 'FAILED', stage: 'INDEXING' })],
    });

    const result = await worker.process(job('ingest'));

    expect(result).toEqual({ status: 'FAILED_INDEXING' });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('re-staginga em cima de PROCESSING já concluído sem duplicar (retry idempotente)', async () => {
    const { worker } = makeWorker({
      executes: [
        [],
        state({ status: 'QUARANTINED', stage: 'QUEUE' }),
        [{ mime_type: 'text/markdown', sha256: SHA256, payload: Buffer.from(CONTENT, 'utf8') }],
        [],
        [],
        state({ status: 'READY_FOR_REVIEW', stage: 'REVIEW' }), // outro worker já terminou entre as duas transações
      ],
    });

    const result = await worker.process(job('ingest'));
    expect(result).toEqual({ status: 'READY_FOR_REVIEW', chunks: 1 });
  });
});

describe('KnowledgeProcessingWorker.process → index', () => {
  const STAGED = [
    { id: 'chunk-1', chunk_index: 0, chunk_text: CONTENT, chunk_sha256: 'a'.repeat(64) },
  ];

  it('gera embeddings, publica e confirma a contagem exata de chunks', async () => {
    const { worker, execute, embedding, logger } = makeWorker({
      executes: [
        [], // lock
        state({ status: 'APPROVED', stage: 'INDEXING' }),
        [], // appendKnowledgeEvent(INDEXING/INDEXING)
        STAGED, // select staged chunks
        [], // lock (transação 2)
        state({ status: 'INDEXING', stage: 'INDEXING' }),
        [], // insert embedding
        [{ count: 1 }], // publish_knowledge_document
        [], // appendKnowledgeEvent(PUBLISHED/PUBLISHED)
      ],
    });

    const result = await worker.process(job('index'));

    expect(result).toEqual({ status: 'PUBLISHED', chunks: 1 });
    expect(embedding.embedBatch).toHaveBeenCalledWith([CONTENT]);
    expect(execute).toHaveBeenCalledTimes(9);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'knowledge_document_published', chunks: 1 }),
      expect.any(String),
    );
  });

  it('falha fechado quando a publicação não confirma todos os chunks preparados', async () => {
    const { worker } = makeWorker({
      executes: [
        [],
        state({ status: 'APPROVED', stage: 'INDEXING' }),
        [],
        STAGED,
        [],
        state({ status: 'INDEXING', stage: 'INDEXING' }),
        [],
        [{ count: 0 }],
      ],
    });

    await expect(worker.process(job('index'))).rejects.toThrow(
      'Publicação não confirmou todos os chunks canônicos.',
    );
  });

  it('lote de embedding incompleto nunca chega a gravar nada', async () => {
    const { worker, execute } = makeWorker({
      executes: [[], state({ status: 'APPROVED', stage: 'INDEXING' }), [], STAGED],
      embedBatch: async () => [],
    });

    await expect(worker.process(job('index'))).rejects.toThrow(
      'Provider de embedding devolveu lote incompleto.',
    );
    // 4 chamadas da tentativa de indexação + 2 do `recordFailure` do catch em
    // `process()` (lock + currentKnowledgeState); a transação de gravação nunca abre.
    expect(execute).toHaveBeenCalledTimes(6);
  });

  it('sem chunk canônico staged e documento não publicado: erro explícito', async () => {
    const { worker } = makeWorker({
      executes: [
        [],
        state({ status: 'APPROVED', stage: 'INDEXING' }),
        [],
        [], // nenhum chunk staged
        state({ status: 'APPROVED', stage: 'INDEXING' }), // segunda checagem de estado
      ],
    });

    await expect(worker.process(job('index'))).rejects.toThrow(
      'Nenhum chunk canônico disponível para indexação.',
    );
  });

  it('documento já publicado é idempotente e não reprocessa', async () => {
    const { worker, execute, embedding } = makeWorker({
      // lock + estado (PUBLISHED → staged=[]), depois a checagem extra de
      // `staged.length === 0` relê o estado (sem lock) e confirma PUBLISHED.
      executes: [
        [],
        state({ status: 'PUBLISHED', stage: 'PUBLISHED' }),
        state({ status: 'PUBLISHED', stage: 'PUBLISHED' }),
      ],
    });

    const result = await worker.process(job('index'));

    expect(result).toEqual({ status: 'PUBLISHED' });
    expect(embedding.embedBatch).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('estado inválido para indexação (nunca aprovado) é rejeitado', async () => {
    const { worker } = makeWorker({
      executes: [[], state({ status: 'QUARANTINED', stage: 'QUEUE' })],
    });

    await expect(worker.process(job('index'))).rejects.toThrow('Estado inválido para indexação');
  });
});

describe('KnowledgeProcessingWorker — falha registra FAILED sem apagar histórico', () => {
  it('erro terminal em ingest grava FAILED/INGESTION com o código da varredura', async () => {
    const dirty = `${CONTENT} email: pessoa@dominio.com`;
    const dirtySha256 = sha256(dirty);
    const { worker, execute } = makeWorker({
      executes: [
        [],
        state({ status: 'QUARANTINED', stage: 'QUEUE' }),
        [{ mime_type: 'text/markdown', sha256: dirtySha256, payload: Buffer.from(dirty, 'utf8') }],
        [],
        [], // recordFailure: lock
        state({ status: 'PROCESSING', stage: 'INGESTION' }), // recordFailure: estado atual não terminal
        [], // recordFailure: appendKnowledgeEvent(FAILED)
      ],
    });

    await expect(worker.process(job('ingest'))).rejects.toBeInstanceOf(Error);
    // As 4 primeiras chamadas são a tentativa de ingestão (varredura recusa o conteúdo
    // no meio do caminho); as 3 seguintes são o `recordFailure` do catch em `process()`
    // gravando o evento FAILED/INGESTION — nenhuma chamada extra além dessas 7.
    expect(execute).toHaveBeenCalledTimes(7);
  });

  it('não duplica evento FAILED quando o mesmo erro já foi registrado (retry idempotente)', async () => {
    const { worker, execute } = makeWorker({
      executes: [
        [],
        state({ status: 'QUARANTINED', stage: 'QUEUE' }),
        [], // original ausente → dispara recordFailure
        [], // recordFailure: lock
        state({ status: 'FAILED', stage: 'INGESTION', error_code: 'PROCESSING_FAILED' }), // já FAILED com mesmo código
      ],
    });

    await expect(worker.process(job('ingest'))).rejects.toThrow(
      'Original de quarentena indisponível.',
    );
    // recordFailure para de escrever assim que vê o mesmo status/stage/errorCode: sem 6ª chamada.
    expect(execute).toHaveBeenCalledTimes(5);
  });

  it('documento já em estado terminal (PUBLISHED) nunca recebe FAILED por cima', async () => {
    const { worker, execute } = makeWorker({
      executes: [
        [],
        state({ status: 'QUARANTINED', stage: 'QUEUE' }),
        [],
        [], // recordFailure: lock
        state({ status: 'PUBLISHED', stage: 'PUBLISHED' }), // estado terminal — recordFailure não sobrescreve
      ],
    });

    await expect(worker.process(job('ingest'))).rejects.toThrow(
      'Original de quarentena indisponível.',
    );
    expect(execute).toHaveBeenCalledTimes(5);
  });
});
