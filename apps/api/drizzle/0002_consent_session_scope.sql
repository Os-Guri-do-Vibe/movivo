ALTER TABLE "consents" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "consents" ALTER COLUMN "version" SET DATA TYPE varchar(40);--> statement-breakpoint
ALTER TABLE "consents" ADD COLUMN "anamnesis_session_id" uuid;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_anamnesis_session_id_anamnesis_sessions_id_fk" FOREIGN KEY ("anamnesis_session_id") REFERENCES "public"."anamnesis_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_consents_session" ON "consents" USING btree ("anamnesis_session_id");--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "uq_consents_session_type_version" UNIQUE("anamnesis_session_id","consent_type","version");--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "ck_consents_subject" CHECK ("consents"."user_id" IS NOT NULL OR "consents"."anamnesis_session_id" IS NOT NULL);