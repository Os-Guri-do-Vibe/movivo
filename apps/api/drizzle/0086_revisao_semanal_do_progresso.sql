CREATE TABLE "weekly_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"status" varchar(16) NOT NULL,
	"metrics" jsonb NOT NULL,
	"signals" jsonb NOT NULL,
	"record" jsonb NOT NULL,
	"model_run_id" uuid,
	"proposal_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_weekly_reviews_user_week" UNIQUE("user_id","week_start"),
	CONSTRAINT "ck_weekly_reviews_status" CHECK ("weekly_reviews"."status" in ('ON_TRACK', 'ATTENTION', 'OFF_TRACK'))
);
--> statement-breakpoint
ALTER TABLE "weekly_reviews" ADD CONSTRAINT "weekly_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_weekly_reviews_user" ON "weekly_reviews" USING btree ("user_id","week_start");