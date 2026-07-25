/**
 * Isolamento multi-tenant no Redis (US-1.8 / TASK-1.8.2c) — agora BLOQUEANTE.
 *
 * No Redis não há RLS: a única barreira entre titulares é o namespacing por `user_id`
 * do `RedisKeyBuilder` (Sprint 0). O unit `redis-key.util.spec.ts` prova a lógica da
 * chave; ESTE teste prova a propriedade ponta a ponta contra o Redis REAL (via Sentinel,
 * com o cliente do DI): o valor escrito no namespace de A não é alcançável pelo namespace
 * de B, e o SCAN de A só devolve as chaves de A. A asserção negativa (B lê null; o SCAN
 * de A não traz a chave de B) FALHA o pipeline se o namespacing regredir.
 *
 * Pré-requisito: `pnpm run infra:up` (Redis master/replica + Sentinel).
 */
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppConfigService, getAppConfig } from '../src/core/config';
import { buildRedisOptions } from '../src/core/redis/redis.module';
import { RedisKeyBuilder } from '../src/core/redis/redis-key.util';

// Cliente Redis direto (como o postgres em security-foundation) — evita subir o
// AppModule/JobsModule, cujos workers BullMQ geravam "Connection is closed" no
// teardown e derrubavam o fork único da integração. Reusa a MESMA config de runtime.

const RUN = Date.now().toString().slice(-8);
// UUIDs fixos e válidos (o builder exige UUID) — dois titulares distintos.
const USER_A = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const USER_B = 'a1b2c3d4-e5f6-4718-9a0b-1c2d3e4f5061';
const SEGMENT = `it-${RUN}`; // isola este run de qualquer outra chave no Redis compartilhado

const config = new AppConfigService(getAppConfig());
const redis = new Redis(buildRedisOptions(config));
const keys = new RedisKeyBuilder(config.redis.keyPrefix);

beforeAll(async () => {
  await redis.ping(); // garante conexão pronta antes das asserções
}, 60_000);

afterAll(async () => {
  // Limpa só as chaves deste run (nunca um FLUSHDB — o Redis é compartilhado com o BullMQ).
  const mine = await redis.keys(`*:${SEGMENT}`);
  if (mine.length > 0) await redis.del(...mine);
  await redis.quit(); // fecha o cliente ioredis (lição: fechar conexões no afterAll)
});

describe('Redis — namespacing por user_id isola titulares (TASK-1.8.2c)', () => {
  it('o valor de A não é legível pelo namespace de B', async () => {
    const keyA = keys.forUser(USER_A, SEGMENT);
    const keyB = keys.forUser(USER_B, SEGMENT);
    expect(keyA).not.toBe(keyB); // chaves fisicamente distintas

    await redis.set(keyA, 'segredo-de-A');

    // B, montando a chave do MESMO segmento, cai numa chave própria — vazia.
    expect(await redis.get(keyB)).toBeNull();
    // A lê o próprio valor.
    expect(await redis.get(keyA)).toBe('segredo-de-A');
  });

  it('o SCAN do padrão de A traz a chave de A e NUNCA a de B', async () => {
    const keyA = keys.forUser(USER_A, SEGMENT);
    const keyB = keys.forUser(USER_B, SEGMENT);
    await redis.set(keyA, '1');
    await redis.set(keyB, '1');

    const found = await scanAll(redis, keys.userScanPattern(USER_A));
    expect(found).toContain(keyA);
    expect(found).not.toContain(keyB); // o vazamento cross-tenant, se existisse, falharia aqui
  });
});

/** Varre todas as chaves de um padrão (SCAN não-bloqueante, como o código de produção). */
async function scanAll(client: Redis, pattern: string): Promise<string[]> {
  const out: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    out.push(...batch);
    cursor = next;
  } while (cursor !== '0');
  return out;
}
