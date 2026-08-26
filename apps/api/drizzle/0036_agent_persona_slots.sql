CREATE TYPE "public"."biological_sex" AS ENUM('MALE', 'FEMALE');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "biological_sex" "biological_sex";--> statement-breakpoint
ALTER TABLE "agent_config" ADD COLUMN "target_sex" "biological_sex";--> statement-breakpoint
-- `agent_config` é append-only por trigger (`trg_agent_config_immutable`, aplicado pela
-- reconciliação do `migrate.ts`). Um UPDATE de migração é a única exceção legítima e não
-- consegue passar pela trigger: desligamos os triggers de usuário só nesta transação.
-- `DISABLE TRIGGER USER` (e não pelo nome) porque num banco novo a trigger ainda não existe
-- e o Postgres não aceita `IF EXISTS` aqui — assim o passo é idempotente nos dois cenários.
ALTER TABLE "agent_config" DISABLE TRIGGER USER;--> statement-breakpoint
-- Decisão DETERMINÍSTICA de migração: a persona já publicada vai para o slot MASCULINO.
-- Não há dado que permita inferir o público pretendido de uma configuração criada quando só
-- existia uma persona; a escolha é arbitrária por construção e está registrada como tal.
-- O `migrate.ts` emite `agent_config_slot_migration_default` avisando que ela precisa de
-- revisão manual (republicar no slot certo) se estiver errada.
UPDATE "agent_config" SET "target_sex" = 'MALE' WHERE "target_sex" IS NULL;--> statement-breakpoint
ALTER TABLE "agent_config" ENABLE TRIGGER USER;--> statement-breakpoint
ALTER TABLE "agent_config" ALTER COLUMN "target_sex" SET NOT NULL;--> statement-breakpoint
-- `version` deixa de ser único globalmente: a numeração passa a ser por slot, e `version = 1`
-- existe nos dois ao mesmo tempo. O UNIQUE composto mantém a mesma proteção contra duas
-- publicações simultâneas gravarem o mesmo número — agora dentro do slot.
ALTER TABLE "agent_config" DROP CONSTRAINT "agent_config_version_unique";--> statement-breakpoint
ALTER TABLE "agent_config" ADD CONSTRAINT "agent_config_version_unique" UNIQUE("target_sex","version");
