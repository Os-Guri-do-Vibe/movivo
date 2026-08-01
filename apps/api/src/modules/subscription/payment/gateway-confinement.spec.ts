/**
 * Unit ESTRUTURAL — o SDK/HTTP do gateway de pagamento é confinado a `subscription/payment/`
 * (US-4.1, padrão do `LLMRouter`/AraraHQ). Nenhum outro arquivo referencia os endpoints reais
 * (`api.stripe.com`/`api.asaas.com`) nem importa SDK de gateway (`from 'stripe'` / `'asaas'`).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');
const ALLOWED_DIR = join('subscription', 'payment');
const MARKERS = [
  /api\.stripe\.com/i,
  /api\.asaas\.com/i,
  /from ['"]stripe['"]/,
  /from ['"]asaas['"]/,
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
    const offenders = walk(SRC).filter(
      (file) =>
        !file.includes(ALLOWED_DIR) && MARKERS.some((re) => re.test(readFileSync(file, 'utf8'))),
    );
    expect(
      offenders,
      `arquivos falando com o gateway fora de payment/: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
