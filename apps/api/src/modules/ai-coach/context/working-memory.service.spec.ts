import { describe, expect, it } from 'vitest';

import { RedisKeyBuilder } from '../../../core/redis/redis-key.util';
import { WorkingMemory } from './working-memory.service';

/** Fake Redis com semântica real de LIST (rpush/ltrim/lrange/llen) para a working memory. */
function fakeRedis() {
  const lists = new Map<string, string[]>();
  const chainOps: Array<() => void> = [];
  const redis = {
    lists,
    multi() {
      chainOps.length = 0;
      const chain = {
        rpush(k: string, v: string) {
          chainOps.push(() => {
            const a = lists.get(k) ?? [];
            a.push(v);
            lists.set(k, a);
          });
          return chain;
        },
        ltrim(k: string, start: number) {
          chainOps.push(() => lists.set(k, (lists.get(k) ?? []).slice(start)));
          return chain;
        },
        expire() {
          chainOps.push(() => undefined);
          return chain;
        },
        exec: () => {
          chainOps.forEach((f) => f());
          return Promise.resolve([]);
        },
      };
      return chain;
    },
    lrange: (k: string, start: number) => Promise.resolve((lists.get(k) ?? []).slice(start)),
    llen: (k: string) => Promise.resolve((lists.get(k) ?? []).length),
  };
  return redis;
}

function make() {
  const redis = fakeRedis();
  const keys = new RedisKeyBuilder('movivo');
  const wm = new WorkingMemory(redis as never, keys);
  return { wm, redis, keys };
}

const DATE = '2026-07-30';
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

describe('WorkingMemory', () => {
  it('grava e recupera um turno na janela', async () => {
    const { wm } = make();
    await wm.append(U1, DATE, { role: 'user', content: 'oi', ts: 1 });
    const recent = await wm.recent(U1, DATE);
    expect(recent).toEqual([{ role: 'user', content: 'oi', ts: 1 }]);
  });

  it('mantém só as últimas 15 mensagens', async () => {
    const { wm } = make();
    for (let i = 0; i < 20; i++) {
      await wm.append(U1, DATE, { role: 'user', content: `m${i}`, ts: i });
    }
    const recent = await wm.recent(U1, DATE);
    expect(recent).toHaveLength(15);
    expect(recent[0]?.content).toBe('m5'); // as 5 mais antigas caíram
    expect(await wm.count(U1, DATE)).toBe(15);
  });

  it('isola a sessão por usuário (namespacing)', async () => {
    const { wm } = make();
    await wm.append(U1, DATE, { role: 'user', content: 'segredo do u1', ts: 1 });
    expect(await wm.recent(U2, DATE)).toEqual([]);
  });

  it('ignora turno corrompido sem derrubar a leitura', async () => {
    const { wm, redis, keys } = make();
    await wm.append(U1, DATE, { role: 'user', content: 'ok', ts: 1 });
    redis.lists.get(keys.forUser(U1, 'session', DATE))?.push('{json quebrado');
    const recent = await wm.recent(U1, DATE);
    expect(recent).toHaveLength(1); // o turno bom sobrevive; o corrompido é ignorado
  });
});
