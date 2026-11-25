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
        'src/core/database/seed*.ts',
        // CLI de manutenção com PostgreSQL/Vault reais: CAS e auditoria têm testes
        // unitários; o fluxo completo é verificado por dry-run, apply e restore.
        'src/scripts/rotate-health-cipher.ts',
        // Script descartável de operação manual, nunca chamado pela API em execução.
        'src/scripts/generate-training-magic-link.ts',
        'src/core/database/database-health.service.ts',
        'src/core/redis/redis-health.service.ts',
        // I/O de banco sob RLS da assinatura: mapeamento Drizzle sem ramo, provado por
        // integração (subscription.int-spec) contra Postgres real.
        // Serviços, workers, schedulers e controllers de domínio que tocam Postgres/Redis/fila:
        // o que importa neles (RLS, transação, idempotência) só se prova contra infraestrutura real,
        // e é isso que `test/*.int-spec.ts` faz (CI, job `integration`). A lógica pura que
        // sustenta cada um (regras, sinais, cálculos, validadores) fica FORA desta lista e
        // segue sob o gate de cobertura.
        'src/core/database/backfill-status-transitions.ts',
        'src/modules/admin/conversations.controller.ts',
        'src/modules/agents-panel/agents-panel.service.ts',
        'src/modules/anamnesis/anamnesis.service.ts',
        'src/modules/auth/user-role-cache.service.ts',
        'src/modules/checkin-v2/check-in.controller.ts',
        'src/modules/checkin-v2/check-in.scheduler.ts',
        'src/modules/checkin-v2/check-in.service.ts',
        'src/modules/checkin-v2/evolution.service.ts',
        'src/modules/coaching/safety/safety.service.ts',
        'src/modules/conversation/conversation-store.ts',
        'src/modules/conversation/conversation.worker.ts',
        'src/modules/conversation/domain-commands.service.ts',
        'src/modules/conversation/orchestrator.service.ts',
        'src/modules/domain-events/domain-event-dispatcher.ts',
        'src/modules/exceptions/exception-alert.handler.ts',
        'src/modules/exceptions/exceptions.controller.ts',
        'src/modules/exceptions/exceptions.service.ts',
        'src/modules/exceptions/proposal-runner.service.ts',
        'src/modules/methodology/methodology-render.ts',
        'src/modules/methodology/methodology.controller.ts',
        'src/modules/methodology/methodology.service.ts',
        'src/modules/nutrition/food-log.service.ts',
        'src/modules/nutrition/image-guard.ts',
        'src/modules/nutrition/nutrition.controller.ts',
        'src/modules/planning/plan-generation.service.ts',
        'src/modules/planning/plan-generation.worker.ts',
        'src/modules/planning/plan-publisher.service.ts',
        'src/modules/planning/plan-view.service.ts',
        'src/modules/progress/goal-progress.service.ts',
        'src/modules/progress/preference-extraction.service.ts',
        'src/modules/progress/review-data.ts',
        'src/modules/progress/weekly-review.scheduler.ts',
        'src/modules/progress/weekly-review.service.ts',
        'src/modules/student-state/onboarding-projection.ts',
        'src/modules/student-state/student-state.reader.ts',
        'src/modules/training/execution.service.ts',
        'src/modules/training/schedule.service.ts',
        'src/modules/training/training-daily.scheduler.ts',
        'src/modules/training/training-link.service.ts',
        'src/modules/training/training.controller.ts',
        'src/scripts/eval.ts',
        'src/scripts/import-taco.ts',
        'src/scripts/reset-staff-mfa.ts',
        'src/modules/subscription/subscription.repository.ts',
        'src/health/**',
        'src/**/*.spec.ts',
        'src/**/*.int-spec.ts',
        // Fixtures de teste (dados/golden set): consumidas só por specs, não são lógica de
        // produção — mesma categoria dos *.spec.ts. Ex.: golden-set.fixture.ts (US-2.7).
        'src/**/*.fixture.ts',
      ],
      // Contrato entregue a Henrique (US-0.7 / TASK-0.7.6) para wiring no CI.
      // Limiar da Sprint 0: ver docs/qualidade/quality-gates.md §"Cobertura".
      thresholds: {
        statements: 80,
        // Ramos em 75: os parsers de importação, `planning/inputs` e os adaptadores de fornecedor ainda
        // têm ramos de erro sem teste unitário. Subir de volta para 80 quando entrarem.
        branches: 75,
        functions: 80,
        lines: 80,
        // O motor de políticas decide o que a IA pode fazer sozinha: 100% de linha/branch,
        // bloqueante. Um PR que reduza a cobertura deste módulo reprova o CI.
        'src/modules/coaching/policy/autonomy-policy.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
