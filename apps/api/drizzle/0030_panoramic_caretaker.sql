CREATE TYPE "public"."knowledge_document_category" AS ENUM('METHODOLOGY', 'SCIENTIFIC_EVIDENCE', 'EXERCISE_LIBRARY', 'SAFETY', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."knowledge_document_status" AS ENUM('QUARANTINED', 'PROCESSING', 'READY_FOR_REVIEW', 'APPROVED', 'INDEXING', 'PUBLISHED', 'REJECTED', 'FAILED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."methodology_status" AS ENUM('DRAFT', 'IN_REVIEW', 'REJECTED', 'APPROVED', 'PUBLISHED', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "knowledge_chunk_embeddings" (
	"staged_chunk_id" uuid PRIMARY KEY NOT NULL,
	"chunk_sha256" varchar(64) NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"model" varchar(80) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_document_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"status" "knowledge_document_status" NOT NULL,
	"stage" varchar(40) NOT NULL,
	"error_code" varchar(80),
	"note" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_knowledge_document_event_sequence" UNIQUE("document_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "knowledge_document_extractions" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"content_sha256" varchar(64) NOT NULL,
	"parser_version" varchar(50) NOT NULL,
	"detected_mime_type" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_staged_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"chunk_text" text NOT NULL,
	"chunk_sha256" varchar(64) NOT NULL,
	"extraction_sha256" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_knowledge_staged_document_chunk" UNIQUE("document_id","chunk_index")
);
--> statement-breakpoint
CREATE TABLE "methodology_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"methodology_version_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"status" "methodology_status" NOT NULL,
	"actor_id" uuid,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_methodology_event_sequence" UNIQUE("methodology_version_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "methodology_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"version_label" varchar(80) NOT NULL,
	"content" text NOT NULL,
	"content_sha256" varchar(64) NOT NULL,
	"change_note" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_methodology_versions_version" UNIQUE("version"),
	CONSTRAINT "uq_methodology_versions_label" UNIQUE("version_label")
);
--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "category" "knowledge_document_category" DEFAULT 'OTHER' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "logical_key" varchar(120);--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_knowledge_documents_immutable') THEN
    ALTER TABLE "knowledge_documents" DISABLE TRIGGER "trg_knowledge_documents_immutable";
  END IF;
END $$;--> statement-breakpoint
UPDATE "knowledge_documents" SET "logical_key" = 'legacy-' || "id"::text WHERE "logical_key" IS NULL;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_knowledge_documents_immutable') THEN
    ALTER TABLE "knowledge_documents" ENABLE TRIGGER "trg_knowledge_documents_immutable";
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ALTER COLUMN "logical_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "author" varchar(200);--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "license" varchar(120);--> statement-breakpoint
ALTER TABLE "knowledge_chunk_embeddings" ADD CONSTRAINT "knowledge_chunk_embeddings_staged_chunk_id_knowledge_staged_chunks_id_fk" FOREIGN KEY ("staged_chunk_id") REFERENCES "public"."knowledge_staged_chunks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_document_events" ADD CONSTRAINT "knowledge_document_events_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_document_events" ADD CONSTRAINT "knowledge_document_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_document_extractions" ADD CONSTRAINT "knowledge_document_extractions_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_staged_chunks" ADD CONSTRAINT "knowledge_staged_chunks_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "methodology_events" ADD CONSTRAINT "methodology_events_methodology_version_id_methodology_versions_id_fk" FOREIGN KEY ("methodology_version_id") REFERENCES "public"."methodology_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "methodology_events" ADD CONSTRAINT "methodology_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "methodology_versions" ADD CONSTRAINT "methodology_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_knowledge_document_events_status" ON "knowledge_document_events" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_methodology_events_status" ON "methodology_events" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "uq_knowledge_documents_logical_version" UNIQUE("logical_key","version");--> statement-breakpoint
INSERT INTO "knowledge_document_extractions" (
	"document_id", "content", "content_sha256", "parser_version", "detected_mime_type"
)
SELECT document.id, convert_from(blob.payload, 'UTF8'), document.sha256,
	'legacy-v1', document.mime_type
FROM "knowledge_documents" document
JOIN "knowledge_document_blobs" blob ON blob.document_id = document.id
ON CONFLICT (document_id) DO NOTHING;--> statement-breakpoint
INSERT INTO "knowledge_staged_chunks" (
	"document_id", "chunk_index", "chunk_text", "chunk_sha256", "extraction_sha256"
)
SELECT chunk.document_id, chunk.chunk_index, chunk.chunk_text,
	encode(digest(convert_to(chunk.chunk_text, 'UTF8'), 'sha256'), 'hex'), document.sha256
FROM "knowledge_base" chunk
JOIN "knowledge_documents" document ON document.id = chunk.document_id
WHERE chunk.document_id IS NOT NULL AND chunk.chunk_index IS NOT NULL
ON CONFLICT (document_id, chunk_index) DO NOTHING;--> statement-breakpoint
INSERT INTO "knowledge_chunk_embeddings" ("staged_chunk_id", "chunk_sha256", "embedding", "model")
SELECT staged.id, staged.chunk_sha256, published.embedding, 'legacy-unknown'
FROM "knowledge_staged_chunks" staged
JOIN "knowledge_base" published
	ON published.document_id = staged.document_id AND published.chunk_index = staged.chunk_index
ON CONFLICT (staged_chunk_id) DO NOTHING;--> statement-breakpoint
INSERT INTO "knowledge_document_events" ("document_id", "sequence", "status", "stage", "note")
SELECT document.id, 1,
	CASE
		WHEN latest.decision = 'APPROVED' AND EXISTS (
			SELECT 1 FROM knowledge_base chunk WHERE chunk.document_id = document.id
		) THEN 'PUBLISHED'::knowledge_document_status
		WHEN latest.decision = 'APPROVED' THEN 'APPROVED'::knowledge_document_status
		WHEN latest.decision = 'REJECTED' THEN 'REJECTED'::knowledge_document_status
		ELSE 'QUARANTINED'::knowledge_document_status
	END,
	'LEGACY_MIGRATION', 'Estado reconstruído pela migração da base legada.'
FROM knowledge_documents document
LEFT JOIN LATERAL (
	SELECT review.decision FROM knowledge_document_reviews review
	WHERE review.document_id = document.id
	ORDER BY review.created_at DESC, review.id DESC LIMIT 1
) latest ON true
ON CONFLICT (document_id, sequence) DO NOTHING;
