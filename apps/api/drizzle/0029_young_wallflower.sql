CREATE TYPE "public"."review_urgency" AS ENUM('MANDATORY', 'OPTIONAL');--> statement-breakpoint
ALTER TABLE "protocols" ADD COLUMN "review_urgency" "review_urgency";
