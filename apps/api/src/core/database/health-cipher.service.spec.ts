/**
 * Testes de `HealthCipherService` (US-1.1 / TASK-1.1.3).
 *
 * Unitários: provam que o SQL usa `pgp_sym_encrypt`/`pgp_sym_decrypt`, que a chave
 * entra como *bind parameter* (nunca interpolada no texto do statement → nunca em log)
 * e o tratamento de erro. O round-trip real contra o pgcrypto está no int-spec.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import { type SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { type AppConfigService } from '../config';
import { type DrizzleClient } from './database.module';
import { HealthCipherService } from './health-cipher.service';

const dialect = new PgDialect();
const KEY = 'chave-secreta-pgcrypto';

function makeService(executeImpl: (rendered: { text: string; params: unknown[] }) => unknown) {
  const execute = vi.fn((query: SQL) => {
    const { sql: text, params } = dialect.sqlToQuery(query);
    return Promise.resolve(executeImpl({ text, params: params as unknown[] }));
  });
  const db = { execute } as unknown as DrizzleClient;
  const config = { pgcryptoKey: KEY } as unknown as AppConfigService;
  return { svc: new HealthCipherService(db, config), execute };
}

describe('HealthCipherService', () => {
  it('encryptHealth chama pgp_sym_encrypt com a chave como parâmetro (não em texto)', async () => {
    const cipher = Buffer.from('deadbeef', 'hex');
    let seen: { text: string; params: unknown[] } | undefined;
    const { svc } = makeService((rendered) => {
      seen = rendered;
      return [{ ciphertext: cipher }];
    });

    const out = await svc.encryptHealth('{"parq":true}');

    expect(out).toBe(cipher);
    expect(seen?.text).toContain('pgp_sym_encrypt');
    // A chave é um bind param, jamais concatenada no SQL (não vaza em log de query).
    expect(seen?.text).not.toContain(KEY);
    expect(seen?.params).toContain(KEY);
    expect(seen?.params).toContain('{"parq":true}');
  });

  it('decryptHealth chama pgp_sym_decrypt e devolve o plaintext', async () => {
    const { svc } = makeService(() => [{ plaintext: '{"parq":true}' }]);
    const out = await svc.decryptHealth(Buffer.from('deadbeef', 'hex'));
    expect(out).toBe('{"parq":true}');
  });

  it('encryptHealth falha claro quando o banco não retorna ciphertext', async () => {
    const { svc } = makeService(() => []);
    await expect(svc.encryptHealth('x')).rejects.toThrow(/falha ao cifrar/i);
  });

  it('decryptHealth falha claro quando a decifra não retorna valor', async () => {
    const { svc } = makeService(() => [{}]);
    await expect(svc.decryptHealth(Buffer.from('00', 'hex'))).rejects.toThrow(/falha ao decifrar/i);
  });
});
