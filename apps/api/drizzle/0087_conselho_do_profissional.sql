ALTER TABLE "staff" RENAME COLUMN "cref_number" TO "council_number";--> statement-breakpoint
ALTER TABLE "staff" RENAME COLUMN "cref_region" TO "council_region";--> statement-breakpoint
ALTER TABLE "staff" RENAME COLUMN "cref_active" TO "council_active";--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "council" varchar(4) DEFAULT 'CREF' NOT NULL;--> statement-breakpoint
ALTER TABLE "exception_cases" DROP CONSTRAINT "ck_exception_cases_domain";--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "ck_staff_council" CHECK ("staff"."council" in ('CREF', 'CRN', 'CRM'));--> statement-breakpoint
ALTER TABLE "exception_cases" ADD CONSTRAINT "ck_exception_cases_domain" CHECK ("exception_cases"."domain" in ('TRAINING', 'NUTRITION', 'MEDICAL', 'GENERAL'));
