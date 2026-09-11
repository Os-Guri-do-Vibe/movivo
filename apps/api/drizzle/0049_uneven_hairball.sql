ALTER TABLE "protocol_substitution_requests" ALTER COLUMN "to_exercise_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "protocol_substitution_requests" ALTER COLUMN "proposed_content" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "protocol_substitution_requests" ALTER COLUMN "diff" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "protocol_substitution_requests" ADD COLUMN "review_urgency" "review_urgency" DEFAULT 'OPTIONAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "protocol_substitution_requests" ADD COLUMN "catalog_gap" boolean DEFAULT false NOT NULL;