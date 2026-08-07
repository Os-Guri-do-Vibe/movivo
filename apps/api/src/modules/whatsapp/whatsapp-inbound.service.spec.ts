/**
 * Unit — `WhatsappInboundService` (US-3.1). Prova, com fakes:
 *   · payload forjado (HMAC inválido) → descartado, sem enfileirar;
 *   · sem segredo (fail-closed) → descartado;
 *   · replay (mesmo messageId) → descartado no nonce;
 *   · remetente desconhecido → descartado;
 *   · rajada de 3 mensagens do mesmo usuário → 1 job (debounce coalesce);
 *   · job enfileirado carrega o contrato de US-3.5 (userId, batchKey, enqueuedAt) sem PII.
 */
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppConfigService } from '../../core/config';
import { HealthConsentService } from '../../core/database/health-consent.service';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { DomainEventBus } from '../../core/event-bus/event-bus.service';
import { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
import { RedisKeyBuilder } from '../../core/redis/redis-key.util';
import { QueueManager } from '../jobs/queue-manager.service';
import { signWebhookBody } from './webhook-signature';
import { type AiResponseJob, WhatsappInboundService } from './whatsapp-inbound.service';

const SECRET = 'unit-webhook-secret';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const PHONE = '+5541999998888';

/** Fake Redis: SET (com/sem NX), RPUSH, EXPIRE em memória. */
function fakeRedis(): { redis: Redis; rpush: ReturnType<typeof vi.fn> } {
  const kv = new Map<string, string>();
  const rpush = vi.fn(async () => 1);
  const redis = {
    async set(key: string, value: string, ...args: unknown[]) {
      if (args.includes('NX') && kv.has(key)) return null;
      kv.set(key, value);
      return 'OK';
    },
    rpush,
    async expire() {
      return 1;
    },
    async incr(key: string) {
      const n = Number(kv.get(key) ?? '0') + 1;
      kv.set(key, String(n));
      return n;
    },
    async get(key: string) {
      return kv.get(key) ?? null;
    },
    async del(key: string) {
      return kv.delete(key) ? 1 : 0;
    },
  } as unknown as Redis;
  return { redis, rpush };
}

function makeService(
  opts: {
    secret?: string;
    userRows?: Array<{ id: string }>;
    consentActive?: boolean;
    checkinHandled?: boolean;
  } = {},
) {
  const { redis, rpush } = fakeRedis();
  const enqueue = vi.fn(async () => 'job-1');
  const queues = { enqueue } as unknown as QueueManager;
  const db = {
    runAsSystem: vi.fn(async () => opts.userRows ?? [{ id: USER_ID }]),
  } as unknown as TenantDatabase;
  const config = {
    get whatsapp() {
      return { webhookSecret: 'secret' in opts ? opts.secret : SECRET };
    },
  } as unknown as AppConfigService;
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;
  const hasActiveForUser = vi.fn(async () => opts.consentActive ?? true);
  const revokeForUser = vi.fn(async () => true);
  const healthConsent = {
    hasActiveForUser,
    revokeForUser,
  } as unknown as HealthConsentService;
  const events = {
    request: vi.fn(async () => opts.checkinHandled ?? false),
  } as unknown as DomainEventBus;
  const service = new WhatsappInboundService(
    redis,
    new RedisKeyBuilder('movivo'),
    db,
    queues,
    healthConsent,
    events,
    { emit: vi.fn() } as unknown as DashboardQueueEventsService,
    config,
    logger,
  );
  return { service, enqueue, rpush, hasActiveForUser, revokeForUser, events };
}

function signed(payload: object, secret = SECRET) {
  const raw = Buffer.from(JSON.stringify(payload), 'utf8');
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    rawBody: raw,
    body: payload,
    signature: signWebhookBody(secret, timestamp, raw),
    timestamp,
  };
}

const payload = (over: Partial<{ messageId: string; from: string; text: string }> = {}) => ({
  messageId: over.messageId ?? 'msg-1',
  from: over.from ?? PHONE,
  text: over.text ?? 'oi movi',
});

describe('WhatsappInboundService.ingest', () => {
  let enqueue: ReturnType<typeof vi.fn>;
  let rpush: ReturnType<typeof vi.fn>;
  let service: WhatsappInboundService;

  beforeEach(() => {
    ({ service, enqueue, rpush } = makeService());
  });

  it('enfileira 1 job com o contrato de US-3.5 para um payload válido', async () => {
    const s = signed(payload());
    await service.ingest({ ...s, correlationId: 'c1' });
    expect(enqueue).toHaveBeenCalledTimes(1);
    const [, jobName, job, overrides] = enqueue.mock.calls[0] as [
      string,
      string,
      AiResponseJob,
      { delay: number },
    ];
    expect(jobName).toBe('coach-response');
    expect(job.userId).toBe(USER_ID);
    expect(job.batchKey).toContain(USER_ID.toLowerCase());
    expect(job).not.toHaveProperty('text'); // nenhum PII no job
    expect(job.enqueuedAt).toBeGreaterThan(0);
    expect(overrides.delay).toBe(3_000);
  });

  it('descarta payload com HMAC inválido (forjado) sem enfileirar', async () => {
    const s = signed(payload());
    await service.ingest({ ...s, signature: 'deadbeef', correlationId: 'c2' });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('fail-closed: sem segredo configurado, descarta', async () => {
    ({ service, enqueue } = makeService({ secret: undefined }));
    const s = signed(payload());
    await service.ingest({ ...s, correlationId: 'c3' });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('descarta replay: mesmo messageId enfileira só uma vez', async () => {
    const s = signed(payload({ messageId: 'dup' }));
    await service.ingest({ ...s, correlationId: 'c4' });
    await service.ingest({ ...s, correlationId: 'c4' });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('descarta remetente desconhecido (sem usuário)', async () => {
    ({ service, enqueue } = makeService({ userRows: [] }));
    const s = signed(payload());
    await service.ingest({ ...s, correlationId: 'c5' });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('debounce: rajada de 3 mensagens do mesmo usuário vira 1 job (3 no buffer)', async () => {
    for (let i = 1; i <= 3; i += 1) {
      const s = signed(payload({ messageId: `burst-${i}`, text: `parte ${i}` }));
      await service.ingest({ ...s, correlationId: 'c6' });
    }
    expect(rpush).toHaveBeenCalledTimes(3);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('revoga HEALTH_DATA somente com a frase explicita e confirma cessacao', async () => {
    const created = makeService();
    const s = signed(payload({ text: 'Revogar consentimento de saude.' }));
    await created.service.ingest({ ...s, correlationId: 'revoke' });
    expect(created.revokeForUser).toHaveBeenCalledWith(USER_ID);
    expect(created.hasActiveForUser).not.toHaveBeenCalled();
    expect(created.enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'health-consent-revoked',
      expect.objectContaining({ type: 'CONSENT_STATUS' }),
      expect.any(Object),
    );
    expect(created.rpush).not.toHaveBeenCalled();
  });

  it('nao revoga por frase aproximada', async () => {
    const created = makeService();
    const s = signed(payload({ text: 'quero revogar depois' }));
    await created.service.ingest({ ...s, correlationId: 'near-revoke' });
    expect(created.revokeForUser).not.toHaveBeenCalled();
    expect(created.rpush).toHaveBeenCalledOnce();
  });

  it('recusa qualquer novo tratamento quando HEALTH_DATA nao esta ativo', async () => {
    const created = makeService({ consentActive: false });
    const s = signed(payload({ text: 'quero falar do treino' }));
    await created.service.ingest({ ...s, correlationId: 'no-consent' });
    expect(created.enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'health-consent-inactive',
      expect.objectContaining({ type: 'CONSENT_STATUS' }),
      expect.any(Object),
    );
    expect(created.rpush).not.toHaveBeenCalled();
    expect(created.events.request).not.toHaveBeenCalled();
  });

  it('roteia check-in pelo barramento sem importar o dominio e nao chama o Coach', async () => {
    const created = makeService({ checkinHandled: true });
    const s = signed(payload({ text: 'dor no quadril' }));
    await created.service.ingest({ ...s, correlationId: 'checkin' });
    expect(created.events.request).toHaveBeenCalledOnce();
    expect(created.rpush).not.toHaveBeenCalled();
    expect(created.enqueue).not.toHaveBeenCalled();
  });
});
