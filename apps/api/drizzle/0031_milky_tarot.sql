ALTER TABLE "protocols" ADD COLUMN "knowledge_sources" jsonb;--> statement-breakpoint
ALTER TABLE "protocols" ADD COLUMN "methodology_version_id" uuid;--> statement-breakpoint
ALTER TABLE "protocols" ADD COLUMN "methodology_sha256" varchar(64);--> statement-breakpoint
ALTER TABLE "protocol_versions" ADD COLUMN "knowledge_sources" jsonb;--> statement-breakpoint
ALTER TABLE "protocol_versions" ADD COLUMN "methodology_version_id" uuid;--> statement-breakpoint
ALTER TABLE "protocol_versions" ADD COLUMN "methodology_sha256" varchar(64);--> statement-breakpoint
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_methodology_version_id_methodology_versions_id_fk" FOREIGN KEY ("methodology_version_id") REFERENCES "public"."methodology_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_versions" ADD CONSTRAINT "protocol_versions_methodology_version_id_methodology_versions_id_fk" FOREIGN KEY ("methodology_version_id") REFERENCES "public"."methodology_versions"("id") ON DELETE restrict ON UPDATE no action;