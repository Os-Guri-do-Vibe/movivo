/**
 * Unitários do `ConsentService` (US-1.2).
 *
 * Complementam `test/consent.int-spec.ts`: a integração prova o comportamento
 * contra o banco real (RLS, append-only, idempotência pelo índice único); aqui
 * ficam as ramificações que não dependem de I/O — sobretudo a **paridade
 * texto↔versão**, que é a regra que transforma o registro em prova.
 */
import { CONSENT_TEXTS } from '@movivo/shared';
import { describe, expect, it, vi } from 'vitest';

import { type TenantDatabase, type TenantTransaction } from '../../core/database';
import { ConsentService } from './consent.service';

const ORIGIN = { ip: '203.0.113.7', userAgent: 'vitest' };
const SESSION = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

/**
 * `tx` falso: cobre o encadeamento do Drizzle usado pelo serviço sem banco.
 * Cada builder devolve `this`, e o `await` final resolve para `rows`.
 */
function makeTx(rows: unknown[] = []): TenantTransaction {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'limit', 'insert', 'values', 'set', 'update']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.onConflictDoUpdate = vi.fn(() => Promise.resolve(rows));
  // `where` encerra os UPDATEs; um thenable resolve tanto encadeado quanto awaited.
  chain.then = (resolve: (v: unknown) => unknown) => resolve(rows);
  return chain as unknown as TenantTransaction;
}

function makeDb(rows: unknown[] = []) {
  const run = vi.fn((cb: (tx: TenantTransaction) => Promise<unknown>) => cb(makeTx(rows)));
  return {
    db: {
      runAsToken: run,
      runAsSystem: run,
      runAsUser: vi.fn((_u: string, _r: string, cb: (tx: TenantTransaction) => Promise<unknown>) =>
        cb(makeTx(rows)),
      ),
    } as unknown as TenantDatabase,
    run,
  };
}

describe('ConsentService', () => {
  it('recusa versão divergente da vigente ANTES de tocar o banco', async () => {
    const { db, run } = makeDb();
    const svc = new ConsentService(db);

    await expect(
      svc.recordForSessionToken(
        'tok',
        [{ type: 'HEALTH_DATA', version: 'consent-health-1999-01-v0', accepted: true }],
        ORIGIN,
      ),
    ).rejects.toThrow(/desatualizada/i);

    // A recusa acontece antes de abrir transação: nada é persistido nem tentado.
    expect(run).not.toHaveBeenCalled();
  });

  it('aceita a versão vigente de cada finalidade', async () => {
    // O lookup por token precisa encontrar a sessão ativa.
    const { db } = makeDb([{ id: SESSION }]);
    const svc = new ConsentService(db);

    await expect(
      svc.recordForSessionToken(
        'tok',
        [
          { type: 'MARKETING', version: CONSENT_TEXTS.MARKETING.version, accepted: false },
          {
            type: 'TERMS_OF_SERVICE',
            version: CONSENT_TEXTS.TERMS_OF_SERVICE.version,
            accepted: true,
          },
        ],
        ORIGIN,
      ),
    ).resolves.toBeUndefined();
  });

  it('hasValidHealthConsent é false quando não há linha e true quando há', async () => {
    const svc = new ConsentService(makeDb([]).db);
    await expect(svc.hasValidHealthConsent(SESSION)).resolves.toBe(false);

    const svcWith = new ConsentService(makeDb([{ id: 'c1' }]).db);
    await expect(svcWith.hasValidHealthConsent(SESSION)).resolves.toBe(true);
  });

  it('revoke roda no contexto do próprio titular (RLS por user_id)', async () => {
    const { db } = makeDb();
    const svc = new ConsentService(db);

    await svc.revoke(USER, 'HEALTH_DATA');

    expect(db.runAsUser).toHaveBeenCalledWith(USER, 'USER', expect.any(Function));
  });

  it('linkSessionToUser roda como SYSTEM (a linha ainda não tem titular)', async () => {
    const { db, run } = makeDb();
    const svc = new ConsentService(db);

    await svc.linkSessionToUser(SESSION, USER);

    expect(run).toHaveBeenCalled();
  });
});
