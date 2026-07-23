/**
 * Testes de `loadEnv` (US-0.8, Mariana).
 *
 * `loadEnv` é a montagem determinística do ambiente bruto que alimenta o Zod. A ordem
 * de precedência é uma regra de segurança, não conveniência (docs/SECURITY.md §2):
 *   arquivo `.env`  <  `process.env`  <  resolução de `*_FILE`.
 *
 * Os testes usam um diretório temporário como `cwd` — nunca tocam o `.env` real do
 * repositório nem o `process.env` do runner. Segredos aqui são valores sintéticos.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from './load-env';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'movivo-loadenv-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('loadEnv', () => {
  it('lê variáveis do arquivo .env quando não há nada no process.env', () => {
    writeFileSync(join(dir, '.env'), 'FOO=do-arquivo\nBAR=outra\n');
    const { env, loadedFiles } = loadEnv({}, dir);
    expect(env.FOO).toBe('do-arquivo');
    expect(env.BAR).toBe('outra');
    expect(loadedFiles).toHaveLength(1);
  });

  it('process.env vence o arquivo .env — o Compose/CI é a fonte de verdade', () => {
    writeFileSync(join(dir, '.env'), 'FOO=do-arquivo\n');
    const { env } = loadEnv({ FOO: 'do-processo' }, dir);
    expect(env.FOO).toBe('do-processo');
  });

  it('não falha quando não existe nenhum arquivo .env', () => {
    const { env, loadedFiles } = loadEnv({ ONLY: 'process' }, dir);
    expect(env.ONLY).toBe('process');
    expect(loadedFiles).toHaveLength(0);
  });

  it('resolve o par K_FILE lendo o arquivo apontado e remove o sufixo _FILE', () => {
    const secretPath = join(dir, 'db_password');
    writeFileSync(secretPath, 'senha-sintetica-123');
    const { env } = loadEnv({ DATABASE_PASSWORD_FILE: secretPath }, dir);
    expect(env.DATABASE_PASSWORD).toBe('senha-sintetica-123');
    // O Zod nunca deve ver o par _FILE.
    expect(env.DATABASE_PASSWORD_FILE).toBeUndefined();
  });

  it('K_FILE tem precedência sobre K direto e emite aviso de coexistência', () => {
    const secretPath = join(dir, 'redis_password');
    writeFileSync(secretPath, 'do-arquivo-vence');
    const { env, warnings } = loadEnv(
      { REDIS_PASSWORD: 'da-env-direta', REDIS_PASSWORD_FILE: secretPath },
      dir,
    );
    expect(env.REDIS_PASSWORD).toBe('do-arquivo-vence');
    expect(warnings.some((w) => w.key === 'REDIS_PASSWORD')).toBe(true);
  });

  it('carrega .env.local com precedência sobre .env', () => {
    writeFileSync(join(dir, '.env'), 'LAYER=base\n');
    writeFileSync(join(dir, '.env.local'), 'LAYER=local\n');
    const { env, loadedFiles } = loadEnv({}, dir);
    expect(env.LAYER).toBe('local');
    expect(loadedFiles).toHaveLength(2);
  });
});
