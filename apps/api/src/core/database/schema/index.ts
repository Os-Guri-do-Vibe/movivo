/**
 * Barrel do schema Drizzle (TASK-0.4.1).
 *
 * É este objeto agregado que o `drizzle.config.ts` lê para gerar migrações e que
 * o `DatabaseModule` (US-0.3) injeta como tipo do client. Uma tabela que não for
 * reexportada aqui **não** entra na migração — por isso o arquivo é a checklist
 * viva das 9 tabelas-base do schema lógico de Lucas (`08-relatorio-lucas.md` §9).
 */
export * from './_shared';
export * from './enums';

// As 9 tabelas-base da Sprint 0.
export * from './users';
export * from './anamnesis-sessions';
export * from './consents';
export * from './protocols';
export * from './protocol-versions';
export * from './conversations';
export * from './checkins';
export * from './subscriptions';
export * from './ai-jobs';

// Sprint 1 — schema de autenticação (US-1.1 / TASK-1.1.5).
export * from './auth-sessions';

// Sprint 3 — handoff/alertas ao painel CREF (US-3.6).
export * from './handoff-alerts';

// Sprint 3 — memória de longo prazo da conversa (US-3.2).
export * from './coaching-sessions';

// Sprint 3 — corpus curado do RAG (US-3.3). Global, read-only, fora da RLS por titular.
export * from './knowledge-base';
export * from './knowledge-documents';
export * from './vector';
export * from './methodology-versions';

// Sprint 3 — exemplos rotulados do IntentClassifier (US-3.4). Global, read-only.
export * from './intent-examples';

// Sprint 5 - escopo profissional, check-in duravel e auditoria imutavel.
export * from './professional-assignments';
export * from './audit-logs';
export * from './reengagement-nudges';

// Sprint 7 - configuracao publicada da agente de IA (US-7.6). Global, append-only.
export * from './agent-config';

// Sprint 8 - treino concluido verificado, base da North Star (US-8.1).
export * from './workout-completions';
export * from './workout-journal';

// Sprint 8 - sequencia de mudancas de estado do aluno, append-only (US-8.3).
export * from './user-status-transitions';

// Sprint 8 - despesa auditavel e preco de modelo por vigencia (US-8.4).
export * from './expenses';
export * from './model-pricing';

// Sprint 8 - liquidacao recebida do gateway (US-8.5). Append-only, idempotente pelo banco.
export * from './payments';

// Sprint 8 - investimento em midia por canal/campanha (US-8.6). Global, append-only.
export * from './ad-spend';

// Sprint 8 - cap table versionado por vigencia (US-8.7). Soma vigente travada em 10.000 bps.
export * from './partners';

// Sprint 9 - FAQ determinístico global, versionado e append-only.
export * from './faq-entries';
export * from './ai-guardrail-rules';

// Sprint 10 - temas proibidos da agente. Append-only, workflow auditável, ação fixa em BLOCK.
export * from './ai-forbidden-topics';

// Achado 2026-09-02 - base de exercícios parametrizada (era array const em código).
export * from './exercise-catalog-entries';

// Achado 2026-09-02 - proposta de substituição de exercício via IA, em staging.
export * from './protocol-substitution-requests';
