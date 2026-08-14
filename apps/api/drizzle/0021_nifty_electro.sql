CREATE TYPE "public"."workout_completion_source" AS ENUM('WHATSAPP_QUICK_REPLY', 'CHECKIN', 'CONVERSATION');--> statement-breakpoint
CREATE TABLE "workout_completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"protocol_id" uuid NOT NULL,
	"protocol_version" smallint NOT NULL,
	"week_number" smallint NOT NULL,
	"session_key" varchar(60) NOT NULL,
	"completed_at" date NOT NULL,
	"source" "workout_completion_source" NOT NULL,
	"exercises_done" jsonb,
	"perceived_effort" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_workout_completions_user_day_session" UNIQUE("user_id","completed_at","session_key"),
	CONSTRAINT "ck_workout_completions_perceived_effort" CHECK ("workout_completions"."perceived_effort" is null or "workout_completions"."perceived_effort" between 1 and 10)
);
--> statement-breakpoint
ALTER TABLE "workout_completions" ADD CONSTRAINT "workout_completions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_completions" ADD CONSTRAINT "workout_completions_protocol_id_protocols_id_fk" FOREIGN KEY ("protocol_id") REFERENCES "public"."protocols"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_workout_completions_completed_at" ON "workout_completions" USING btree ("completed_at");