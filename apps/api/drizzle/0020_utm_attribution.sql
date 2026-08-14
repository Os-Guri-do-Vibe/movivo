ALTER TABLE "anamnesis_sessions" ADD COLUMN "utm_source" varchar(120);--> statement-breakpoint
ALTER TABLE "anamnesis_sessions" ADD COLUMN "utm_medium" varchar(120);--> statement-breakpoint
ALTER TABLE "anamnesis_sessions" ADD COLUMN "utm_campaign" varchar(120);--> statement-breakpoint
ALTER TABLE "anamnesis_sessions" ADD COLUMN "utm_content" varchar(120);--> statement-breakpoint
ALTER TABLE "anamnesis_sessions" ADD COLUMN "referrer_host" varchar(253);--> statement-breakpoint
ALTER TABLE "anamnesis_sessions" ADD COLUMN "first_touch_at" timestamp with time zone;