CREATE TYPE "public"."protocol_approval_status" AS ENUM('AUTO_APPROVED', 'PENDING_REVIEW', 'BLOCKED_PENDING_CLEARANCE');--> statement-breakpoint
ALTER TABLE "protocols" ADD COLUMN "approval_status" "protocol_approval_status" DEFAULT 'PENDING_REVIEW' NOT NULL;--> statement-breakpoint
ALTER TABLE "protocols" ADD COLUMN "model_version" varchar(50);--> statement-breakpoint
ALTER TABLE "protocols" ADD COLUMN "prompt_version" varchar(80);