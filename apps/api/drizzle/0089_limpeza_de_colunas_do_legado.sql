ALTER TABLE "users" DROP CONSTRAINT "ck_users_workout_reminder_time";--> statement-breakpoint
ALTER TABLE "access_link_tokens" DROP CONSTRAINT "ck_access_link_tokens_purpose";--> statement-breakpoint
DELETE FROM "access_link_tokens" WHERE "purpose" = 'PROTOCOL';--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "workout_reminder_time";--> statement-breakpoint
ALTER TABLE "access_link_tokens" ADD CONSTRAINT "ck_access_link_tokens_purpose" CHECK ("access_link_tokens"."purpose" in ('PLAN', 'CHECKOUT', 'SUBSCRIPTION_PORTAL'));