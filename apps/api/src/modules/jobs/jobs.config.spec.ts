import { describe, expect, it, vi } from 'vitest';

import {
  backoffDelay,
  buildBullConnection,
  bullPrefix,
  QUEUE,
  QUEUE_REGISTRY,
  resolveJobOptions,
} from './jobs.config';

vi.mock('../../core/redis', () => ({
  buildRedisOptions: () => ({ sentinels: [{ host: 'h', port: 1 }], maxRetriesPerRequest: 3 }),
}));

const config = { redis: { keyPrefix: 'movivo' } } as never;

describe('jobs.config', () => {
  it('registra as filas de negócio de §6 mais sanity e dead-letter', () => {
    expect(Object.keys(QUEUE_REGISTRY).sort()).toEqual(
      [
        'ai-response',
        'checkin-weekly',
        'conversion-sequence',
        // US-8.5 — conciliacao da liquidacao do gateway.
        'payment-reconciliation',
        'knowledge-processing',
        'dead-letter',
        'protocol-generation',
        // Fila do profissional, categoria "Disponível para Revisão" — liberação automática
        // após a janela de cortesia de 1h.
        'protocol-auto-release',
        'sanity',
        'whatsapp-outbound',
        // US-8.1 — quick reply diário de treino.
        'workout-daily',
      ].sort(),
    );
  });

  it('mantém os parâmetros fixos de §6 (concorrência, lock, retries, backoff, rate)', () => {
    expect(QUEUE_REGISTRY[QUEUE.protocolGeneration]).toMatchObject({
      attempts: 3,
      backoffMs: [2_000, 8_000, 32_000],
      concurrency: 5,
      lockMs: 120_000,
    });
    expect(QUEUE_REGISTRY[QUEUE.aiResponse].rateLimit).toEqual({ max: 80, durationMs: 1_000 });
    expect(QUEUE_REGISTRY[QUEUE.whatsappOutbound]).toMatchObject({ attempts: 5, concurrency: 10 });
  });

  it('resolveJobOptions aplica attempts da fila e limpeza central', () => {
    const opts = resolveJobOptions(QUEUE.protocolGeneration);
    expect(opts.attempts).toBe(3);
    expect(opts.backoff).toEqual({ type: 'custom' });
    expect(opts.removeOnComplete.count).toBeGreaterThan(0);
    expect(opts.removeOnFail.count).toBeGreaterThan(0);
  });

  it('backoffDelay devolve o atraso da tentativa e satura no último', () => {
    expect(backoffDelay(QUEUE.protocolGeneration, 1)).toBe(2_000);
    expect(backoffDelay(QUEUE.protocolGeneration, 2)).toBe(8_000);
    expect(backoffDelay(QUEUE.protocolGeneration, 9)).toBe(32_000); // satura
    expect(backoffDelay(QUEUE.conversionSequence, 1)).toBe(0); // sem backoff
  });

  it('buildBullConnection reusa a descoberta via Sentinel e força maxRetriesPerRequest null', () => {
    const conn = buildBullConnection(config);
    expect(conn.sentinels).toEqual([{ host: 'h', port: 1 }]);
    expect(conn.maxRetriesPerRequest).toBeNull();
  });

  it('bullPrefix é namespaced pelo REDIS_KEY_PREFIX', () => {
    expect(bullPrefix(config)).toBe('movivo:bull');
  });
});
