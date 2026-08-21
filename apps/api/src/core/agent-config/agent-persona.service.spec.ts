import { DEFAULT_AGENT_PERSONA, type AgentPersona } from '@movivo/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RedisKeyBuilder } from '../redis/redis-key.util';
import { AgentConfigRepository } from './agent-config.repository';
import { AgentPersonaService } from './agent-persona.service';

const VALID_PERSONA: AgentPersona = {
  ...DEFAULT_AGENT_PERSONA,
  agentName: 'Nina',
  agentSelfIntro: 'a coach digital da MOVIVO, supervisionada por um profissional CREF',
  toneDescriptors: ['direto'],
  emojiPolicy: 'RARO',
};

function make(overrides?: {
  redisGet?: () => Promise<string | null>;
  repoActivePayload?: () => Promise<{ version: number; payload: unknown } | null>;
}) {
  const subscriber = {
    subscribe: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    quit: vi.fn(() => Promise.resolve()),
  };
  const redis = {
    get: vi.fn(overrides?.redisGet ?? (() => Promise.resolve(null))),
    duplicate: vi.fn(() => subscriber),
  };
  const repo = {
    activePayload: vi.fn(overrides?.repoActivePayload ?? (() => Promise.resolve(null))),
  } as unknown as AgentConfigRepository;
  const logger = { setContext: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const svc = new AgentPersonaService(
    repo,
    redis as never,
    new RedisKeyBuilder('movivo'),
    logger as never,
  );
  return { svc, redis, repo, subscriber, logger };
}

describe('AgentPersonaService', () => {
  beforeEach(() => vi.useRealTimers());

  it('sem config publicada (Redis e banco vazios), cai para o default de código', async () => {
    const { svc } = make();
    expect(await svc.persona()).toEqual(DEFAULT_AGENT_PERSONA);
    expect(await svc.agentName()).toBe(DEFAULT_AGENT_PERSONA.agentName);
  });

  it('lê o snapshot do Redis quando presente e válido', async () => {
    const { svc, repo } = make({
      redisGet: () => Promise.resolve(JSON.stringify(VALID_PERSONA)),
    });
    expect(await svc.persona()).toEqual(VALID_PERSONA);
    // Redis respondeu: o banco nem precisa ser consultado.
    expect(repo.activePayload).not.toHaveBeenCalled();
  });

  it('Redis fora do ar cai para o banco', async () => {
    const { svc } = make({
      redisGet: () => Promise.reject(new Error('ECONNREFUSED')),
      repoActivePayload: () => Promise.resolve({ version: 3, payload: VALID_PERSONA }),
    });
    expect(await svc.persona()).toEqual(VALID_PERSONA);
  });

  it('Redis e banco fora do ar: fail-safe nunca é "sem guardrail" — devolve o default', async () => {
    const { svc, logger } = make({
      redisGet: () => Promise.reject(new Error('ECONNREFUSED')),
      repoActivePayload: () => Promise.reject(new Error('banco indisponível')),
    });
    expect(await svc.persona()).toEqual(DEFAULT_AGENT_PERSONA);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'agent_config_fallback' }),
      expect.any(String),
    );
  });

  it('payload inválido no Redis é ignorado e cai para o banco', async () => {
    const { svc } = make({
      redisGet: () => Promise.resolve(JSON.stringify({ agentName: '123' })),
      repoActivePayload: () => Promise.resolve({ version: 1, payload: VALID_PERSONA }),
    });
    expect(await svc.persona()).toEqual(VALID_PERSONA);
  });

  it('payload inválido no banco cai para o default', async () => {
    const { svc } = make({
      repoActivePayload: () => Promise.resolve({ version: 1, payload: { agentName: 'X' } }),
    });
    expect(await svc.persona()).toEqual(DEFAULT_AGENT_PERSONA);
  });

  it('nenhuma linha publicada (`activePayload` null) cai para o default', async () => {
    const { svc } = make({ repoActivePayload: () => Promise.resolve(null) });
    expect(await svc.persona()).toEqual(DEFAULT_AGENT_PERSONA);
  });

  it('resultado é cacheado em memória: uma segunda chamada não bate no Redis de novo', async () => {
    const { svc, redis } = make({
      redisGet: () => Promise.resolve(JSON.stringify(VALID_PERSONA)),
    });
    await svc.persona();
    await svc.persona();
    expect(redis.get).toHaveBeenCalledTimes(1);
  });

  it('invalidate() limpa o cache e força nova leitura', async () => {
    let call = 0;
    const { svc, redis } = make({
      redisGet: () => {
        call += 1;
        return Promise.resolve(
          call === 1 ? JSON.stringify(VALID_PERSONA) : JSON.stringify(DEFAULT_AGENT_PERSONA),
        );
      },
    });
    expect(await svc.persona()).toEqual(VALID_PERSONA);
    svc.invalidate();
    expect(await svc.persona()).toEqual(DEFAULT_AGENT_PERSONA);
    expect(redis.get).toHaveBeenCalledTimes(2);
  });

  it('onModuleInit assina o canal de invalidação; mensagem recebida limpa o cache', async () => {
    const { svc, subscriber, redis } = make({
      redisGet: () => Promise.resolve(JSON.stringify(VALID_PERSONA)),
    });
    svc.onModuleInit();
    expect(subscriber.subscribe).toHaveBeenCalledWith(svc.channel);

    await svc.persona();
    const onMessage = subscriber.on.mock.calls.find(([event]) => event === 'message')?.[1] as (
      ...args: unknown[]
    ) => void;
    onMessage();
    await svc.persona();
    expect(redis.get).toHaveBeenCalledTimes(2);

    await svc.onModuleDestroy();
    expect(subscriber.quit).toHaveBeenCalled();
  });

  it('falha ao assinar o canal não é fatal — segue funcionando pelo TTL', async () => {
    const { svc, redis } = make({ redisGet: () => Promise.resolve(null) });
    redis.duplicate.mockImplementation(() => {
      throw new Error('sem conexão dedicada');
    });
    expect(() => svc.onModuleInit()).not.toThrow();
    expect(await svc.persona()).toEqual(DEFAULT_AGENT_PERSONA);
    await expect(svc.onModuleDestroy()).resolves.toBeUndefined();
  });

  it('cacheKey e channel usam o namespace global do RedisKeyBuilder', () => {
    const { svc } = make();
    expect(svc.cacheKey).toContain('agent-config');
    expect(svc.cacheKey).toContain('current');
    expect(svc.channel).toContain('agent-config');
    expect(svc.channel).toContain('invalidate');
  });
});

describe('AgentConfigRepository', () => {
  it('lê a maior versão publicada', async () => {
    const rows = [{ version: 2, payload: VALID_PERSONA }];
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => Promise.resolve(rows),
            }),
          }),
        }),
      }),
    } as never;
    const repo = new AgentConfigRepository(db);
    expect(await repo.activePayload()).toEqual(rows[0]);
  });

  it('sem linha publicada devolve null', async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => Promise.resolve([]),
            }),
          }),
        }),
      }),
    } as never;
    const repo = new AgentConfigRepository(db);
    expect(await repo.activePayload()).toBeNull();
  });
});
