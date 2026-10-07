import { PgDialect } from 'drizzle-orm/pg-core';
import { type SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { writeRotatedCipher } from './rotate-health-cipher';

const dialect = new PgDialect();
const input = {
  tableName: 'staff',
  columnName: 'mfa_secret_cipher',
  idName: 'id',
  rowId: '00000000-0000-4000-8000-000000000001',
  actor: '00000000-0000-4000-8000-000000000002',
  runId: '00000000-0000-4000-8000-000000000003',
  original: Buffer.from('cipher-old'),
  replacement: Buffer.from('cipher-new'),
  provider: 'LOCAL' as const,
  keyId: 'health-v2',
  vaultKey: 'health',
  vaultVersion: null,
};
function tenant(results: unknown[]) {
  const execute = vi.fn((_query: SQL) => {
    const result = results.shift();
    if (result instanceof Error) return Promise.reject(result);
    return Promise.resolve(result);
  });
  const runAsSystem = vi.fn(async (callback: (tx: unknown) => unknown) => callback({ execute }));
  return { db: { runAsSystem }, execute };
}

describe('recifra compare-and-swap', () => {
  it('confirma valor original no WHERE e audita na mesma transação, sem dados/chaves na auditoria', async () => {
    const { db, execute } = tenant([[{ id: input.rowId }], []]);
    expect(await writeRotatedCipher(db as never, input)).toBe(1);
    expect(db.runAsSystem).toHaveBeenCalledTimes(1);
    const update = dialect.sqlToQuery(execute.mock.calls[0]?.[0] as SQL);
    expect(update.sql).toContain('AND "mfa_secret_cipher" =');
    expect(update.params).toContain(input.original);
    const audit = dialect.sqlToQuery(execute.mock.calls[1]?.[0] as SQL);
    expect(audit.sql).toContain('INSERT INTO audit_logs');
    expect(audit.params).not.toContain(input.original);
    expect(audit.params).not.toContain(input.replacement);
    expect(audit.params.join(' ')).toContain('health-v2');
  });
  it('conflito não escreve auditoria de sucesso', async () => {
    const { db, execute } = tenant([[]]);
    expect(await writeRotatedCipher(db as never, input)).toBe(0);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('falha na auditoria rejeita a transação em vez de confirmar sucesso', async () => {
    const { db } = tenant([[{ id: input.rowId }], new Error('audit failed')]);
    await expect(writeRotatedCipher(db as never, input)).rejects.toThrow('audit failed');
  });
  it('Vault registra nome e versão reais, sem keyId local', async () => {
    const { db, execute } = tenant([[{ id: input.rowId }], []]);
    await writeRotatedCipher(db as never, { ...input, provider: 'VAULT', vaultVersion: '3' });
    const audit = dialect.sqlToQuery(execute.mock.calls[1]?.[0] as SQL);
    const metadata = JSON.parse(audit.params[audit.params.length - 1] as string);
    expect(metadata).toMatchObject({ vaultKey: 'health', vaultVersion: '3' });
    expect(metadata).not.toHaveProperty('keyId');
  });
  it('recifra coluna de conversa com CAS sem registrar conteúdo na auditoria', async () => {
    const textInput = {
      ...input,
      tableName: 'conversations',
      columnName: 'content',
      original: 'dor no joelho',
      replacement: 'movivo:health:text:v1:ZXhhbXBsZQ==',
      provider: 'VAULT' as const,
      vaultVersion: '2',
    };
    const { db, execute } = tenant([[{ id: input.rowId }], []]);
    expect(await writeRotatedCipher(db as never, textInput)).toBe(1);
    const update = dialect.sqlToQuery(execute.mock.calls[0]?.[0] as SQL);
    expect(update.sql).toContain('AND "content" =');
    expect(update.params).toContain(textInput.original);
    const audit = dialect.sqlToQuery(execute.mock.calls[1]?.[0] as SQL);
    expect(audit.params).not.toContain(textInput.original);
    expect(audit.params).not.toContain(textInput.replacement);
  });
  it('recusa tabela/coluna fora do inventário', async () => {
    const { db, execute } = tenant([]);
    await expect(writeRotatedCipher(db as never, { ...input, tableName: 'users' })).rejects.toThrow(
      'Alvo',
    );
    expect(execute).not.toHaveBeenCalled();
  });
});
