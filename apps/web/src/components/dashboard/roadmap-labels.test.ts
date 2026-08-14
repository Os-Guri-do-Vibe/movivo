import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * US-8.8 — varredura de fechamento no lado da UI: nenhum componente ou tela do dashboard
 * pode continuar dizendo "Sprint 8" num contexto de indisponibilidade depois que a Sprint 8
 * entregou. O que virou número perde o rótulo; o que mudou de sprint diz a sprint nova.
 */
const ROOTS = [__dirname, resolve(__dirname, '../../app/dashboard')];
const LABEL_CONTEXT = /previst[oa]|depende|dependência|indisponí|soon:|sprint=/i;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [path];
  });
}

describe('rótulos de roadmap do dashboard', () => {
  it('não anuncia nada como "previsto para a Sprint 8"', () => {
    const offenders = ROOTS.flatMap(sourceFiles).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((text, index) => ({ file, line: index + 1, text }))
        .filter(({ text }) => /Sprint 8/.test(text) && LABEL_CONTEXT.test(text))
        .map(({ file: path, line, text }) => `${path}:${line} ${text.trim()}`),
    );

    expect(offenders).toEqual([]);
  });
});
