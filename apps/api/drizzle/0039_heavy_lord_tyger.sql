CREATE TYPE "public"."exercise_catalog_entry_status" AS ENUM('PUBLISHED', 'RETIRED');--> statement-breakpoint
CREATE TABLE "exercise_catalog_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exercise_key" text NOT NULL,
	"name" text NOT NULL,
	"pattern" text NOT NULL,
	"muscle_groups" jsonb NOT NULL,
	"equipment" jsonb NOT NULL,
	"locations" jsonb NOT NULL,
	"min_level" text NOT NULL,
	"contraindicated_for" jsonb NOT NULL,
	"substitutes" jsonb NOT NULL,
	"measurement" text,
	"duration_seconds_range" jsonb,
	"min_rest_seconds" integer,
	"version" integer NOT NULL,
	"status" "exercise_catalog_entry_status" DEFAULT 'PUBLISHED' NOT NULL,
	"change_note" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_exercise_catalog_entries_key_version" UNIQUE("exercise_key","version")
);
--> statement-breakpoint
ALTER TABLE "exercise_catalog_entries" ADD CONSTRAINT "exercise_catalog_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_exercise_catalog_entries_key" ON "exercise_catalog_entries" USING btree ("exercise_key","version");--> statement-breakpoint
CREATE INDEX "idx_exercise_catalog_entries_pattern" ON "exercise_catalog_entries" USING btree ("pattern");