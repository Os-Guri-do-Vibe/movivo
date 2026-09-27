CREATE TABLE "exercise_catalog_favorites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exercise_key" text NOT NULL,
	"favorited_by" uuid NOT NULL,
	"favorited_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_exercise_catalog_favorites_key" UNIQUE("exercise_key")
);
--> statement-breakpoint
ALTER TABLE "exercise_catalog_favorites" ADD CONSTRAINT "exercise_catalog_favorites_favorited_by_staff_id_fk" FOREIGN KEY ("favorited_by") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;