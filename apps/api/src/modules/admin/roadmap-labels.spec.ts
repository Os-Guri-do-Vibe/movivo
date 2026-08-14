import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * US-8.8 — nenhum rótulo de indisponibilidade pode continuar apontando para a Sprint 8
 * depois que a Sprint 8 foi entregue. "Previsto para a Sprint 8" numa tela pós-Sprint 8 é
 * pior que não prometer nada: ensina o fundador a não confiar no que a tela diz.
 *
 * O teste olha só as linhas que efetivamente formam rótulo para o fundador (dependência,
 * previsão, indisponibilidade). Comentário de migration ou de schema citando a sprint em
 * que a tabela nasceu é histórico, não promessa, e continua permitido.
 */
const LABEL_CONTEXT = /previst[oa]|depende|dependência|indisponí|plannedFor|soon:/i;

const files = readdirSync(__dirname)
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
  .map((name) => join(__dirname, name));

describe('rótulos de roadmap do Control Center', () => {
  it('não anuncia nada como "previsto para a Sprint 8"', () => {
    const offenders = files.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, index) => ({ file, line: index + 1, text: line }))
        .filter(({ text }) => /Sprint 8/.test(text) && LABEL_CONTEXT.test(text))
        .map(({ file: path, line, text }) => `${path}:${line} ${text.trim()}`),
    );

    expect(offenders).toEqual([]);
  });
});
