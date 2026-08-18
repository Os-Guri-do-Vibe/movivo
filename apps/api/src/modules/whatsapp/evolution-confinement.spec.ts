/**
 * Unit ESTRUTURAL — o HTTP da EvolutionAPI é confinado ao transporte, mesmo padrão
 * do confinamento AraraHQ (`whatsapp/arara-confinement.spec.ts`).
 *
 * Varre `src/` e prova que só `whatsapp/evolution-transport.ts` faz uma chamada HTTP à
 * EvolutionAPI.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');
const ALLOWED = join('whatsapp', 'evolution-transport.ts');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

describe('confinamento do transporte EvolutionAPI', () => {
  it('só whatsapp/evolution-transport.ts faz HTTP à EvolutionAPI', () => {
    const offenders = walk(SRC).filter((file) => {
      if (file.endsWith(ALLOWED)) return false;
      const content = readFileSync(file, 'utf8');
      return /fetch\s*\(/.test(content) && /evolution/i.test(content);
    });
    expect(
      offenders,
      `arquivos falando HTTP com a EvolutionAPI fora do transporte: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
