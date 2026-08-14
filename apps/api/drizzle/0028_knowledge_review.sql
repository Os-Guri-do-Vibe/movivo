CREATE TYPE "public"."knowledge_review_decision" AS ENUM('APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "knowledge_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(200) NOT NULL,
	"topic" varchar(60) NOT NULL,
	"source_url" varchar(500),
	"original_filename" varchar(255) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_documents_sha256_unique" UNIQUE("sha256")
);--> statement-breakpoint
CREATE TABLE "knowledge_document_blobs" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"payload" bytea NOT NULL,
	"retained_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "knowledge_document_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"decision" "knowledge_review_decision" NOT NULL,
	"note" text NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD COLUMN "document_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD COLUMN "chunk_index" integer;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "rag_sources" jsonb;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_document_blobs" ADD CONSTRAINT "knowledge_document_blobs_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_document_reviews" ADD CONSTRAINT "knowledge_document_reviews_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_document_reviews" ADD CONSTRAINT "knowledge_document_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD CONSTRAINT "knowledge_base_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_knowledge_documents_created_at" ON "knowledge_documents" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_knowledge_document_reviews_document" ON "knowledge_document_reviews" USING btree ("document_id","created_at");--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD CONSTRAINT "uq_knowledge_base_document_chunk" UNIQUE("document_id","chunk_index");
