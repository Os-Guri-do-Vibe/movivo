CREATE TYPE "public"."staff_role" AS ENUM('PROFESSIONAL', 'ADMIN', 'MARKETING', 'FINANCE', 'SUPPORT', 'ENGINEERING', 'DPO');--> statement-breakpoint
CREATE TYPE "public"."staff_status" AS ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone_number" varchar(20) NOT NULL,
	"name" varchar(255),
	"avatar_path" varchar(512),
	"password_hash" text NOT NULL,
	"role" "staff_role" NOT NULL,
	"status" "staff_status" DEFAULT 'ACTIVE' NOT NULL,
	"cref_number" varchar(30),
	"cref_region" varchar(2),
	"cref_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_email_unique" UNIQUE("email"),
	CONSTRAINT "staff_phone_number_unique" UNIQUE("phone_number")
);
--> statement-breakpoint
-- Backfill: contas internas (role != 'USER') hoje vivem em `users` — move para `staff`
-- preservando o MESMO `id`, para que toda FK que já aponta para esse id (professional_id,
-- created_by, actor_id, etc.) continue válida sem precisar reescrever uma linha sequer.
-- Em produção este SELECT não retorna nenhuma linha (0 contas internas até aqui).
INSERT INTO "staff" (
  "id", "email", "phone_number", "name", "avatar_path", "password_hash",
  "role", "status", "cref_number", "cref_region", "cref_active", "created_at", "updated_at"
)
SELECT
  "id", "email", "phone_number", "name", "avatar_path", "password_hash",
  "role"::text::"staff_role", 'ACTIVE', "cref_number", "cref_region", "cref_active",
  "created_at", "updated_at"
FROM "users"
WHERE "role" <> 'USER';
--> statement-breakpoint
-- Numa base nova, todas as migrações pendentes rodam numa ÚNICA transação (drizzle-orm
-- envolve o lote inteiro em `session.transaction`). A migração 0025 insere o quadro
-- societário e deixa `trg_partners_share_total` (CONSTRAINT TRIGGER ... DEFERRABLE
-- INITIALLY DEFERRED) pendente até o commit — o que bloqueia qualquer ALTER TABLE em
-- "partners" dentro da mesma transação ("cannot ALTER TABLE ... because it has pending
-- trigger events", 55006). Forçar o disparo agora (a soma já fecha em 10.000 bps) limpa
-- a pendência antes do DROP/ADD CONSTRAINT de "partners" logo abaixo.
SET CONSTRAINTS "trg_partners_share_total" IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "protocols" DROP CONSTRAINT "protocols_professional_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "auth_sessions" DROP CONSTRAINT "auth_sessions_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge_document_events" DROP CONSTRAINT "knowledge_document_events_actor_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge_document_reviews" DROP CONSTRAINT "knowledge_document_reviews_reviewer_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge_documents" DROP CONSTRAINT "knowledge_documents_uploaded_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "methodology_events" DROP CONSTRAINT "methodology_events_actor_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "methodology_versions" DROP CONSTRAINT "methodology_versions_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "professional_assignments" DROP CONSTRAINT "professional_assignments_professional_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_actor_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_config" DROP CONSTRAINT "agent_config_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "model_pricing" DROP CONSTRAINT "model_pricing_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "ad_spend" DROP CONSTRAINT "ad_spend_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "partners" DROP CONSTRAINT "partners_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "faq_entries" DROP CONSTRAINT "faq_entries_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "ai_guardrail_rules" DROP CONSTRAINT "ai_guardrail_rules_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "ai_forbidden_topics" DROP CONSTRAINT "ai_forbidden_topics_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "ai_forbidden_topics" DROP CONSTRAINT "ai_forbidden_topics_approved_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "exercise_catalog_entries" DROP CONSTRAINT "exercise_catalog_entries_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "protocol_substitution_requests" DROP CONSTRAINT "protocol_substitution_requests_decided_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_professional_id_staff_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_staff_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_document_events" ADD CONSTRAINT "knowledge_document_events_actor_id_staff_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_document_reviews" ADD CONSTRAINT "knowledge_document_reviews_reviewer_id_staff_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_uploaded_by_staff_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "methodology_events" ADD CONSTRAINT "methodology_events_actor_id_staff_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "methodology_versions" ADD CONSTRAINT "methodology_versions_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_assignments" ADD CONSTRAINT "professional_assignments_professional_id_staff_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_config" ADD CONSTRAINT "agent_config_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_pricing" ADD CONSTRAINT "model_pricing_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_spend" ADD CONSTRAINT "ad_spend_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faq_entries" ADD CONSTRAINT "faq_entries_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_guardrail_rules" ADD CONSTRAINT "ai_guardrail_rules_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_forbidden_topics" ADD CONSTRAINT "ai_forbidden_topics_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_forbidden_topics" ADD CONSTRAINT "ai_forbidden_topics_approved_by_staff_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_catalog_entries" ADD CONSTRAINT "exercise_catalog_entries_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_substitution_requests" ADD CONSTRAINT "protocol_substitution_requests_decided_by_staff_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- As FKs que apontavam para essas linhas em "users" já foram repontadas para "staff"
-- acima (mesmo id) — seguro remover a duplicata da tabela antiga agora.
DELETE FROM "users" WHERE "role" <> 'USER';--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "password_hash";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "cref_number";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "cref_region";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "cref_active";