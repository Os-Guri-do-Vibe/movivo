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
    // Garante o profissional CREF singleton (o `db:seed` não roda na integração) — sem ele
    // toda submissão de anamnese falha em `assign_unique_active_professional`.
    globalSetup: ['test/global-setup.int.ts'],
    // Integração é sequencial: comparte o mesmo Postgres/Redis; paralelizar convida a corrida.
    fileParallelism: false,
    // Um ÚNICO fork para toda a suíte de integração. Sem isto, cada arquivo roda
    // num fork próprio; um cliente `postgres` ou timer que demora a drenar mantém o
    // fork vivo, e o vitest o mata com "Worker exited unexpectedly" ao trocar de
    // arquivo — falha espúria que não é do teste. Um fork persistente elimina essa
    // troca (cada arquivo ainda fecha suas conexões no `afterAll`).
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
