/**
 * Unit ESTRUTURAL — o HTTP da AraraHQ é confinado ao transporte (US-2.5), como o LLM.
 *
 * Varre `src/` e prova que só `whatsapp/arara-transport.ts` faz uma chamada HTTP à AraraHQ.
 * Marcador robusto: um arquivo que faça `fetch(` E mencione `arara` está falando com o
 * provedor — o que só o transporte pode. Config/módulo mencionam `arara` (fiação), mas
 * nunca chamam `fetch`; `llm/providers.ts` chama `fetch` mas não menciona `arara`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');
const ALLOWED = join('whatsapp', 'arara-transport.ts');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

describe('confinamento do transporte AraraHQ', () => {
  it('só whatsapp/arara-transport.ts faz HTTP à AraraHQ', () => {
    const offenders = walk(SRC).filter((file) => {
      if (file.endsWith(ALLOWED)) return false;
      const content = readFileSync(file, 'utf8');
      return /fetch\s*\(/.test(content) && /arara/i.test(content);
    });
    expect(
      offenders,
      `arquivos falando HTTP com a AraraHQ fora do transporte: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
