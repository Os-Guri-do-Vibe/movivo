/**
 * Contrato `*_FILE` de `docs/SECURITY.md` §2 — normativo. Cada teste aqui corresponde a uma
 * regra numerada do documento; se um deles cair, o ambiente local e a migração para
 * Vault (Fase B) quebram junto.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { FileSecretError, resolveFileSecrets } from './resolve-file-secrets';

const dir = mkdtempSync(join(tmpdir(), 'movivo-secrets-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function secretFile(name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content, 'utf8');
  return path;
}

describe('resolveFileSecrets', () => {
  it('§2.1.3 — K_FILE tem precedência sobre K', () => {
    const path = secretFile('a', 'do-arquivo');
    const { env, warnings } = resolveFileSecrets(
      { DATABASE_PASSWORD: 'da-env', DATABASE_PASSWORD_FILE: path },
      ['DATABASE_PASSWORD'],
    );

    expect(env.DATABASE_PASSWORD).toBe('do-arquivo');
    expect(warnings).toHaveLength(1);
    // O aviso cita o nome, nunca o valor (§2.1.9).
    expect(warnings[0]?.message).not.toContain('do-arquivo');
    expect(warnings[0]?.message).not.toContain('da-env');
  });

  it('§2.1.3 — sem K_FILE, usa a env direta', () => {
    const { env } = resolveFileSecrets({ REDIS_PASSWORD: 'da-env' }, ['REDIS_PASSWORD']);
    expect(env.REDIS_PASSWORD).toBe('da-env');
  });

  it('§2.1.2 — o par K_FILE é removido antes de chegar ao Zod', () => {
    const path = secretFile('b', 'valor');
    const { env } = resolveFileSecrets({ REDIS_PASSWORD_FILE: path }, ['REDIS_PASSWORD']);
    expect(env).not.toHaveProperty('REDIS_PASSWORD_FILE');
  });

  it('§2.1.4 — arquivo inexistente é erro fatal, nunca fallback para K', () => {
    expect(() =>
      resolveFileSecrets(
        { DATABASE_PASSWORD: 'da-env', DATABASE_PASSWORD_FILE: join(dir, 'nao-existe') },
        ['DATABASE_PASSWORD'],
      ),
    ).toThrow(FileSecretError);
  });

  it('§2.1.4 — arquivo vazio (ou só whitespace) é erro fatal', () => {
    const empty = secretFile('vazio', '\n  \n');
    expect(() => resolveFileSecrets({ REDIS_PASSWORD_FILE: empty }, ['REDIS_PASSWORD'])).toThrow(
      /está vazio/,
    );
  });

  it('§2.1.6 — remove BOM e aplica trimEnd, preservando espaço à esquerda', () => {
    const path = secretFile('bom', '\uFEFF  senha-com-espaco-inicial  \r\n');
    const { env } = resolveFileSecrets({ REDIS_PASSWORD_FILE: path }, ['REDIS_PASSWORD']);
    expect(env.REDIS_PASSWORD).toBe('  senha-com-espaco-inicial');
  });

  it('§2.1.8 — não muta o objeto de entrada nem escreve em process.env', () => {
    const path = secretFile('c', 'segredo');
    const input = { REDIS_PASSWORD_FILE: path };
    resolveFileSecrets(input, ['REDIS_PASSWORD']);

    expect(input).toEqual({ REDIS_PASSWORD_FILE: path });
    expect(process.env.REDIS_PASSWORD).toBeUndefined();
  });

  it('§2.1.9 — a mensagem de erro cita a variável e o caminho, nunca o conteúdo', () => {
    const path = join(dir, 'ausente');
    try {
      resolveFileSecrets({ DATABASE_PASSWORD_FILE: path }, ['DATABASE_PASSWORD']);
      expect.unreachable('deveria ter lançado');
    } catch (error) {
      expect(error).toBeInstanceOf(FileSecretError);
      expect((error as FileSecretError).message).toContain('DATABASE_PASSWORD_FILE');
      expect((error as FileSecretError).message).toContain(path);
    }
  });
});
