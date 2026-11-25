CREATE TABLE "agent_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent" varchar(24) NOT NULL,
	"version" integer NOT NULL,
	"status" varchar(16) DEFAULT 'DRAFT' NOT NULL,
	"content" text NOT NULL,
	"change_note" text NOT NULL,
	"eval_run_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_agent_profiles_agent_version" UNIQUE("agent","version"),
	CONSTRAINT "ck_agent_profiles_agent" CHECK ("agent_profiles"."agent" in ('COORDINATOR', 'STRATEGY', 'STRENGTH', 'RUNNING', 'HYROX', 'HYBRID', 'NUTRITION', 'COMMUNICATION')),
	CONSTRAINT "ck_agent_profiles_status" CHECK ("agent_profiles"."status" in ('DRAFT', 'TESTING', 'PUBLISHED', 'SUPERSEDED', 'DISCARDED'))
);
--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD CONSTRAINT "agent_profiles_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD CONSTRAINT "agent_profiles_published_by_staff_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_agent_profiles_one_published" ON "agent_profiles" USING btree ("agent") WHERE "agent_profiles"."status" = 'PUBLISHED';--> statement-breakpoint
CREATE INDEX "idx_agent_profiles_agent" ON "agent_profiles" USING btree ("agent","status");