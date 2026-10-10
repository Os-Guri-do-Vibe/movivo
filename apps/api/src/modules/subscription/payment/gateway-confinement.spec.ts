/**
 * Unit ESTRUTURAL — o SDK/HTTP do gateway de pagamento é confinado a `subscription/payment/`
 * (US-4.1, padrão do `LLMRouter`). Nenhum outro arquivo referencia o endpoint real
 * do Asaas nem importa SDK de gateway.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');
const ALLOWED_DIR = join('subscription', 'payment');
const MARKERS = [/api\.asaas\.com/i, /from ['"]asaas['"]/];
// Configuração e seleção de ambiente citam a URL oficial, sem fazer HTTP ao Asaas.
const CONFIG_READERS = [
  join('core', 'config', 'app-config.service.ts'),
  join('core', 'config', 'env.schema.ts'),
  join('modules', 'subscription', 'subscription.service.ts'),
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

describe('confinamento do gateway de pagamento', () => {
  it('nenhum arquivo fora de subscription/payment/ fala com o gateway', () => {
    const offenders = walk(SRC).filter((file) => {
      if (file.includes(ALLOWED_DIR)) return false;
      const source = readFileSync(file, 'utf8');
      if (CONFIG_READERS.some((reader) => file.endsWith(reader))) {
        return /from ['"]asaas['"]|fetch\s*\(/.test(source);
      }
      return MARKERS.some((re) => re.test(source));
    });
    expect(
      offenders,
      `arquivos falando com o gateway fora de payment/: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
