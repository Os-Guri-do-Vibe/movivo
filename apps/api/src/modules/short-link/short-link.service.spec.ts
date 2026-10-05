import { describe, expect, it, vi } from 'vitest';

import { type HealthCipherService } from '../../core/database/health-cipher.service';
import { shortLinks } from '../../core/database/schema';
import type { TenantDatabase } from '../../core/database/tenant-database.service';
import { ShortLinkService } from './short-link.service';

const cipher = {
  encryptHealth: vi.fn(async () => Buffer.from('ciphertext')),
  decryptHealth: vi.fn(async () => 'https://movivo.app/treino/acessar#token=secret'),
} as unknown as HealthCipherService;

function makeInsertTx(codes: (string | undefined)[]) {
  let call = 0;
  const returning = vi.fn(async () => {
    const code = codes[call];
    call += 1;
    return code ? [{ code }] : [];
  });
  const onConflictDoNothing = vi.fn(() => ({ returning }));
  const values = vi.fn(() => ({ onConflictDoNothing }));
  const insert = vi.fn((table: unknown) =>
    table === shortLinks ? { values } : { values: () => ({}) },
  );
  return { insert, values, onConflictDoNothing, returning };
}

function makeSelectTx(row: { targetUrl: string } | undefined) {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: async () => (row ? [row] : []),
  };
  const select = vi.fn(() => chain);
  return { select };
}

describe('ShortLinkService.create', () => {
  it('grava o alias e devolve só o código gerado', async () => {
    const tx = makeInsertTx(['aB3xK9pQ']);
    const db = {
      runAsSystem: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
    } as unknown as TenantDatabase;
    const service = new ShortLinkService(db, cipher);

    const code = await service.create('https://movivo.app/treino/acessar#token=secret', new Date());

    expect(code).toMatch(/^[A-Za-z0-9]{24}$/);
    expect(JSON.stringify(tx.values.mock.calls)).not.toContain(code);
    expect(tx.values).toHaveBeenCalledWith(
      expect.objectContaining({
        targetUrl: `pgp:v1:${Buffer.from('ciphertext').toString('base64')}`,
      }),
    );
  });

  it('tenta de novo em colisão de código (onConflictDoNothing sem linha)', async () => {
    const tx = makeInsertTx([undefined, 'novoCode1']);
    const db = {
      runAsSystem: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
    } as unknown as TenantDatabase;
    const service = new ShortLinkService(db, cipher);

    const code = await service.create('https://movivo.app/x', new Date());

    expect(code).toMatch(/^[A-Za-z0-9]{24}$/);
    expect(tx.returning).toHaveBeenCalledTimes(2);
  });

  it('desiste após esgotar as tentativas e lança', async () => {
    const tx = makeInsertTx([undefined, undefined, undefined, undefined, undefined]);
    const db = {
      runAsSystem: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
    } as unknown as TenantDatabase;
    const service = new ShortLinkService(db, cipher);

    await expect(service.create('https://movivo.app/x', new Date())).rejects.toThrow(
      /falha ao gerar código único/,
    );
  });
});

describe('ShortLinkService.resolve', () => {
  it('devolve a URL alvo quando o código existe e não expirou', async () => {
    const tx = makeSelectTx({
      targetUrl: `pgp:v1:${Buffer.from('ciphertext').toString('base64')}`,
    });
    const db = {
      runAsSystem: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
    } as unknown as TenantDatabase;
    const service = new ShortLinkService(db, cipher);

    await expect(service.resolve('aB3xK9pQ')).resolves.toBe(
      'https://movivo.app/treino/acessar#token=secret',
    );
  });

  it('devolve null quando o código não existe (ou já expirou, filtrado pela query)', async () => {
    const tx = makeSelectTx(undefined);
    const db = {
      runAsSystem: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
    } as unknown as TenantDatabase;
    const service = new ShortLinkService(db, cipher);

    await expect(service.resolve('inexistente')).resolves.toBeNull();
  });
});

it('não aceita destino legado em claro', async () => {
  const tx = makeSelectTx({ targetUrl: 'https://movivo.app/conta/legacy-user-id' });
  const db = {
    runAsSystem: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
  } as unknown as TenantDatabase;
  await expect(new ShortLinkService(db, cipher).resolve('legacy')).resolves.toBeNull();
});
