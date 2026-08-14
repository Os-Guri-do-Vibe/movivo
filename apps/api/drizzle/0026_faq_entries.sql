CREATE TYPE "public"."faq_entry_status" AS ENUM('PUBLISHED', 'RETIRED');--> statement-breakpoint
CREATE TABLE "faq_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"faq_key" uuid NOT NULL,
	"canonical_question" text NOT NULL,
	"normalized_question" text NOT NULL,
	"answer" text NOT NULL,
	"version" integer NOT NULL,
	"status" "faq_entry_status" DEFAULT 'PUBLISHED' NOT NULL,
	"change_note" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_faq_entries_key_version" UNIQUE("faq_key","version")
);--> statement-breakpoint
ALTER TABLE "faq_entries" ADD CONSTRAINT "faq_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_faq_entries_lookup" ON "faq_entries" USING btree ("normalized_question","created_at");--> statement-breakpoint
CREATE INDEX "idx_faq_entries_key" ON "faq_entries" USING btree ("faq_key","version");
