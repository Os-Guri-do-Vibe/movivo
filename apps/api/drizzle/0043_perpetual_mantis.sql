ALTER TYPE "public"."workout_completion_source" ADD VALUE 'WEB_JOURNAL' BEFORE 'WHATSAPP_QUICK_REPLY';--> statement-breakpoint
CREATE TABLE "workout_access_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workout_session_id" uuid,
	"kind" varchar(12) NOT NULL,
	"token_hash" char(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_workout_access_tokens_kind" CHECK ("workout_access_tokens"."kind" in ('MAGIC', 'SESSION'))
);
--> statement-breakpoint
CREATE TABLE "workout_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(50) NOT NULL,
	"window_started_at" date NOT NULL,
	"observed_value" integer NOT NULL,
	"expected_value" integer NOT NULL,
	"status" varchar(20) DEFAULT 'SENT' NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_workout_insights_user_kind_window" UNIQUE("user_id","kind","window_started_at"),
	CONSTRAINT "ck_workout_insights_status" CHECK ("workout_insights"."status" in ('SENT', 'ADJUST_REQUESTED', 'ACKNOWLEDGED'))
);
--> statement-breakpoint
CREATE TABLE "workout_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"protocol_id" uuid NOT NULL,
	"protocol_version" smallint NOT NULL,
	"week_number" smallint NOT NULL,
	"session_key" varchar(60) NOT NULL,
	"scheduled_date" date NOT NULL,
	"prescription" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'PLANNED' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_seconds" integer,
	"perceived_effort" smallint,
	"feedback_cipher" "bytea",
	"pain_reported" boolean DEFAULT false NOT NULL,
	"pain_exercise_id" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_workout_sessions_user_day_session" UNIQUE("user_id","scheduled_date","session_key"),
	CONSTRAINT "ck_workout_sessions_week" CHECK ("workout_sessions"."week_number" between 1 and 52),
	CONSTRAINT "ck_workout_sessions_status" CHECK ("workout_sessions"."status" in ('PLANNED', 'IN_PROGRESS', 'COMPLETED')),
	CONSTRAINT "ck_workout_sessions_effort" CHECK ("workout_sessions"."perceived_effort" is null or "workout_sessions"."perceived_effort" between 1 and 10),
	CONSTRAINT "ck_workout_sessions_duration" CHECK ("workout_sessions"."duration_seconds" is null or "workout_sessions"."duration_seconds" between 0 and 43200)
);
--> statement-breakpoint
CREATE TABLE "workout_set_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workout_session_id" uuid NOT NULL,
	"exercise_id" varchar(80) NOT NULL,
	"set_number" smallint NOT NULL,
	"reps" smallint,
	"load_value" numeric(7, 2),
	"load_unit" varchar(12) DEFAULT 'KG' NOT NULL,
	"duration_seconds" integer,
	"completed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_workout_set_entries_session_exercise_set" UNIQUE("workout_session_id","exercise_id","set_number"),
	CONSTRAINT "ck_workout_set_entries_set" CHECK ("workout_set_entries"."set_number" between 1 and 20),
	CONSTRAINT "ck_workout_set_entries_reps" CHECK ("workout_set_entries"."reps" is null or "workout_set_entries"."reps" between 0 and 300),
	CONSTRAINT "ck_workout_set_entries_load" CHECK ("workout_set_entries"."load_value" is null or "workout_set_entries"."load_value" between 0 and 2000),
	CONSTRAINT "ck_workout_set_entries_duration" CHECK ("workout_set_entries"."duration_seconds" is null or "workout_set_entries"."duration_seconds" between 0 and 14400),
	CONSTRAINT "ck_workout_set_entries_unit" CHECK ("workout_set_entries"."load_unit" in ('KG', 'LB', 'BODYWEIGHT', 'NONE'))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "timezone" varchar(64) DEFAULT 'America/Sao_Paulo' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "workout_reminder_time" varchar(5) DEFAULT '05:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "workout_reminder_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_access_tokens" ADD CONSTRAINT "workout_access_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_access_tokens" ADD CONSTRAINT "workout_access_tokens_workout_session_id_workout_sessions_id_fk" FOREIGN KEY ("workout_session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_insights" ADD CONSTRAINT "workout_insights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_protocol_id_protocols_id_fk" FOREIGN KEY ("protocol_id") REFERENCES "public"."protocols"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_set_entries" ADD CONSTRAINT "workout_set_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_set_entries" ADD CONSTRAINT "workout_set_entries_workout_session_id_workout_sessions_id_fk" FOREIGN KEY ("workout_session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_workout_access_tokens_hash" ON "workout_access_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_workout_access_tokens_user" ON "workout_access_tokens" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "idx_workout_insights_user" ON "workout_insights" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_workout_sessions_user_date" ON "workout_sessions" USING btree ("user_id","scheduled_date");--> statement-breakpoint
CREATE INDEX "idx_workout_set_entries_user_exercise" ON "workout_set_entries" USING btree ("user_id","exercise_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "ck_users_workout_reminder_time" CHECK ("users"."workout_reminder_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');