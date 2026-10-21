CREATE TABLE "workout_schedule_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"protocol_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"source" varchar(12) NOT NULL,
	"assignments" jsonb NOT NULL,
	"dropped" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"idempotency_key" varchar(80),
	"undone_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_workout_schedule_adjustments_idempotency" UNIQUE("user_id","idempotency_key"),
	CONSTRAINT "ck_workout_schedule_adjustments_kind" CHECK ("workout_schedule_adjustments"."kind" in ('TRAIN_ON','REST_ON','REORGANIZE','LATE_LOG')),
	CONSTRAINT "ck_workout_schedule_adjustments_source" CHECK ("workout_schedule_adjustments"."source" in ('CHAT','LATE_LOG'))
);
--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD COLUMN "logged_late" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_schedule_adjustments" ADD CONSTRAINT "workout_schedule_adjustments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_schedule_adjustments" ADD CONSTRAINT "workout_schedule_adjustments_protocol_id_protocols_id_fk" FOREIGN KEY ("protocol_id") REFERENCES "public"."protocols"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_workout_schedule_adjustments_user_active" ON "workout_schedule_adjustments" USING btree ("user_id","created_at") WHERE "workout_schedule_adjustments"."undone_at" is null;