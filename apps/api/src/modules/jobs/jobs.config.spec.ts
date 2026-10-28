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
        // Fim do período pago sem renovação (ACTIVE → EXPIRED).
        'subscription-period-scan',
        'knowledge-processing',
        'dead-letter',
        // Fila do profissional, categoria "Disponível para Revisão" — liberação automática
        // após a janela de cortesia de 1h.
        'protocol-auto-release',
        // Liberação automática da proposta de substituição de exercício via IA, após a
        // janela de cortesia de 30 min (achado 2026-09-02).
        'protocol-substitution-release',
        'sanity',
        // Espelho da aba "Conversas": baixa a mídia e confirma a mensagem digitada no celular.
        'whatsapp-mirror',
        'whatsapp-outbound',
        'workout-daily',
        // Link diário v2 (qualquer modalidade).
        'training-daily',
        // Comentário do Coach sobre o treino registrado no diário (achado 2026-09-12).
        'workout-feedback',
        // Versão nova do protocolo: atualiza o treino de hoje e oferece o link novo (2026-10-20).
        'workout-protocol-changed',
        // Comentário do Coach sobre o check-in semanal (achado 2026-09-13).
        'checkin-weekly-feedback',
        // Outbox de eventos de domínio: relé + despacho aos consumidores.
        'outbox-relay',
        'domain-events',
        // Geração do plano integrado depois do onboarding.
        'plan-generation',
      ].sort(),
    );
  });

  it('mantém os parâmetros fixos de §6 (concorrência, lock, retries, backoff, rate)', () => {
    expect(QUEUE_REGISTRY[QUEUE.planGeneration]).toMatchObject({
      attempts: 3,
      backoffMs: [10_000, 60_000, 300_000],
      concurrency: 3,
      lockMs: 600_000,
    });
    expect(QUEUE_REGISTRY[QUEUE.aiResponse].rateLimit).toEqual({ max: 80, durationMs: 1_000 });
    expect(QUEUE_REGISTRY[QUEUE.whatsappOutbound]).toMatchObject({ attempts: 5, concurrency: 10 });
  });

  it('resolveJobOptions aplica attempts da fila e limpeza central', () => {
    const opts = resolveJobOptions(QUEUE.planGeneration);
    expect(opts.attempts).toBe(3);
    expect(opts.backoff).toEqual({ type: 'custom' });
    expect(opts.removeOnComplete.count).toBeGreaterThan(0);
    expect(opts.removeOnFail.count).toBeGreaterThan(0);
  });

  it('backoffDelay devolve o atraso da tentativa e satura no último', () => {
    expect(backoffDelay(QUEUE.planGeneration, 1)).toBe(10_000);
    expect(backoffDelay(QUEUE.planGeneration, 2)).toBe(60_000);
    expect(backoffDelay(QUEUE.planGeneration, 9)).toBe(300_000); // satura
    expect(backoffDelay(QUEUE.conversionSequence, 1)).toBe(5_000);
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
