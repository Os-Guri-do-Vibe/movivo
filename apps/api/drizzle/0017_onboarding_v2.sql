-- Sprint 6 — Onboarding v2 (US-6.3 / TASK-6.3.2).
--
-- MIGRAÇÃO DESTRUTIVA, POR DECISÃO EXPRESSA DO FUNDADOR (D1, 2026-08-10).
-- A anamnese v1 sai do produto: o formato dos blocos mudou (a v2 pergunta coisas que a
-- v1 nunca perguntou) e **inventar valor para dado de saúde é inaceitável**. Não existe
-- backfill possível — a sessão v1 é apagada e o usuário refaz o onboarding.
-- Pré-condição verificada com o fundador: o produto não está em produção; as sessões
-- existentes são seeds e dados de teste (memória do projeto: "dev local, não produção").
--
-- O DELETE em `anamnesis_sessions` leva junto, por `ON DELETE CASCADE`, os consentimentos
-- da fase anônima presos àquelas sessões — o que é correto: um consentimento que nunca
-- fundamentou tratamento de titular identificado não é prova de nada. Consentimentos já
-- vinculados a `users` NÃO são apagados (append-only, art. 8º §2º da LGPD): eles seguem
-- como trilha histórica das versões anteriores.
DELETE FROM "anamnesis_sessions";--> statement-breakpoint
ALTER TYPE "public"."consent_type" ADD VALUE 'AI_DISCLOSURE';--> statement-breakpoint
ALTER TABLE "anamnesis_sessions" ADD COLUMN "phone_e164" varchar(20);--> statement-breakpoint
ALTER TABLE "anamnesis_sessions" ADD COLUMN "phone_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "anamnesis_sessions" ADD COLUMN "phone_code_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "anamnesis_sessions" ADD COLUMN "phone_code_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "anamnesis_sessions" ADD COLUMN "phone_code_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "anamnesis_sessions" ADD COLUMN "phone_code_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "anamnesis_sessions" ADD COLUMN "phone_code_send_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_anamnesis_sessions_phone_code" ON "anamnesis_sessions" USING btree ("phone_e164","phone_code_sent_at");