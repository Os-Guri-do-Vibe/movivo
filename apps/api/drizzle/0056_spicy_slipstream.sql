ALTER TYPE "public"."subscription_status" ADD VALUE 'PENDING_PAYMENT' BEFORE 'ACTIVE';--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "monthly_price_cents" integer;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "total_price_cents" integer;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "commitment_months" integer;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "external_payment_id" varchar(255);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "external_installment_id" varchar(255);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "external_authorization_id" varchar(255);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "payment_method" varchar(30);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "installment_count" integer;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "authorized_payment_count" integer;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "payment_attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "next_billing_at" timestamp with time zone;--> statement-breakpoint
-- Backfill não destrutivo: conserva o total histórico em `price_cents` e deriva apenas os
-- snapshots ausentes. O enum STRIPE permanece para registros fiscais legados.
UPDATE "subscriptions"
SET "total_price_cents" = "price_cents",
    "commitment_months" = CASE "plan"
      WHEN 'MONTHLY' THEN 1
      WHEN 'QUARTERLY' THEN 3
      WHEN 'SEMIANNUAL' THEN 6
      WHEN 'ANNUAL' THEN 12
    END,
    "monthly_price_cents" = CASE "plan"
      WHEN 'MONTHLY' THEN "price_cents"
      WHEN 'QUARTERLY' THEN ROUND("price_cents" / 3.0)::integer
      WHEN 'SEMIANNUAL' THEN ROUND("price_cents" / 6.0)::integer
      WHEN 'ANNUAL' THEN ROUND("price_cents" / 12.0)::integer
    END
WHERE "total_price_cents" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_subscriptions_external_payment" ON "subscriptions" USING btree ("external_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_subscriptions_external_installment" ON "subscriptions" USING btree ("external_installment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_subscriptions_external_authorization" ON "subscriptions" USING btree ("external_authorization_id");
