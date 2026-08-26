import { DEFAULT_AGENT_PERSONA, type AgentPersona, type BiologicalSex } from '@movivo/shared';
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

/** Persona do outro slot — nome diferente para provar de qual slot a resposta veio. */
const MALE_PERSONA: AgentPersona = { ...VALID_PERSONA, agentName: 'Leonardo' };
const FEMALE_PERSONA: AgentPersona = { ...VALID_PERSONA, agentName: 'Marina' };

function make(overrides?: {
  redisGet?: (key: string) => Promise<string | null>;
  repoActivePayload?: (
    targetSex: BiologicalSex,
  ) => Promise<{ version: number; payload: unknown } | null>;
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

/** Banco com persona publicada só nos slots informados. */
function dbWith(payloads: Partial<Record<BiologicalSex, AgentPersona>>) {
  return (targetSex: BiologicalSex) => {
    const payload = payloads[targetSex];
    return Promise.resolve(payload ? { version: 1, payload } : null);
  };
}

describe('AgentPersonaService', () => {
  beforeEach(() => vi.useRealTimers());

  it('sem config publicada (Redis e banco vazios), cai para o default de código', async () => {
    const { svc } = make();
    expect(await svc.persona('MALE')).toEqual(DEFAULT_AGENT_PERSONA);
    expect(await svc.agentName('FEMALE')).toBe(DEFAULT_AGENT_PERSONA.agentName);
  });

  it('lê o snapshot do Redis quando presente e válido', async () => {
    const { svc, repo } = make({
      redisGet: () => Promise.resolve(JSON.stringify(VALID_PERSONA)),
    });
    expect(await svc.persona('MALE')).toEqual(VALID_PERSONA);
    // Redis respondeu: o banco nem precisa ser consultado.
    expect(repo.activePayload).not.toHaveBeenCalled();
  });

  it('Redis fora do ar cai para o banco', async () => {
    const { svc } = make({
      redisGet: () => Promise.reject(new Error('ECONNREFUSED')),
      repoActivePayload: () => Promise.resolve({ version: 3, payload: VALID_PERSONA }),
    });
    expect(await svc.persona('MALE')).toEqual(VALID_PERSONA);
  });

  it('Redis e banco fora do ar: fail-safe nunca é "sem guardrail" — devolve o default', async () => {
    const { svc, logger } = make({
      redisGet: () => Promise.reject(new Error('ECONNREFUSED')),
      repoActivePayload: () => Promise.reject(new Error('banco indisponível')),
    });
    expect(await svc.persona('MALE')).toEqual(DEFAULT_AGENT_PERSONA);
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
    expect(await svc.persona('MALE')).toEqual(VALID_PERSONA);
  });

  it('payload inválido no banco cai para o default', async () => {
    const { svc } = make({
      repoActivePayload: () => Promise.resolve({ version: 1, payload: { agentName: 'X' } }),
    });
    expect(await svc.persona('MALE')).toEqual(DEFAULT_AGENT_PERSONA);
  });

  it('nenhuma linha publicada (`activePayload` null) cai para o default', async () => {
    const { svc } = make({ repoActivePayload: () => Promise.resolve(null) });
    expect(await svc.persona('MALE')).toEqual(DEFAULT_AGENT_PERSONA);
  });

  it('resultado é cacheado em memória: uma segunda chamada não bate no Redis de novo', async () => {
    const { svc, redis } = make({
      redisGet: () => Promise.resolve(JSON.stringify(VALID_PERSONA)),
    });
    await svc.persona('MALE');
    await svc.persona('MALE');
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
    expect(await svc.persona('MALE')).toEqual(VALID_PERSONA);
    svc.invalidate();
    expect(await svc.persona('MALE')).toEqual(DEFAULT_AGENT_PERSONA);
    expect(redis.get).toHaveBeenCalledTimes(2);
  });

  it('onModuleInit assina o canal de invalidação; mensagem recebida limpa o cache', async () => {
    const { svc, subscriber, redis } = make({
      redisGet: () => Promise.resolve(JSON.stringify(VALID_PERSONA)),
    });
    svc.onModuleInit();
    expect(subscriber.subscribe).toHaveBeenCalledWith(svc.channel);

    await svc.persona('MALE');
    const onMessage = subscriber.on.mock.calls.find(([event]) => event === 'message')?.[1] as (
      ...args: unknown[]
    ) => void;
    onMessage(svc.channel, JSON.stringify({ slot: 'FEMALE' }));
    await svc.persona('MALE');
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
    expect(await svc.persona('MALE')).toEqual(DEFAULT_AGENT_PERSONA);
    await expect(svc.onModuleDestroy()).resolves.toBeUndefined();
  });

  it('cacheKeyFor e channel usam o namespace global do RedisKeyBuilder, com o slot na chave', () => {
    const { svc } = make();
    expect(svc.cacheKeyFor('MALE')).toContain('agent-config');
    expect(svc.cacheKeyFor('MALE')).toContain('current');
    expect(svc.cacheKeyFor('MALE')).toContain('MALE');
    // Os dois slots NÃO podem compartilhar chave: a última publicação sobrescreveria a outra.
    expect(svc.cacheKeyFor('MALE')).not.toBe(svc.cacheKeyFor('FEMALE'));
    expect(svc.channel).toContain('agent-config');
    expect(svc.channel).toContain('invalidate');
  });

  /* ----------------------------------------------------------------------- *
   * Sprint 11 — dois slots, empréstimo e propagação
   * ----------------------------------------------------------------------- */

  it('cada slot resolve a SUA persona quando os dois estão publicados', async () => {
    const { svc } = make({
      repoActivePayload: dbWith({ MALE: MALE_PERSONA, FEMALE: FEMALE_PERSONA }),
    });
    expect((await svc.persona('MALE')).agentName).toBe('Leonardo');
    expect((await svc.persona('FEMALE')).agentName).toBe('Marina');
  });

  it('slot FEMININO órfão recebe a persona masculina por empréstimo (nunca o default)', async () => {
    const { svc, logger } = make({ repoActivePayload: dbWith({ MALE: MALE_PERSONA }) });
    const resolved = await svc.resolve('FEMALE');
    expect(resolved.persona.agentName).toBe('Leonardo');
    expect(resolved.servedFromSex).toBe('MALE');
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'agent_config_fallback', reason: 'SLOT_BORROWED' }),
      expect.any(String),
    );
  });

  it('slot MASCULINO órfão recebe a persona feminina por empréstimo (empréstimo vale nos dois sentidos)', async () => {
    const { svc } = make({ repoActivePayload: dbWith({ FEMALE: FEMALE_PERSONA }) });
    const resolved = await svc.resolve('MALE');
    expect(resolved.persona.agentName).toBe('Marina');
    expect(resolved.servedFromSex).toBe('FEMALE');
  });

  it('titular sem `biologicalSex` (null) nunca derruba a mensagem: resolve por empréstimo', async () => {
    const { svc } = make({ repoActivePayload: dbWith({ FEMALE: FEMALE_PERSONA }) });
    // `null` tenta o slot sem titular primeiro e chega no que existe pelo empréstimo.
    expect((await svc.persona(null)).agentName).toBe('Marina');
    expect(await svc.agentName(null)).toBe('Marina');
  });

  it('sem persona em NENHUM slot, `null` cai no default compilado', async () => {
    const { svc } = make();
    const resolved = await svc.resolve(null);
    expect(resolved.persona).toEqual(DEFAULT_AGENT_PERSONA);
    expect(resolved.servedFromSex).toBeNull();
  });

  it('publicar o segundo slot passa a valer na leitura seguinte, sem ação por titular', async () => {
    const published: Partial<Record<BiologicalSex, AgentPersona>> = { MALE: MALE_PERSONA };
    const { svc } = make({ repoActivePayload: (sex) => dbWith(published)(sex) });

    // Antes: a titular feminina é atendida pela persona emprestada.
    expect((await svc.persona('FEMALE')).agentName).toBe('Leonardo');

    // Publicação do slot feminino: o publicador invalida os DOIS slots.
    published.FEMALE = FEMALE_PERSONA;
    svc.invalidate();

    // Depois: a mesma titular resolve para a persona do próprio slot, sem migração de dado.
    const resolved = await svc.resolve('FEMALE');
    expect(resolved.persona.agentName).toBe('Marina');
    expect(resolved.servedFromSex).toBe('FEMALE');
    // E o slot masculino continua com a dele.
    expect((await svc.persona('MALE')).agentName).toBe('Leonardo');
  });

  it('o cache do slot que EMPRESTA é invalidado junto — não serve payload velho até o TTL', async () => {
    const published: Partial<Record<BiologicalSex, AgentPersona>> = { MALE: MALE_PERSONA };
    const { svc } = make({ repoActivePayload: (sex) => dbWith(published)(sex) });

    expect((await svc.persona('FEMALE')).agentName).toBe('Leonardo');
    // Republicação do slot masculino com outro nome + invalidação total.
    published.MALE = { ...MALE_PERSONA, agentName: 'Rafael' };
    svc.invalidate();
    expect((await svc.persona('FEMALE')).agentName).toBe('Rafael');
  });

  it('a leitura de um slot consulta o Redis DAQUELE slot', async () => {
    const { svc, redis } = make({
      redisGet: (key: string) =>
        Promise.resolve(key.endsWith('FEMALE') ? JSON.stringify(FEMALE_PERSONA) : null),
    });
    expect((await svc.persona('FEMALE')).agentName).toBe('Marina');
    expect(redis.get).toHaveBeenCalledWith(svc.cacheKeyFor('FEMALE'));
  });
});

describe('AgentConfigRepository', () => {
  it('lê a maior versão publicada do slot pedido', async () => {
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
    expect(await repo.activePayload('MALE')).toEqual(rows[0]);
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
    expect(await repo.activePayload('FEMALE')).toBeNull();
  });
});
