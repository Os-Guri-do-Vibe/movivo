CREATE TYPE "public"."checkin_weekly_status" AS ENUM('PENDING', 'SUBMITTED', 'EXPIRED');--> statement-breakpoint
ALTER TABLE "checkins" DROP CONSTRAINT "checkins_new_protocol_id_protocols_id_fk";--> statement-breakpoint
ALTER TABLE "checkins" DROP CONSTRAINT "ck_checkins_no_plaintext_responses";--> statement-breakpoint
DROP INDEX "idx_checkins_sent_at";--> statement-breakpoint
ALTER TABLE "checkins" ADD COLUMN "token" varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE "checkins" ADD COLUMN "status" "checkin_weekly_status" DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "checkins" ADD COLUMN "expires_at" timestamp with time zone NOT NULL;--> statement-breakpoint
ALTER TABLE "checkins" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "checkins" ADD COLUMN "answers" jsonb;--> statement-breakpoint
ALTER TABLE "checkins" ADD COLUMN "notes_cipher" "bytea";--> statement-breakpoint
ALTER TABLE "checkins" DROP COLUMN "responded_at";--> statement-breakpoint
ALTER TABLE "checkins" DROP COLUMN "responses";--> statement-breakpoint
ALTER TABLE "checkins" DROP COLUMN "responses_cipher";--> statement-breakpoint
ALTER TABLE "checkins" DROP COLUMN "current_question";--> statement-breakpoint
ALTER TABLE "checkins" DROP COLUMN "completed_at";--> statement-breakpoint
ALTER TABLE "checkins" DROP COLUMN "adjustments";--> statement-breakpoint
ALTER TABLE "checkins" DROP COLUMN "new_protocol_id";--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_token_unique" UNIQUE("token");--> statement-breakpoint
CREATE INDEX "idx_checkins_sent_at" ON "checkins" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "idx_checkins_expires_at" ON "checkins" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "ck_checkins_token_len" CHECK (char_length("checkins"."token") = 64);
