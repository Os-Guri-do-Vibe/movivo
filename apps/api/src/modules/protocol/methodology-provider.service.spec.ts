import { describe, expect, it, vi } from 'vitest';

import type { TenantDatabase } from '../../core/database/tenant-database.service';
import { MethodologyProvider } from './methodology-provider.service';

const PUBLISHED_ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  version: 2,
  version_label: 'methodology-v2',
  content: 'Progressão dupla conforme protocolo assinado pelo profissional CREF.',
  content_sha256: 'a'.repeat(64),
};

function providerWith(executeQueue: unknown[][]) {
  const queue = [...executeQueue];
  const execute = vi.fn(async () => queue.shift() ?? []);
  const tx = { execute };
  const db = {
    runAsSystem: vi.fn((callback: (value: unknown) => Promise<unknown>) => callback(tx)),
  } as unknown as TenantDatabase;
  const provider = new MethodologyProvider(db);
  return { provider, execute, db };
}

describe('MethodologyProvider.current', () => {
  it('busca no banco, roda o bootstrap antes e cacheia o resultado', async () => {
    const { provider, execute, db } = providerWith([
      [], // ensureBootstrap: advisory lock
      [], // ensureBootstrap: insert idempotente
      [PUBLISHED_ROW], // consulta da versão publicada
    ]);

    const value = await provider.current();

    expect(value).toEqual({
      id: PUBLISHED_ROW.id,
      version: 2,
      versionLabel: 'methodology-v2',
      content: PUBLISHED_ROW.content,
      contentSha256: PUBLISHED_ROW.content_sha256,
    });
    expect(db.runAsSystem).toHaveBeenCalledTimes(2); // ensureBootstrap + a consulta

    // Segunda chamada reaproveita o cache: nenhuma query nova.
    execute.mockClear();
    (db.runAsSystem as ReturnType<typeof vi.fn>).mockClear();
    const cached = await provider.current();
    expect(cached).toBe(value);
    expect(db.runAsSystem).not.toHaveBeenCalled();
  });

  it('sem versão publicada, rejeita com erro explícito', async () => {
    const { provider } = providerWith([[], [], []]);
    await expect(provider.current()).rejects.toThrow('Nenhuma metodologia CREF publicada.');
  });

  it('invalidate() força nova consulta mesmo com cache válido', async () => {
    const { provider, db } = providerWith([[], [], [PUBLISHED_ROW], [], [], [PUBLISHED_ROW]]);
    await provider.current();
    provider.invalidate();
    (db.runAsSystem as ReturnType<typeof vi.fn>).mockClear();
    await provider.current();
    expect(db.runAsSystem).toHaveBeenCalledTimes(2);
  });
});

describe('MethodologyProvider — publicação durante uma leitura', () => {
  it('leitura iniciada antes do invalidate() não guarda a versão antiga no cache', async () => {
    const OLD_ROW = { ...PUBLISHED_ROW, version: 1, version_label: 'methodology-v1' };
    const NEW_ROW = { ...PUBLISHED_ROW, version: 2, version_label: 'methodology-v2' };

    // A consulta da versão publicada (3ª execução) fica presa até a publicação invalidar.
    let releaseOldRead: (rows: unknown[]) => void = () => undefined;
    const rowsByCall: Array<unknown[] | Promise<unknown[]>> = [
      [],
      [],
      new Promise<unknown[]>((resolve) => {
        releaseOldRead = resolve;
      }),
      [],
      [],
      [NEW_ROW],
    ];
    const execute = vi.fn(async () => rowsByCall.shift() ?? []);
    const db = {
      runAsSystem: vi.fn((callback: (value: unknown) => Promise<unknown>) => callback({ execute })),
    } as unknown as TenantDatabase;
    const provider = new MethodologyProvider(db);

    const inFlight = provider.current();
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(3));
    provider.invalidate(); // a publicação da v2 acabou de confirmar
    releaseOldRead([OLD_ROW]);
    expect((await inFlight).version).toBe(1); // quem já estava lendo recebe o que leu...

    // ...mas o cache não ficou com a v1: a próxima leitura enxerga a v2 publicada.
    expect((await provider.current()).version).toBe(2);
  });
});

describe('MethodologyProvider.ensureBootstrap', () => {
  it('trava por advisory lock e insere a v1 de forma idempotente (ON CONFLICT DO NOTHING)', async () => {
    const { provider, execute } = providerWith([[], []]);
    await provider.ensureBootstrap();
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
