-- Sprint 5: origem duravel/idempotente de alertas produzidos pelo check-in.
ALTER TABLE "handoff_alerts" ADD COLUMN "source_type" varchar(30);--> statement-breakpoint
ALTER TABLE "handoff_alerts" ADD COLUMN "source_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_handoff_alerts_source" ON "handoff_alerts" USING btree ("source_type","source_id");
