-- Fila do Profissional: cada protocolo gerado pela IA espera a revisão de um profissional.
-- `review_urgency` separa a revisão obrigatória (só sai com a liberação humana) da opcional
-- (liberada sozinha em `auto_release_at`, 2h depois de entrar na fila).
ALTER TABLE "exception_cases" ADD COLUMN "review_urgency" varchar(9);--> statement-breakpoint
ALTER TABLE "exception_cases" ADD COLUMN "auto_release_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "exception_cases" DROP CONSTRAINT "ck_exception_cases_kind";--> statement-breakpoint
ALTER TABLE "exception_cases" ADD CONSTRAINT "ck_exception_cases_kind" CHECK ("exception_cases"."kind" in ('SAFETY', 'NO_APPLICABLE_POLICY', 'PROTOCOL_REVIEW', 'STUDENT_REVIEW_REQUEST', 'DECISION_FAILURE', 'CONVERSATION_TAKEOVER', 'MEDICAL_EXAM'));--> statement-breakpoint
ALTER TABLE "exception_cases" ADD CONSTRAINT "ck_exception_cases_review_urgency" CHECK ("exception_cases"."review_urgency" in ('MANDATORY', 'OPTIONAL'));--> statement-breakpoint
ALTER TABLE "exception_cases" ADD CONSTRAINT "ck_exception_cases_auto_release" CHECK (("exception_cases"."review_urgency" = 'OPTIONAL') = ("exception_cases"."auto_release_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "coaching_decisions" DROP CONSTRAINT "ck_coaching_decisions_decided_by";--> statement-breakpoint
ALTER TABLE "coaching_decisions" ADD CONSTRAINT "ck_coaching_decisions_decided_by" CHECK ("coaching_decisions"."decided_by" in ('POLICY_ENGINE', 'STAFF', 'AUTO_RELEASE'));
