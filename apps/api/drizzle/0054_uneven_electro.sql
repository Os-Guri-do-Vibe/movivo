ALTER TABLE "anamnesis_sessions" ADD COLUMN "selected_plan" "subscription_plan" DEFAULT 'MONTHLY' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "external_customer_id" varchar(255);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "external_checkout_session_id" varchar(255);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "external_price_id" varchar(255);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "trial_started_at" timestamp with time zone;--> statement-breakpoint
UPDATE "subscriptions" SET "trial_started_at" = "created_at" WHERE "trial_started_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_subscriptions_external_checkout_session" ON "subscriptions" USING btree ("external_checkout_session_id");
