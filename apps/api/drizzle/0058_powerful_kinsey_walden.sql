-- Reaplica o backfill para linhas eventualmente inseridas por uma versão antiga durante
-- rolling deploy entre 0056 e este fechamento. O total histórico nunca é reprecificado.
UPDATE "subscriptions"
SET "total_price_cents" = COALESCE("total_price_cents", "price_cents"),
    "commitment_months" = COALESCE("commitment_months", CASE "plan"
      WHEN 'MONTHLY' THEN 1
      WHEN 'QUARTERLY' THEN 3
      WHEN 'SEMIANNUAL' THEN 6
      WHEN 'ANNUAL' THEN 12
    END),
    "monthly_price_cents" = COALESCE("monthly_price_cents", CASE "plan"
      WHEN 'MONTHLY' THEN "price_cents"
      WHEN 'QUARTERLY' THEN ROUND("price_cents" / 3.0)::integer
      WHEN 'SEMIANNUAL' THEN ROUND("price_cents" / 6.0)::integer
      WHEN 'ANNUAL' THEN ROUND("price_cents" / 12.0)::integer
    END)
WHERE "monthly_price_cents" IS NULL
   OR "total_price_cents" IS NULL
   OR "commitment_months" IS NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "monthly_price_cents" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "total_price_cents" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "commitment_months" SET NOT NULL;
