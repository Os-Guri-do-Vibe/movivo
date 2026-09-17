ALTER TABLE "protocols" ADD COLUMN "mesocycle_summary" jsonb;--> statement-breakpoint
ALTER TABLE "protocols" ADD COLUMN "mesocycle_notes_cipher" "bytea";--> statement-breakpoint
CREATE INDEX "idx_protocols_active_end_date" ON "protocols" USING btree ("end_date") WHERE "protocols"."status" = 'ACTIVE';