/**
 * Runner de testes unitários do backend.
 *
 * Escopo desta sprint (US-0.3): apenas testes **unitários puros**, sem I/O — contrato
 * `*_FILE`, namespacing de chave do Redis e redação de PII. A infraestrutura completa
 * de testes (integração com Postgres/Redis efêmeros, cobertura, thresholds) é da
 * US-0.8 (Mariana), que deve estender este arquivo em vez de substituí-lo.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      // Cascas vazias e wiring de framework não têm o que cobrir; medir isso só
      // distorce o número que a Mariana vai usar como gate.
      exclude: ['src/main.ts', 'src/**/*.module.ts', 'src/**/index.ts'],
    },
  },
});
