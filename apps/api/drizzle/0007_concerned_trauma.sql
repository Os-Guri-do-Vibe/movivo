CREATE TABLE "knowledge_base" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chunk_text" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"topic" varchar(60) NOT NULL,
	"title" varchar(200) NOT NULL,
	"source_url" varchar(500),
	"reliability" integer DEFAULT 3 NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_knowledge_base_topic" ON "knowledge_base" USING btree ("topic");