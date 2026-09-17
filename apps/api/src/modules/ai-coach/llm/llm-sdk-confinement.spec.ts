/**
 * Unit ESTRUTURAL — o SDK/HTTP de provedor de LLM/IA é confinado a um arquivo por
 * fornecedor (US-2.2 · §12.12; ADR-009 estende o mesmo padrão à transcrição de áudio).
 *
 * Varre `src/` e prova que nenhum arquivo fora da lista `ALLOWED` fala com um provedor:
 * nem endpoint HTTP (`api.openai.com`/`api.anthropic.com`/`api.groq.com`) nem import de
 * SDK (`openai`, `@anthropic-ai/*`). Se um módulo qualquer passar a chamar um provedor
 * direto, este teste falha.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');
const ALLOWED = [
  join('llm', 'providers.ts'),
  join('core', 'knowledge', 'openai-embedding.ts'),
  join('core', 'audio', 'openai-transcription.ts'),
  join('core', 'audio', 'groq-transcription.ts'),
];
const PROVIDER_MARKERS = [
  /api\.openai\.com/,
  /api\.anthropic\.com/,
  /api\.groq\.com/,
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
      if (ALLOWED.some((allowed) => file.endsWith(allowed))) continue;
      const content = readFileSync(file, 'utf8');
      if (PROVIDER_MARKERS.some((re) => re.test(content))) offenders.push(file);
    }
    expect(
      offenders,
      `arquivos falando com provedor fora do router: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
