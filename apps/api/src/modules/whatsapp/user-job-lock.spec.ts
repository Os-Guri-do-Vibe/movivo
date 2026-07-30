/**
 * Unit — `UserJobLock` (US-3.1.2). Prova que só um job por usuário roda por vez:
 * segunda aquisição falha enquanto o lock existe; após release, readquire; compare-and-del
 * não deixa uma execução apagar o lock de outra.
 */
import { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';

import { RedisKeyBuilder } from '../../core/redis/redis-key.util';
import { UserJobLock } from './user-job-lock';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

/** Fake Redis mínimo: `SET ... NX` e o `eval` de compare-and-del do release. */
function fakeRedis(): Redis {
  const store = new Map<string, string>();
  return {
    async set(key: string, value: string, ..._rest: unknown[]) {
      if (store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    },
    async eval(_script: string, _numKeys: number, key: string, token: string) {
      if (store.get(key) === token) {
        store.delete(key);
        return 1;
      }
      return 0;
    },
  } as unknown as Redis;
}

function makeLock(): UserJobLock {
  return new UserJobLock(fakeRedis(), new RedisKeyBuilder('movivo'));
}

describe('UserJobLock', () => {
  it('impede aquisição paralela do mesmo usuário', async () => {
    const lock = makeLock();
    const first = await lock.acquire(USER_A);
    expect(first).not.toBeNull();
    expect(await lock.acquire(USER_A)).toBeNull();
  });

  it('readquire após release', async () => {
    const lock = makeLock();
    const token = await lock.acquire(USER_A);
    expect(token).not.toBeNull();
    await lock.release(USER_A, token as string);
    expect(await lock.acquire(USER_A)).not.toBeNull();
  });

  it('não libera o lock de outra execução (token diferente)', async () => {
    const lock = makeLock();
    await lock.acquire(USER_A);
    await lock.release(USER_A, 'token-errado');
    expect(await lock.acquire(USER_A)).toBeNull(); // continua travado
  });

  it('locks de usuários distintos são independentes', async () => {
    const lock = makeLock();
    expect(await lock.acquire(USER_A)).not.toBeNull();
    expect(await lock.acquire(USER_B)).not.toBeNull();
  });
});
