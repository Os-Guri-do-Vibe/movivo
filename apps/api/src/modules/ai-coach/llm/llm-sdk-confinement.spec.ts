/**
 * Unit ESTRUTURAL — o SDK/HTTP de provedor de LLM é confinado ao router (US-2.2 · §12.12).
 *
 * Varre `src/` e prova que nenhum arquivo (fora de `llm/providers.ts`) fala com um provedor:
 * nem endpoint HTTP (`api.openai.com`/`api.anthropic.com`) nem import de SDK (`openai`,
 * `@anthropic-ai/*`). Se um módulo qualquer passar a chamar o LLM direto, este teste falha.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');
const ALLOWED = join('llm', 'providers.ts'); // único arquivo autorizado
const PROVIDER_MARKERS = [
  /api\.openai\.com/,
  /api\.anthropic\.com/,
  /from ['"]openai['"]/,
  /from ['"]@anthropic-ai\//,
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

describe('confinamento do provedor de LLM', () => {
  it('nenhum arquivo fora de llm/providers.ts referencia um provedor de LLM', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (file.endsWith(ALLOWED)) continue;
      const content = readFileSync(file, 'utf8');
      if (PROVIDER_MARKERS.some((re) => re.test(content))) offenders.push(file);
    }
    expect(
      offenders,
      `arquivos falando com provedor fora do router: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
