ALTER TABLE "consents" DROP CONSTRAINT "uq_consents_user_type_version";--> statement-breakpoint
ALTER TABLE "consents" ADD COLUMN "cycle" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "uq_consents_user_type_version_cycle" UNIQUE("user_id","consent_type","version","cycle");