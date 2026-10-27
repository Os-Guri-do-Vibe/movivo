CREATE TABLE "methodology_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" varchar(16) NOT NULL,
	"version" integer NOT NULL,
	"status" varchar(16) DEFAULT 'DRAFT' NOT NULL,
	"parameters" jsonb NOT NULL,
	"guidance" jsonb NOT NULL,
	"justifications" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"change_note" text NOT NULL,
	"eval_run_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_methodology_documents_domain_version" UNIQUE("domain","version"),
	CONSTRAINT "ck_methodology_documents_domain" CHECK ("methodology_documents"."domain" in ('STRENGTH', 'RUNNING', 'HYROX', 'HYBRID', 'NUTRITION', 'RECOVERY', 'ADHERENCE', 'SAFETY', 'AUTONOMY', 'COMMUNICATION')),
	CONSTRAINT "ck_methodology_documents_status" CHECK ("methodology_documents"."status" in ('DRAFT', 'TESTING', 'PUBLISHED', 'SUPERSEDED', 'DISCARDED'))
);
--> statement-breakpoint
ALTER TABLE "methodology_documents" ADD CONSTRAINT "methodology_documents_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "methodology_documents" ADD CONSTRAINT "methodology_documents_published_by_staff_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_methodology_documents_one_published" ON "methodology_documents" USING btree ("domain") WHERE "methodology_documents"."status" = 'PUBLISHED';--> statement-breakpoint
CREATE INDEX "idx_methodology_documents_domain" ON "methodology_documents" USING btree ("domain","status");