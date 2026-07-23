/**
 * Runner de testes de INTEGRAÇÃO do backend (US-0.8, Mariana).
 *
 * Estes testes exercem I/O real contra o stack Docker da US-0.2 (Postgres via PgBouncer
 * na 5433, Redis via Sentinel na 26379). Pré-requisito: `pnpm run infra:up`.
 *
 * Ficam separados do runner unitário (`vitest.config.ts`) por dois motivos:
 *   1. exigem infraestrutura, então não podem ser o gate rápido de todo PR;
 *   2. são gates de PASSA/FALHA (o smoke sobe? a migração aplica as 9 tabelas?), não de
 *      percentual de cobertura — medir % aqui distorceria o número do gate unitário.
 *
 * Convenção de nome: `*.int-spec.ts`. `hookTimeout`/`testTimeout` folgados porque subir
 * o Nest e criar/derrubar um banco descartável leva mais que os poucos ms de um unit.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.int-spec.ts', 'src/**/*.int-spec.ts'],
    // Integração é sequencial: comparte o mesmo Postgres/Redis; paralelizar convida a corrida.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
