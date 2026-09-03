import { GoneException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { AppConfigService } from '../../core/config';
import type { TenantDatabase } from '../../core/database/tenant-database.service';
import { WorkoutAccessService } from './workout-access.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const RAW_TOKEN = 'a'.repeat(43);

function mutationChain(returning: () => unknown[]) {
  const chain = {
    set: () => chain,
    where: () => chain,
    values: () => chain,
    returning: async () => returning(),
    then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve([]).then(resolve, reject),
  };
  return chain;
}

function makeService(options: { updates?: unknown[][]; selects?: unknown[][] } = {}) {
  const updates = [...(options.updates ?? [])];
  const selects = [...(options.selects ?? [])];
  const inserted: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  const tx = {
    insert: () => {
      const chain = mutationChain(() => []);
      chain.values = (values?: unknown) => {
        inserted.push(values as Record<string, unknown>);
        return chain;
      };
      return chain;
    },
    update: () => {
      const chain = mutationChain(() => updates.shift() ?? []);
      chain.set = (values?: unknown) => {
        updated.push(values as Record<string, unknown>);
        return chain;
      };
      return chain;
    },
    select: () => {
      const rows = selects.shift() ?? [];
      const chain = {
        from: () => chain,
        where: () => chain,
        limit: async () => rows,
      };
      return chain;
    },
  };
  const db = {
    runAsSystem: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
  } as unknown as TenantDatabase;
  const config = {
    whatsapp: { publicSiteUrl: 'https://app.movivo.test' },
  } as unknown as AppConfigService;
  return { service: new WorkoutAccessService(db, config), inserted, updated };
}

describe('WorkoutAccessService', () => {
  it('cria magic link sem expor o hash persistido na URL', async () => {
    const { service, inserted } = makeService();
    const link = await service.createMagicLink(USER_ID, 'session-1');

    expect(link).toMatch(/^https:\/\/app\.movivo\.test\/treino\/acessar#token=[\w-]{43}$/);
    expect(inserted[0]).toMatchObject({
      userId: USER_ID,
      workoutSessionId: 'session-1',
      kind: 'MAGIC',
    });
    expect(link).not.toContain(String(inserted[0]?.tokenHash));
  });

  it('rejeita magic token malformado, expirado ou consumido', async () => {
    await expect(makeService().service.exchange('curto')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(makeService({ updates: [[]] }).service.exchange(RAW_TOKEN)).rejects.toBeInstanceOf(
      GoneException,
    );
  });

  it('troca magic token uma unica vez por token de sessao', async () => {
    const { service, inserted } = makeService({ updates: [[{ userId: USER_ID }]] });
    const sessionToken = await service.exchange(RAW_TOKEN);

    expect(sessionToken).toMatch(/^[\w-]{43}$/);
    expect(inserted[0]).toMatchObject({ userId: USER_ID, kind: 'SESSION' });
  });

  it('exige bearer de sessao valido e registra o ultimo uso', async () => {
    await expect(makeService().service.requireUser(undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(makeService().service.requireUser('Bearer invalido')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      makeService({ selects: [[]] }).service.requireUser(`Bearer ${RAW_TOKEN}`),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const { service, updated } = makeService({
      selects: [[{ id: 'token-1', userId: USER_ID }]],
    });
    await expect(service.requireUser(`Bearer ${RAW_TOKEN}`)).resolves.toBe(USER_ID);
    expect(updated[0]).toHaveProperty('lastUsedAt');
  });
});
