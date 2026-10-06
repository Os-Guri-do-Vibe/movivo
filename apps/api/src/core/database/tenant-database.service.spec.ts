/**
 * Testes de `TenantDatabase` (US-1.1 / TASK-1.1.1).
 *
 * Unitários: provam, sem banco, que o contexto de tenant é emitido como
 * `set_config(..., is_local := true)` — o equivalente parametrizável de `SET LOCAL`,
 * revertido no COMMIT (Sato §4.4) — **dentro** da transação, e que entradas inválidas
 * falham cedo. O isolamento ponta a ponta (A não lê B) é provado no int-spec.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import { type SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { type DrizzleClient } from './database.module';
import { TenantDatabase, type TenantTransaction } from './tenant-database.service';

const dialect = new PgDialect();

interface Captured {
  readonly text: string;
  readonly params: readonly unknown[];
}

/**
 * `db` falso: `transaction(cb)` roda o callback com um `tx` que captura cada SQL
 * executado, renderizado pelo dialeto real do Postgres (prova o texto + os binds).
 */
function makeFakeDb(): { db: DrizzleClient; captured: Captured[] } {
  const captured: Captured[] = [];
  const tx = {
    execute: (query: SQL) => {
      const { sql: text, params } = dialect.sqlToQuery(query);
      captured.push({ text, params });
      return Promise.resolve([]);
    },
  } as unknown as TenantTransaction;

  const db = {
    transaction: (cb: (t: TenantTransaction) => Promise<unknown>) => cb(tx),
  } as unknown as DrizzleClient;

  return { db, captured };
}

const USER_A = '11111111-1111-4111-8111-111111111111';

describe('TenantDatabase', () => {
  it('runAsUser emite set_config LOCAL de user_id e role dentro da transação', async () => {
    const { db, captured } = makeFakeDb();
    const svc = new TenantDatabase(db);

    const result = await svc.runAsUser(USER_A, 'PROFESSIONAL', async (tx) => {
      expect(tx).toBeDefined();
      return 'resultado';
    });

    expect(result).toBe('resultado');
    // Uma única ida ao banco para o contexto inteiro (antes: 2 statements).
    expect(captured).toHaveLength(1);
    const [c0] = captured;

    // set_config com is_local = true (nunca SET de sessão): o `true` é o 3º argumento
    // (LOCAL) de cada chamada; os valores de tenant vão como bind param.
    expect(c0?.text).toContain('app.current_user_id');
    expect(c0?.text).toContain('app.current_role');
    expect(c0?.text.match(/,\s*true\)/g)).toHaveLength(2); // is_local = true nos dois
    expect(c0?.params).toEqual([USER_A, 'PROFESSIONAL']);

    // Nunca um SET/SET SESSION cru — só set_config parametrizado.
    for (const c of captured) expect(c.text).not.toMatch(/^\s*set\s+/i);
  });

  it('runAsSystem usa role SYSTEM e current_user_id NULL (bootstrap sem titular)', async () => {
    const { db, captured } = makeFakeDb();
    const svc = new TenantDatabase(db);

    await svc.runAsSystem(async () => undefined);
    expect(captured).toHaveLength(1);
    const [c0] = captured;

    expect(c0?.text).toContain('app.current_user_id');
    expect(c0?.text).toContain('app.current_role');
    expect(c0?.params).toEqual([null, 'SYSTEM']);
  });

  it('runAsToken usa role ANONYMOUS (fase anônima da anamnese)', async () => {
    const { db, captured } = makeFakeDb();
    const svc = new TenantDatabase(db);

    await svc.runAsToken(async () => 42, 'opaque-test-token');
    expect(captured).toHaveLength(1);
    const [c0] = captured;

    expect(c0?.params).toEqual([null, 'ANONYMOUS', 'opaque-test-token']);
    expect(c0?.text).toContain('app.current_anamnesis_token');
    expect(c0?.text.match(/,\s*true\)/g)).toHaveLength(3);
  });

  it('runAsTokenScoped inclui o GUC da sessão anônima na mesma instrução', async () => {
    const { db, captured } = makeFakeDb();
    const svc = new TenantDatabase(db);

    await svc.runAsTokenScoped(USER_A, async () => 1);
    expect(captured).toHaveLength(1);
    const [c0] = captured;

    expect(c0?.text).toContain('app.current_anamnesis_session_id');
    expect(c0?.params).toEqual([null, 'ANONYMOUS', USER_A]);
  });

  it('runAsUser rejeita userId que não é UUID (defesa em profundidade)', async () => {
    const { db } = makeFakeDb();
    const svc = new TenantDatabase(db);
    await expect(svc.runAsUser('não-é-uuid', 'USER', async () => 1)).rejects.toThrow(TypeError);
  });

  it('runAsUser rejeita role fora do conjunto permitido', async () => {
    const { db } = makeFakeDb();
    const svc = new TenantDatabase(db);
    await expect(
      svc.runAsUser(USER_A, 'SYSTEM' as unknown as 'USER', async () => 1),
    ).rejects.toThrow(TypeError);
  });
});
