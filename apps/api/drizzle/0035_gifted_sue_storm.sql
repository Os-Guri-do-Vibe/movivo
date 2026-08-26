ALTER TABLE "protocols" ADD COLUMN "anamnesis_session_id" uuid;--> statement-breakpoint
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_anamnesis_session_id_anamnesis_sessions_id_fk" FOREIGN KEY ("anamnesis_session_id") REFERENCES "public"."anamnesis_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_protocols_anamnesis_session" ON "protocols" USING btree ("anamnesis_session_id");--> statement-breakpoint
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_mandatory_never_auto_approved" CHECK (NOT ("protocols"."review_urgency" = 'MANDATORY' AND "protocols"."approval_status" = 'AUTO_APPROVED')) NOT VALID;--> statement-breakpoint
ALTER TABLE "protocols" VALIDATE CONSTRAINT "protocols_mandatory_never_auto_approved";
