ALTER TABLE "subscriptions" ADD COLUMN "checkout_url" varchar(500);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "activated_at" timestamp with time zone;--> statement-breakpoint
UPDATE "subscriptions" SET "activated_at" = "current_period_start" WHERE "current_period_start" IS NOT NULL AND "activated_at" IS NULL;
