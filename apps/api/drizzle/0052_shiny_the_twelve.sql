CREATE TABLE "short_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(16) NOT NULL,
	"target_url" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_short_links_code_len" CHECK (char_length("short_links"."code") between 6 and 16)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_short_links_code" ON "short_links" USING btree ("code");