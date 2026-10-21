import { defineConfig } from 'vitest/config';

/** Runner do harness de avaliação (eval/) — fora do `vitest.config.ts` do CI de propósito. */
export default defineConfig({
  test: { environment: 'node', include: ['eval/**/*.eval.ts'], testTimeout: 60 * 60_000 },
});
