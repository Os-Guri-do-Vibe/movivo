ALTER TABLE "users" ADD COLUMN "coach_paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "conversation_read_at" timestamp with time zone;
--> statement-breakpoint
-- O histórico que já existe nasce como lido: sem isto, todo aluno antigo apareceria com
-- dezenas de mensagens "não lidas" no primeiro acesso à aba Conversas.
UPDATE "users" SET "conversation_read_at" = now() WHERE "conversation_read_at" IS NULL;
