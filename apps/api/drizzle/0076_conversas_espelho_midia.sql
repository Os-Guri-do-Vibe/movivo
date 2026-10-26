ALTER TABLE "conversations" ADD COLUMN "mirror" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "hidden_in_panel" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "media_path" varchar(80);--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "media_mime" varchar(100);--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "media_bytes" integer;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "media_seconds" integer;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "media_status" varchar(8);