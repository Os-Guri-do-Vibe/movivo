/**
 * Runner dos testes de JORNADA da agenda flexível (`*.journey-spec.ts`).
 *
 * Ligam as classes REAIS (planejador, fluxo do Coach, dispatcher de link, oferta de link novo,
 * registro tardio, diário, check-in semanal, contexto do Coach) contra um Postgres de verdade
 * (PGlite, ver `support/pglite.ts`), com fakes só nas bordas: LLM, WhatsApp/fila, Redis em
 * memória e relógio.
 *
 * Como rodar (de `apps/api`): `pnpm test:journeys`. O PGlite é devDependency do pacote, então não
 * precisa de Docker, Postgres nem variável de ambiente.
 */
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    root: fileURLToPath(new URL('../..', import.meta.url)),
    include: ['test/journeys/**/*.journey-spec.ts'],
    // Cada arquivo sobe o próprio banco; em paralelo o custo é só de memória.
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
