-- Otimização de índices (sem mudança de comportamento; só desempenho e custo de escrita).
--
-- Remove 7 índices REDUNDANTES: idênticos a um UNIQUE da mesma tabela (mesmas colunas, mesma
-- ordem) ou prefixo dele — o UNIQUE já atende toda leitura que eles atendiam, e cada índice a
-- mais é escrita extra em todo INSERT/UPDATE. Adiciona 3 índices para janelas globais do painel
-- de operações (created_at sem titular) e para as respostas bloqueadas por titular.
--
-- Idempotente (IF [NOT] EXISTS). Não usa CONCURRENTLY porque o migrator do Drizzle roda cada
-- migração em transação; as tabelas envolvidas são pequenas o bastante para o lock de escrita
-- durante o CREATE INDEX ser imperceptível. Segue a regra do deploy: a versão anterior da API
-- continua funcionando (nenhum dos índices removidos é referenciado por nome no código).
DROP INDEX IF EXISTS "idx_protocol_versions_protocol";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_coaching_sessions_user";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_workout_sessions_user_date";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_faq_entries_key";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_ai_guardrail_rules_key";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_ai_forbidden_topics_key";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_exercise_catalog_entries_key";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_conversations_created_at" ON "conversations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_conversations_user_blocked" ON "conversations" USING btree ("user_id","created_at") WHERE "conversations"."validation_passed" = false;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_jobs_created_at" ON "ai_jobs" USING btree ("created_at");