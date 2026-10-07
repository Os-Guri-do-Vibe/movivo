import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Trava de regressão de SQL Injection (OWASP A03:2021 / CWE-89). Valor de usuário só chega
 * ao banco como parâmetro ligado (Drizzle `sql\`... ${valor}\`` ou query builder). As três
 * formas abaixo contornam o parâmetro e por isso só existem onde listadas, com justificativa.
 * Entrada nova nesta lista exige revisão de segurança.
 */
const SRC = join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') && !/\.(spec|test|d)\.ts$/.test(full) ? [full] : [];
  });
}

const FORMS = [
  { name: 'sql.raw', pattern: /\bsql\.raw\(/ },
  { name: '.unsafe(', pattern: /\.unsafe\(/ },
  { name: 'sql.identifier', pattern: /\bsql\.identifier\(/ },
] as const;

const ALLOWED: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'sql.raw': {},
  '.unsafe(': {
    'core/database/migrate.ts':
      'DDL de migração (GRANT/REVOKE/CREATE EXTENSION): sem parâmetro possível; role validada por sqlIdentifier e extensões são constante',
  },
  'sql.identifier': {
    'scripts/rotate-health-cipher.ts':
      'manutenção de cifra: sete alvos constantes; writeRotatedCipher recusa tabela/coluna/id fora da allowlist antes da query; valores continuam parametrizados (revisão Sato 2026-10-06)',
    'modules/anamnesis/anamnesis.service.ts':
      'nome de coluna não é parametrizável; union fechado + allowlist em runtime (JSONB_BLOCK_COLUMNS) + escape do drizzle',
  },
};

describe('SQL fora de parâmetro ligado', () => {
  const files = sourceFiles(SRC).map((file) => ({
    rel: file.slice(SRC.length + 1),
    text: readFileSync(file, 'utf8'),
  }));

  it.each(FORMS)('$name só aparece nos arquivos justificados', ({ name, pattern }) => {
    const found = files.filter((f) => pattern.test(f.text)).map((f) => f.rel);
    const unexpected = found.filter((rel) => !(rel in (ALLOWED[name] ?? {})));
    expect(unexpected).toEqual([]);
  });

  it('nenhuma query é montada com template string comum passada ao driver', () => {
    // `execute(\`...\`)` ou `sql.unsafe(\`...${x}\`)` sem a tag `sql`.
    const offenders = files.filter((f) => /\.execute\(\s*`/.test(f.text)).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});
