/// <reference types="vitest" />
/**
 * Runner de testes de COMPONENTE do frontend (US-0.8, Mariana).
 *
 * Escopo: componentes do design system "O Pulso" em jsdom com Testing Library. O E2E
 * (Playwright) vive em `playwright.config.ts` e roda contra o dev server — nunca aqui.
 *
 * ## Decisões que respondem aos recados de Felipe (US-0.5)
 *  - **Tailwind v4 sem `tailwind.config.*`**: `css: false` desliga o processamento de CSS
 *    no teste. Os componentes testados (`Button`, `ThemeToggle`) não importam `globals.css`
 *    — asserimos comportamento e semântica (papéis ARIA, `className`), não pixels. Isso
 *    evita depender de `@tailwindcss/postcss` no runner e mantém o teste rápido e estável.
 *  - **Aliases**: `apps/web/tsconfig.json` define `@/*` e `@movivo/shared` no próprio
 *    arquivo (o `paths` do base NÃO é herdado). Replicados aqui. `@movivo/shared` já
 *    resolve pelo symlink de workspace (dist compilado), então só `@/*` precisa de alias.
 *  - **`environment: 'jsdom'`** só nos `*.test.tsx`; nada global desnecessário.
 */
import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    css: false,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/.next/**', 'e2e/**'],
    coverage: {
      /*
       * Istanbul, não v8, de propósito: o provider v8 desta versão deixa de atribuir
       * cobertura a arquivos de componente efetivamente executados (button.tsx, utils.ts)
       * por uma falha de mapeamento de sourcemap sob a transformação do plugin React,
       * inflando artificialmente o "não coberto". O istanbul instrumenta a fonte
       * diretamente e reporta o número real. (Diagnóstico registrado por Mariana, US-0.8.)
       */
      provider: 'istanbul',
      reporter: ['text', 'text-summary', 'lcov'],
      include: ['src/components/**/*.{ts,tsx}', 'src/lib/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.d.ts'],
      // Casca de fundação: só há 3 unidades com lógica testável (Button, ThemeToggle, cn).
      // Limiar honesto da Sprint 0 documentado em docs/qualidade/quality-gates.md §"Cobertura".
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
