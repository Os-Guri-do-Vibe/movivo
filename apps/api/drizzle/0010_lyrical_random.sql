ALTER TYPE "public"."subscription_plan" ADD VALUE 'SEMIANNUAL';--> statement-breakpoint
ALTER TYPE "public"."subscription_status" ADD VALUE 'PAUSED';--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "terms_version" varchar(30);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "terms_accepted_at" timestamp with time zone;