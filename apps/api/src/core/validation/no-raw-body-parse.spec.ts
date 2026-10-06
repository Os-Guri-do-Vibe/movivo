import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Trava de regressão do Mass Assignment (OWASP API3:2023): corpo de request só pode ser
 * validado por `parseBody`/`strictSafeParse`, que rejeitam chave fora do schema. Chamar
 * `schema.parse(body)` / `schema.safeParse(body)` direto volta a *descartar em silêncio*
 * a propriedade extra — e esconde a sondagem de quem tenta enviar `role`, `plan`, etc.
 */
const SRC = join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    const isSource = full.endsWith('.ts') && !/\.(spec|test|d)\.ts$/.test(full);
    return isSource ? [full] : [];
  });
}

/** `fooSchema.parse(body)` e variantes com o nome de variável que carrega o corpo cru. */
const RAW_BODY_PARSE = /\b\w*[sS]chema\.(?:safeParse|parse)\(\s*(?:body|raw|rawBody|req\.body)\b/;
/** `schema.safeParse(input)` solto — os helpers `parse` privados devem usar `strictSafeParse`. */
const RAW_INPUT_HELPER = /=\s*schema\.safeParse\(input\)/;

/**
 * Usos de `schema.parse(raw)` que NÃO são corpo de request de cliente. Cada entrada precisa
 * dizer por quê; entrada nova sem justificativa não passa em revisão.
 */
const NOT_A_CLIENT_BODY: Readonly<Record<string, string>> = {
  'modules/admin/ai-config.controller.ts': 'query string `targetSex` (GET), não escreve estado',
  'modules/protocol/protocol-generator.service.ts': 'saída do LLM, não entrada do cliente',
  'modules/whatsapp/inbound/arara-inbound.edge.ts': 'webhook de provedor (HMAC), já `.strict()`',
  'modules/whatsapp/inbound/evolution-inbound.edge.ts':
    'webhook de provedor (HMAC); o envelope de terceiro evolui sem aviso',
};

describe('validação de corpo de request', () => {
  const offenders = (pattern: RegExp) =>
    sourceFiles(join(SRC, 'modules'))
      .filter((file) => pattern.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(SRC.length + 1))
      .filter((file) => !(file in NOT_A_CLIENT_BODY));

  it('nenhum módulo valida o corpo cru com schema.parse/safeParse direto', () => {
    expect(offenders(RAW_BODY_PARSE)).toEqual([]);
  });

  it('nenhum helper `parse` privado usa schema.safeParse(input) (deve ser strictSafeParse)', () => {
    expect(offenders(RAW_INPUT_HELPER)).toEqual([]);
  });
});
