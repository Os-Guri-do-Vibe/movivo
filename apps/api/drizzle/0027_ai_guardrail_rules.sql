CREATE TYPE "public"."ai_guardrail_scope" AS ENUM('INPUT', 'OUTPUT', 'BOTH');--> statement-breakpoint
CREATE TYPE "public"."ai_guardrail_action" AS ENUM('FLAG');--> statement-breakpoint
CREATE TYPE "public"."ai_guardrail_status" AS ENUM('PUBLISHED', 'RETIRED');--> statement-breakpoint
CREATE TABLE "ai_guardrail_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_key" uuid NOT NULL,
	"label" text NOT NULL,
	"scope" "ai_guardrail_scope" NOT NULL,
	"phrases" jsonb NOT NULL,
	"action" "ai_guardrail_action" DEFAULT 'FLAG' NOT NULL,
	"version" integer NOT NULL,
	"status" "ai_guardrail_status" DEFAULT 'PUBLISHED' NOT NULL,
	"change_note" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_ai_guardrail_rules_key_version" UNIQUE("rule_key","version")
);--> statement-breakpoint
ALTER TABLE "ai_guardrail_rules" ADD CONSTRAINT "ai_guardrail_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_guardrail_rules_key" ON "ai_guardrail_rules" USING btree ("rule_key","version");
