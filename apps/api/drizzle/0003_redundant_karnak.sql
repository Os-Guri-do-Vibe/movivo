CREATE TYPE "public"."parq_state" AS ENUM('LIBERADO', 'BLOQUEADO_AGUARDANDO_CLEARANCE', 'LIBERADO_COM_RESSALVA_RT');--> statement-breakpoint
-- data_block_2 passa de jsonb para bytea (dado de saúde cifrado com pgcrypto — Sato achado 3).
-- Não há cast implícito jsonb→bytea; a coluna está vazia nesta fase (nenhum submit em
-- produção ainda), então descartamos qualquer conteúdo com USING NULL.
ALTER TABLE "anamnesis_sessions" ALTER COLUMN "data_block_2" SET DATA TYPE bytea USING NULL::bytea;--> statement-breakpoint
ALTER TABLE "anamnesis_sessions" ADD COLUMN "parq_state" "parq_state";