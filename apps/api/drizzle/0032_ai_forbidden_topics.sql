CREATE TYPE "public"."ai_forbidden_topic_action" AS ENUM('BLOCK');--> statement-breakpoint
CREATE TYPE "public"."ai_forbidden_topic_status" AS ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'RETIRED');--> statement-breakpoint
CREATE TABLE "ai_forbidden_topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_key" text NOT NULL,
	"label" text NOT NULL,
	"phrases" jsonb NOT NULL,
	"action" "ai_forbidden_topic_action" DEFAULT 'BLOCK' NOT NULL,
	"version" integer NOT NULL,
	"status" "ai_forbidden_topic_status" DEFAULT 'DRAFT' NOT NULL,
	"change_note" text NOT NULL,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_ai_forbidden_topics_key_version" UNIQUE("topic_key","version"),
	CONSTRAINT "ck_ai_forbidden_topics_action_block" CHECK ("ai_forbidden_topics"."action" = 'BLOCK'),
	CONSTRAINT "ck_ai_forbidden_topics_maker_checker" CHECK ("ai_forbidden_topics"."approved_by" IS NULL OR "ai_forbidden_topics"."approved_by" <> "ai_forbidden_topics"."created_by")
);
--> statement-breakpoint
ALTER TABLE "methodology_versions" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "ai_forbidden_topics" ADD CONSTRAINT "ai_forbidden_topics_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_forbidden_topics" ADD CONSTRAINT "ai_forbidden_topics_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_forbidden_topics_key" ON "ai_forbidden_topics" USING btree ("topic_key","version");