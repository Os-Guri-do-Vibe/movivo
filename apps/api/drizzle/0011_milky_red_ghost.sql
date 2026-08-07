-- Sprint 5: schema-base do painel CREF, check-in cifrado, reengajamento e auditoria.
CREATE TABLE "professional_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"professional_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_professional_assignments_pair" UNIQUE("professional_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"action" varchar(80) NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" uuid NOT NULL,
	"changes" jsonb NOT NULL,
	"previous_hash" char(64),
	"row_hash" char(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reengagement_nudges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_reengagement_nudges_user_window" UNIQUE("user_id","window_started_at")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "cref_number" varchar(30);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "cref_region" varchar(2);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "cref_active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "checkins" ADD COLUMN "responses_cipher" "bytea";--> statement-breakpoint
ALTER TABLE "checkins" ADD COLUMN "current_question" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "checkins" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "professional_assignments" ADD CONSTRAINT "professional_assignments_professional_id_users_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_assignments" ADD CONSTRAINT "professional_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reengagement_nudges" ADD CONSTRAINT "reengagement_nudges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_professional_assignments_professional" ON "professional_assignments" USING btree ("professional_id","active");--> statement-breakpoint
CREATE INDEX "idx_professional_assignments_user" ON "professional_assignments" USING btree ("user_id","active");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_user_created" ON "audit_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_actor_created" ON "audit_logs" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_reengagement_nudges_user" ON "reengagement_nudges" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "ck_checkins_no_plaintext_responses" CHECK ("checkins"."responses" IS NULL);
