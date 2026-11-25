ALTER TABLE "domain_event_receipts" ALTER COLUMN "processed_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "domain_event_receipts" ALTER COLUMN "processed_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "domain_event_receipts" ADD COLUMN "status" varchar(12) DEFAULT 'PROCESSING' NOT NULL;--> statement-breakpoint
ALTER TABLE "domain_event_receipts" ADD COLUMN "claimed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "domain_event_receipts" SET "status" = 'DONE' WHERE "processed_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "domain_event_receipts" ADD CONSTRAINT "ck_domain_event_receipts_status" CHECK ("domain_event_receipts"."status" in ('PROCESSING', 'DONE'));