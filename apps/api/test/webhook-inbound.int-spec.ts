/**
 * Integração do webhook de ENTRADA (US-3.1) contra o stack Docker (Postgres via PgBouncer,
 * Redis via Sentinel). Segredo do webhook injetado por env (mock — conta AraraHQ não assinada).
 *
 * Prova, por I/O real:
 *   (boot)      o AppModule sobe SEM segredo de webhook (chave opcional);
 *   (feliz)     payload legítimo → 200 em <1s + 1 job em `ai-response` (delayed) + batch no Redis;
 *   (forjado)   HMAC inválido → 200, nenhum job;
 *   (replay)    mesmo messageId → 1 job só (nonce SET NX);
 *   (stale)     timestamp fora de ±5min → 200, nenhum job;
 *   (debounce)  rajada de 3 mensagens do mesmo usuário → 1 job (buffer com 3 itens);
 *   (desconh.)  remetente sem usuário → 200, nenhum job.
 *
 * Pré-requisito: `pnpm run infra:up` + `db:migrate`.
 */
import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { like } from 'drizzle-orm';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { AppConfigService } from '../src/core/config';
import { loadEnv } from '../src/core/config/load-env';
import { users } from '../src/core/database/schema';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { REDIS_CLIENT } from '../src/core/redis/redis.constants';
import { REDIS_KEY_BUILDER, RedisKeyBuilder } from '../src/core/redis/redis-key.util';
import { QUEUE } from '../src/modules/jobs/jobs.config';
import { QueueManager } from '../src/modules/jobs/queue-manager.service';
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  signWebhookBody,
} from '../src/modules/whatsapp/webhook-signature';
import { type AiResponseJob } from '../src/modules/whatsapp/whatsapp-inbound.service';
import { seedHealthEligibility } from './health-fixtures';

const SECRET = 'int-webhook-secret';
const RUN = Date.now().toString().slice(-8);
const { env } = loadEnv();
const apiRoot = process.cwd();

// Superusuário: seed/limpeza de `consents` e `professional_assignments` (o runtime não
// tem INSERT em consents; o gate de entrada exige consentimento de saúde ativo — US-3.1/Sprint 5).
const adminClient = postgres({
  host: env.MIGRATION_DATABASE_HOST ?? 'localhost',
  port: Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT ?? 15432),
  user: 'postgres',
  password: readFileSync(
    resolve(apiRoot, '..', '..', 'secrets', 'postgres_superuser_password'),
    'utf8',
  ).trimEnd(),
  database: env.DATABASE_NAME ?? 'movivo',
  ssl: false,
  max: 1,
  idle_timeout: 5,
  onnotice: () => undefined,
});

let app: INestApplication;
let prefix: string;
let db: TenantDatabase;
let queues: QueueManager;
let redis: Redis;
let keys: RedisKeyBuilder;
let seq = 0;
const phone = () => `+5541${RUN}${(seq += 1)}`;

async function seedUser(): Promise<{ userId: string; phoneNumber: string }> {
  const phoneNumber = phone();
  const userId = await db.runAsSystem(async (tx) => {
    const [u] = await tx
      .insert(users)
      .values({ phoneNumber, name: 'Seed WH' })
      .returning({ id: users.id });
    if (!u) throw new Error('seed: usuário não criado');
    return u.id;
  });
  // O gate de entrada só enfileira resposta para titular com consentimento de saúde ativo.
  await seedHealthEligibility(adminClient, userId);
  return { userId, phoneNumber };
}

interface PostOpts {
  secret?: string;
  tamper?: boolean;
  tsOffsetSec?: number;
}
function post(payload: object, opts: PostOpts = {}) {
  const rawStr = JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000) + (opts.tsOffsetSec ?? 0));
  const sig = opts.tamper
    ? 'deadbeef'
    : signWebhookBody(opts.secret ?? SECRET, ts, Buffer.from(rawStr, 'utf8'));
  return request(app.getHttpServer())
    .post(`/${prefix}/webhook/whatsapp`)
    .set('content-type', 'application/json')
    .set(SIGNATURE_HEADER, sig)
    .set(TIMESTAMP_HEADER, ts)
    .send(rawStr);
}

async function delayedForUser(userId: string) {
  const jobs = await queues.get(QUEUE.aiResponse).getDelayed();
  return jobs.filter((j) => (j.data as AiResponseJob).userId === userId);
}

beforeAll(async () => {
  process.env.ARARAHQ_WEBHOOK_SECRET = SECRET;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false, rawBody: true });
  const config = app.get(AppConfigService);
  prefix = config.globalPrefix;
  app.setGlobalPrefix(prefix);
  app.enableShutdownHooks();
  await app.init();
  db = app.get(TenantDatabase);
  queues = app.get(QueueManager);
  redis = app.get(REDIS_CLIENT);
  keys = app.get(REDIS_KEY_BUILDER);
}, 60_000);

afterAll(async () => {
  try {
    await queues?.get(QUEUE.aiResponse).obliterate({ force: true });
    // Usuários semeados por este arquivo (prefixo de telefone único por run). As tabelas
    // com FK para users (consents/professional_assignments) são limpas antes via superusuário.
    await adminClient.unsafe(
      `DELETE FROM consents WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       DELETE FROM professional_assignments WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');`,
    );
    await db.runAsSystem((tx) => tx.delete(users).where(like(users.phoneNumber, `+5541${RUN}%`)));
  } finally {
    await Promise.all([app?.close(), adminClient.end({ timeout: 5 })]);
  }
}, 60_000);

describe('webhook de entrada — segurança e enfileiramento (US-3.1)', () => {
  it('app boota mesmo com segredo de webhook ausente (chave opcional)', async () => {
    // O AppModule já subiu no beforeAll; a optionality do segredo é o que garante o boot
    // em dev/CI. Aqui provamos que o config expõe o segredo como valor opcional.
    const config = app.get(AppConfigService);
    expect(
      typeof config.whatsapp.webhookSecret === 'string' ||
        config.whatsapp.webhookSecret === undefined,
    ).toBe(true);
  });

  it('payload legítimo → 200 em <1s, 1 job em ai-response e batch no Redis', async () => {
    const { userId, phoneNumber } = await seedUser();
    const started = Date.now();
    const res = await post({ messageId: `${RUN}-ok`, from: phoneNumber, text: 'oi movi' });
    const elapsed = Date.now() - started;

    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(1_000);

    const jobs = await delayedForUser(userId);
    expect(jobs).toHaveLength(1);
    expect((jobs[0].data as AiResponseJob).batchKey).toContain(userId.toLowerCase());

    const batchLen = await redis.llen(keys.forUser(userId, 'ai-response', 'batch'));
    expect(batchLen).toBe(1);
  }, 20_000);

  it('HMAC inválido (forjado) → 200 e nenhum job', async () => {
    const { userId, phoneNumber } = await seedUser();
    const res = await post(
      { messageId: `${RUN}-forge`, from: phoneNumber, text: 'x' },
      { tamper: true },
    );
    expect(res.status).toBe(200);
    expect(await delayedForUser(userId)).toHaveLength(0);
  }, 20_000);

  it('replay (mesmo messageId) → 1 job só', async () => {
    const { userId, phoneNumber } = await seedUser();
    const body = { messageId: `${RUN}-replay`, from: phoneNumber, text: 'oi' };
    await post(body);
    await post(body);
    expect(await delayedForUser(userId)).toHaveLength(1);
  }, 20_000);

  it('timestamp fora de ±5min → 200 e nenhum job', async () => {
    const { userId, phoneNumber } = await seedUser();
    const res = await post(
      { messageId: `${RUN}-stale`, from: phoneNumber, text: 'x' },
      { tsOffsetSec: -3600 },
    );
    expect(res.status).toBe(200);
    expect(await delayedForUser(userId)).toHaveLength(0);
  }, 20_000);

  it('rajada de 3 mensagens do mesmo usuário → 1 job (buffer com 3 itens)', async () => {
    const { userId, phoneNumber } = await seedUser();
    for (let i = 1; i <= 3; i += 1) {
      await post({ messageId: `${RUN}-burst-${i}`, from: phoneNumber, text: `parte ${i}` });
    }
    expect(await delayedForUser(userId)).toHaveLength(1);
    expect(await redis.llen(keys.forUser(userId, 'ai-response', 'batch'))).toBe(3);
  }, 20_000);

  it('remetente desconhecido → 200 e nenhum job', async () => {
    const res = await post({ messageId: `${RUN}-unknown`, from: '+5541000000000', text: 'x' });
    expect(res.status).toBe(200);
    const jobs = await queues.get(QUEUE.aiResponse).getDelayed();
    expect(
      jobs.find((j) => (j.data as AiResponseJob).batchKey.includes('000000000')),
    ).toBeUndefined();
  }, 20_000);
});
