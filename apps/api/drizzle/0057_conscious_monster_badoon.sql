ALTER TABLE "subscriptions" ADD CONSTRAINT "ck_subscriptions_monthly_price_positive" CHECK ("subscriptions"."monthly_price_cents" > 0);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "ck_subscriptions_total_price_positive" CHECK ("subscriptions"."total_price_cents" > 0);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "ck_subscriptions_commitment_months" CHECK ("subscriptions"."commitment_months" between 1 and 12);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "ck_subscriptions_payment_method" CHECK ("subscriptions"."payment_method" in ('CARD', 'PIX', 'PIX_AUTOMATIC'));--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "ck_subscriptions_installment_count" CHECK ("subscriptions"."installment_count" between 1 and 12);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "ck_subscriptions_authorized_payment_count" CHECK ("subscriptions"."authorized_payment_count" between 1 and 12);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "ck_subscriptions_payment_attempt" CHECK ("subscriptions"."payment_attempt" >= 0);