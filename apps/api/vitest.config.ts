/**
 * Runner de testes UNITÁRIOS do backend (US-0.8, Mariana).
 *
 * Convenção de testes do `apps/api` (documentada em `docs/qualidade/quality-gates.md`):
 *   · `*.spec.ts`      → UNITÁRIO. Lógica pura, sem I/O. Roda aqui, sem infraestrutura.
 *                        É o que o CI (US-0.7) executa em todo PR e mede para o gate.
 *   · `*.int-spec.ts`  → INTEGRAÇÃO. Precisa do stack Docker (US-0.2) no ar. Roda por
 *                        `vitest.integration.config.ts` (script `test:int`), fora do
 *                        gate de cobertura — é um gate de passa/falha, não de %.
 *
 * ## Escopo da cobertura — por que estas exclusões não são maquiagem
 * O gate de cobertura mede o **código com lógica unitariamente testável**. Ficam de
 * fora, com justificativa por categoria (nunca arquivo a arquivo por conveniência):
 *   1. Wiring de framework sem lógica: `main.ts`, `*.module.ts`, barris `index.ts`,
 *      `*.constants.ts`.
 *   2. Declarações Drizzle (`core/database/schema/**`): definição de tabela/enum, sem
 *      ramo a exercitar. Sua correção é provada pelo teste de migração (`*.int-spec`),
 *      que aplica o schema num Postgres limpo.
 *   3. Serviços de I/O que só têm sentido contra infra real (`*-health.service.ts`,
 *      `health/**`): cobertos pelo smoke de `/health` na suíte de integração.
 *   4. Scripts CLI de banco (`migrate.ts`, `seed.ts`): entrypoints de processo com
 *      `process.exit`/argv no topo; exercitados de ponta a ponta pela integração.
 *
 * O que sobra e É medido: validação de env (Zod), contrato `*_FILE`, mapeamento de
 * config, redação de PII, namespacing de chave do Redis, opções do cliente Redis.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    exclude: ['**/*.int-spec.ts', '**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/main.ts',
        'src/**/*.module.ts',
        'src/**/index.ts',
        'src/**/*.constants.ts',
        'src/core/database/schema/**',
        'src/core/database/migrate.ts',
        'src/core/database/seed.ts',
        'src/core/database/database-health.service.ts',
        'src/core/redis/redis-health.service.ts',
        'src/health/**',
        'src/**/*.spec.ts',
        'src/**/*.int-spec.ts',
      ],
      // Contrato entregue a Henrique (US-0.7 / TASK-0.7.6) para wiring no CI.
      // Limiar da Sprint 0: ver docs/qualidade/quality-gates.md §"Cobertura".
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
