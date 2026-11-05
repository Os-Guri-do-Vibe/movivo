-- Arquivamento do legado: cópia fiel (CTAS) de cada tabela com dado de aluno ou prova profissional,
-- guardada por 5 anos em tabelas `legacy_*_archive` somente leitura (RLS FORCE + triggers).
-- O corte (DROP) vem logo depois, na mesma transação do migrador.
CREATE TABLE "legacy_protocols_archive" AS TABLE "protocols";
--> statement-breakpoint
CREATE TABLE "legacy_protocol_versions_archive" AS TABLE "protocol_versions";
--> statement-breakpoint
CREATE TABLE "legacy_protocol_renewal_sessions_archive" AS TABLE "protocol_renewal_sessions";
--> statement-breakpoint
CREATE TABLE "legacy_protocol_substitution_requests_archive" AS TABLE "protocol_substitution_requests";
--> statement-breakpoint
CREATE TABLE "legacy_checkins_archive" AS TABLE "checkins";
--> statement-breakpoint
CREATE TABLE "legacy_handoff_alerts_archive" AS TABLE "handoff_alerts";
--> statement-breakpoint
CREATE TABLE "legacy_conversation_followups_archive" AS TABLE "conversation_followups";
--> statement-breakpoint
CREATE TABLE "legacy_coaching_sessions_archive" AS TABLE "coaching_sessions";
--> statement-breakpoint
CREATE TABLE "legacy_workout_sessions_archive" AS TABLE "workout_sessions";
--> statement-breakpoint
CREATE TABLE "legacy_workout_set_entries_archive" AS TABLE "workout_set_entries";
--> statement-breakpoint
CREATE TABLE "legacy_workout_completions_archive" AS TABLE "workout_completions";
--> statement-breakpoint
CREATE TABLE "legacy_workout_insights_archive" AS TABLE "workout_insights";
--> statement-breakpoint
CREATE TABLE "legacy_workout_schedule_adjustments_archive" AS TABLE "workout_schedule_adjustments";
--> statement-breakpoint
CREATE TABLE "legacy_professional_assignments_archive" AS TABLE "professional_assignments";
--> statement-breakpoint
CREATE TABLE "legacy_agent_config_archive" AS TABLE "agent_config";
--> statement-breakpoint
CREATE TABLE "legacy_methodology_versions_archive" AS TABLE "methodology_versions";
--> statement-breakpoint
CREATE TABLE "legacy_methodology_events_archive" AS TABLE "methodology_events";
--> statement-breakpoint
CREATE TABLE "legacy_conversation_protocol_links_archive" AS
  SELECT "id" AS "conversation_id", "user_id", "protocol_id" FROM "conversations" WHERE "protocol_id" IS NOT NULL;
--> statement-breakpoint
DO $$
DECLARE col record;
BEGIN
  FOR col IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name LIKE 'legacy\_%\_archive' AND c.data_type = 'USER-DEFINED'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I TYPE text', col.table_name, col.column_name);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.legacy_archive_reject_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'legacy archive is read-only' USING ERRCODE = '55000';
END $$;
--> statement-breakpoint
ALTER TABLE "legacy_protocols_archive" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "legacy_protocols_archive" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "legacy_protocols_archive_rls_select" ON "legacy_protocols_archive" FOR SELECT USING (nullif(current_setting('app.current_role', true), '') IN ('SYSTEM', 'ADMIN'));
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_protocols_archive_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "legacy_protocols_archive" FOR EACH ROW EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_protocols_archive_no_truncate" BEFORE TRUNCATE ON "legacy_protocols_archive" FOR EACH STATEMENT EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
ALTER TABLE "legacy_protocol_versions_archive" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "legacy_protocol_versions_archive" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "legacy_protocol_versions_archive_rls_select" ON "legacy_protocol_versions_archive" FOR SELECT USING (nullif(current_setting('app.current_role', true), '') IN ('SYSTEM', 'ADMIN'));
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_protocol_versions_archive_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "legacy_protocol_versions_archive" FOR EACH ROW EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_protocol_versions_archive_no_truncate" BEFORE TRUNCATE ON "legacy_protocol_versions_archive" FOR EACH STATEMENT EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
ALTER TABLE "legacy_protocol_renewal_sessions_archive" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "legacy_protocol_renewal_sessions_archive" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "legacy_protocol_renewal_sessions_archive_rls_select" ON "legacy_protocol_renewal_sessions_archive" FOR SELECT USING (nullif(current_setting('app.current_role', true), '') IN ('SYSTEM', 'ADMIN'));
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_protocol_renewal_sessions_archive_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "legacy_protocol_renewal_sessions_archive" FOR EACH ROW EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_protocol_renewal_sessions_archive_no_truncate" BEFORE TRUNCATE ON "legacy_protocol_renewal_sessions_archive" FOR EACH STATEMENT EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
ALTER TABLE "legacy_protocol_substitution_requests_archive" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "legacy_protocol_substitution_requests_archive" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "legacy_protocol_substitution_requests_archive_rls_select" ON "legacy_protocol_substitution_requests_archive" FOR SELECT USING (nullif(current_setting('app.current_role', true), '') IN ('SYSTEM', 'ADMIN'));
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_protocol_substitution_requests_archive_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "legacy_protocol_substitution_requests_archive" FOR EACH ROW EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_protocol_substitution_requests_archive_no_truncate" BEFORE TRUNCATE ON "legacy_protocol_substitution_requests_archive" FOR EACH STATEMENT EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
ALTER TABLE "legacy_checkins_archive" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "legacy_checkins_archive" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "legacy_checkins_archive_rls_select" ON "legacy_checkins_archive" FOR SELECT USING (nullif(current_setting('app.current_role', true), '') IN ('SYSTEM', 'ADMIN'));
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_checkins_archive_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "legacy_checkins_archive" FOR EACH ROW EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_checkins_archive_no_truncate" BEFORE TRUNCATE ON "legacy_checkins_archive" FOR EACH STATEMENT EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
ALTER TABLE "legacy_handoff_alerts_archive" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "legacy_handoff_alerts_archive" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "legacy_handoff_alerts_archive_rls_select" ON "legacy_handoff_alerts_archive" FOR SELECT USING (nullif(current_setting('app.current_role', true), '') IN ('SYSTEM', 'ADMIN'));
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_handoff_alerts_archive_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "legacy_handoff_alerts_archive" FOR EACH ROW EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_handoff_alerts_archive_no_truncate" BEFORE TRUNCATE ON "legacy_handoff_alerts_archive" FOR EACH STATEMENT EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
ALTER TABLE "legacy_conversation_followups_archive" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "legacy_conversation_followups_archive" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "legacy_conversation_followups_archive_rls_select" ON "legacy_conversation_followups_archive" FOR SELECT USING (nullif(current_setting('app.current_role', true), '') IN ('SYSTEM', 'ADMIN'));
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_conversation_followups_archive_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "legacy_conversation_followups_archive" FOR EACH ROW EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_conversation_followups_archive_no_truncate" BEFORE TRUNCATE ON "legacy_conversation_followups_archive" FOR EACH STATEMENT EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
ALTER TABLE "legacy_coaching_sessions_archive" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "legacy_coaching_sessions_archive" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "legacy_coaching_sessions_archive_rls_select" ON "legacy_coaching_sessions_archive" FOR SELECT USING (nullif(current_setting('app.current_role', true), '') IN ('SYSTEM', 'ADMIN'));
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_coaching_sessions_archive_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "legacy_coaching_sessions_archive" FOR EACH ROW EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_coaching_sessions_archive_no_truncate" BEFORE TRUNCATE ON "legacy_coaching_sessions_archive" FOR EACH STATEMENT EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
ALTER TABLE "legacy_workout_sessions_archive" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "legacy_workout_sessions_archive" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "legacy_workout_sessions_archive_rls_select" ON "legacy_workout_sessions_archive" FOR SELECT USING (nullif(current_setting('app.current_role', true), '') IN ('SYSTEM', 'ADMIN'));
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_workout_sessions_archive_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "legacy_workout_sessions_archive" FOR EACH ROW EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_workout_sessions_archive_no_truncate" BEFORE TRUNCATE ON "legacy_workout_sessions_archive" FOR EACH STATEMENT EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
ALTER TABLE "legacy_workout_set_entries_archive" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "legacy_workout_set_entries_archive" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "legacy_workout_set_entries_archive_rls_select" ON "legacy_workout_set_entries_archive" FOR SELECT USING (nullif(current_setting('app.current_role', true), '') IN ('SYSTEM', 'ADMIN'));
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_workout_set_entries_archive_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "legacy_workout_set_entries_archive" FOR EACH ROW EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_workout_set_entries_archive_no_truncate" BEFORE TRUNCATE ON "legacy_workout_set_entries_archive" FOR EACH STATEMENT EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
ALTER TABLE "legacy_workout_completions_archive" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "legacy_workout_completions_archive" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "legacy_workout_completions_archive_rls_select" ON "legacy_workout_completions_archive" FOR SELECT USING (nullif(current_setting('app.current_role', true), '') IN ('SYSTEM', 'ADMIN'));
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_workout_completions_archive_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "legacy_workout_completions_archive" FOR EACH ROW EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_workout_completions_archive_no_truncate" BEFORE TRUNCATE ON "legacy_workout_completions_archive" FOR EACH STATEMENT EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
ALTER TABLE "legacy_workout_insights_archive" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "legacy_workout_insights_archive" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "legacy_workout_insights_archive_rls_select" ON "legacy_workout_insights_archive" FOR SELECT USING (nullif(current_setting('app.current_role', true), '') IN ('SYSTEM', 'ADMIN'));
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_workout_insights_archive_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "legacy_workout_insights_archive" FOR EACH ROW EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_workout_insights_archive_no_truncate" BEFORE TRUNCATE ON "legacy_workout_insights_archive" FOR EACH STATEMENT EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
ALTER TABLE "legacy_workout_schedule_adjustments_archive" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "legacy_workout_schedule_adjustments_archive" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "legacy_workout_schedule_adjustments_archive_rls_select" ON "legacy_workout_schedule_adjustments_archive" FOR SELECT USING (nullif(current_setting('app.current_role', true), '') IN ('SYSTEM', 'ADMIN'));
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_workout_schedule_adjustments_archive_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "legacy_workout_schedule_adjustments_archive" FOR EACH ROW EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_workout_schedule_adjustments_archive_no_truncate" BEFORE TRUNCATE ON "legacy_workout_schedule_adjustments_archive" FOR EACH STATEMENT EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
ALTER TABLE "legacy_professional_assignments_archive" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "legacy_professional_assignments_archive" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "legacy_professional_assignments_archive_rls_select" ON "legacy_professional_assignments_archive" FOR SELECT USING (nullif(current_setting('app.current_role', true), '') IN ('SYSTEM', 'ADMIN'));
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_professional_assignments_archive_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "legacy_professional_assignments_archive" FOR EACH ROW EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_professional_assignments_archive_no_truncate" BEFORE TRUNCATE ON "legacy_professional_assignments_archive" FOR EACH STATEMENT EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
ALTER TABLE "legacy_agent_config_archive" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "legacy_agent_config_archive" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "legacy_agent_config_archive_rls_select" ON "legacy_agent_config_archive" FOR SELECT USING (nullif(current_setting('app.current_role', true), '') IN ('SYSTEM', 'ADMIN'));
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_agent_config_archive_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "legacy_agent_config_archive" FOR EACH ROW EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_agent_config_archive_no_truncate" BEFORE TRUNCATE ON "legacy_agent_config_archive" FOR EACH STATEMENT EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
ALTER TABLE "legacy_methodology_versions_archive" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "legacy_methodology_versions_archive" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "legacy_methodology_versions_archive_rls_select" ON "legacy_methodology_versions_archive" FOR SELECT USING (nullif(current_setting('app.current_role', true), '') IN ('SYSTEM', 'ADMIN'));
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_methodology_versions_archive_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "legacy_methodology_versions_archive" FOR EACH ROW EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_methodology_versions_archive_no_truncate" BEFORE TRUNCATE ON "legacy_methodology_versions_archive" FOR EACH STATEMENT EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
ALTER TABLE "legacy_methodology_events_archive" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "legacy_methodology_events_archive" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "legacy_methodology_events_archive_rls_select" ON "legacy_methodology_events_archive" FOR SELECT USING (nullif(current_setting('app.current_role', true), '') IN ('SYSTEM', 'ADMIN'));
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_methodology_events_archive_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "legacy_methodology_events_archive" FOR EACH ROW EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_methodology_events_archive_no_truncate" BEFORE TRUNCATE ON "legacy_methodology_events_archive" FOR EACH STATEMENT EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
ALTER TABLE "legacy_conversation_protocol_links_archive" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "legacy_conversation_protocol_links_archive" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "legacy_conversation_protocol_links_archive_rls_select" ON "legacy_conversation_protocol_links_archive" FOR SELECT USING (nullif(current_setting('app.current_role', true), '') IN ('SYSTEM', 'ADMIN'));
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_conversation_protocol_links_archive_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "legacy_conversation_protocol_links_archive" FOR EACH ROW EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER "trg_legacy_conversation_protocol_links_archive_no_truncate" BEFORE TRUNCATE ON "legacy_conversation_protocol_links_archive" FOR EACH STATEMENT EXECUTE FUNCTION public.legacy_archive_reject_mutation();
--> statement-breakpoint
CREATE TABLE "training_access_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(12) NOT NULL,
	"token_hash" char(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_training_access_tokens_kind" CHECK ("training_access_tokens"."kind" in ('MAGIC', 'SESSION'))
);
--> statement-breakpoint
ALTER TABLE "protocols" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "protocol_versions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkins" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_jobs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "handoff_alerts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dashboard_notification_reads" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "coaching_sessions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "methodology_events" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "methodology_versions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "intent_examples" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "professional_assignments" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_config" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workout_completions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workout_access_tokens" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workout_insights" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workout_sessions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workout_set_entries" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workout_schedule_adjustments" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversation_followups" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "protocol_substitution_requests" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "protocol_renewal_sessions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "protocols" CASCADE;--> statement-breakpoint
DROP TABLE "protocol_versions" CASCADE;--> statement-breakpoint
DROP TABLE "checkins" CASCADE;--> statement-breakpoint
DROP TABLE "ai_jobs" CASCADE;--> statement-breakpoint
DROP TABLE "handoff_alerts" CASCADE;--> statement-breakpoint
DROP TABLE "dashboard_notification_reads" CASCADE;--> statement-breakpoint
DROP TABLE "coaching_sessions" CASCADE;--> statement-breakpoint
DROP TABLE "methodology_events" CASCADE;--> statement-breakpoint
DROP TABLE "methodology_versions" CASCADE;--> statement-breakpoint
DROP TABLE "intent_examples" CASCADE;--> statement-breakpoint
DROP TABLE "professional_assignments" CASCADE;--> statement-breakpoint
DROP TABLE "agent_config" CASCADE;--> statement-breakpoint
DROP TABLE "workout_completions" CASCADE;--> statement-breakpoint
DROP TABLE "workout_insights" CASCADE;--> statement-breakpoint
DROP TABLE "workout_sessions" CASCADE;--> statement-breakpoint
DROP TABLE "workout_set_entries" CASCADE;--> statement-breakpoint
DROP TABLE "workout_schedule_adjustments" CASCADE;--> statement-breakpoint
DROP TABLE "conversation_followups" CASCADE;--> statement-breakpoint
DROP TABLE "protocol_substitution_requests" CASCADE;--> statement-breakpoint
DROP TABLE "protocol_renewal_sessions" CASCADE;--> statement-breakpoint
DROP INDEX "idx_conversations_protocol";--> statement-breakpoint
ALTER TABLE "training_access_tokens" ADD CONSTRAINT "training_access_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_training_access_tokens_hash" ON "training_access_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_training_access_tokens_user" ON "training_access_tokens" USING btree ("user_id","expires_at");--> statement-breakpoint
INSERT INTO "training_access_tokens" ("id", "user_id", "kind", "token_hash", "expires_at", "consumed_at", "revoked_at", "last_used_at", "created_at", "updated_at")
  SELECT "id", "user_id", "kind", "token_hash", "expires_at", "consumed_at", "revoked_at", "last_used_at", "created_at", "updated_at" FROM "workout_access_tokens";
--> statement-breakpoint
ALTER TABLE "conversations" DROP COLUMN "protocol_id";--> statement-breakpoint
DROP TYPE "public"."ai_job_status";--> statement-breakpoint
DROP TYPE "public"."ai_job_type";--> statement-breakpoint
DROP TYPE "public"."checkin_weekly_status";--> statement-breakpoint
DROP TYPE "public"."handoff_level";--> statement-breakpoint
DROP TYPE "public"."handoff_status";--> statement-breakpoint
DROP TYPE "public"."protocol_approval_status";--> statement-breakpoint
DROP TYPE "public"."protocol_renewal_status";--> statement-breakpoint
DROP TYPE "public"."protocol_status";--> statement-breakpoint
DROP TYPE "public"."review_urgency";--> statement-breakpoint
DROP TYPE "public"."substitution_request_status";--> statement-breakpoint
DROP TYPE "public"."workout_completion_source";--> statement-breakpoint
DROP TYPE "public"."methodology_status";--> statement-breakpoint
DROP TYPE "public"."agent_config_status";
--> statement-breakpoint
DROP TABLE "workout_access_tokens" CASCADE;
--> statement-breakpoint
DROP FUNCTION IF EXISTS public.assign_unique_active_professional(uuid);
--> statement-breakpoint
DROP FUNCTION IF EXISTS public.assigned_active_professional(uuid);
--> statement-breakpoint
DROP FUNCTION IF EXISTS public.release_parq_on_signature(uuid);
--> statement-breakpoint
DROP FUNCTION IF EXISTS public.release_parq_clearance(uuid, public.parq_state);
--> statement-breakpoint
DROP FUNCTION IF EXISTS public.agent_config_reject_mutation();
