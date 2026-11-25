CREATE TABLE "model_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"task_id" varchar(60) NOT NULL,
	"prompt_version" varchar(64) NOT NULL,
	"tier" varchar(16) NOT NULL,
	"vendor" varchar(16),
	"model" varchar(80),
	"data_class" varchar(16) NOT NULL,
	"status" varchar(16) NOT NULL,
	"attempt" smallint NOT NULL,
	"tokens_input" integer DEFAULT 0 NOT NULL,
	"tokens_cached" integer DEFAULT 0 NOT NULL,
	"tokens_output" integer DEFAULT 0 NOT NULL,
	"cost_brl" numeric(10, 5) DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"error_code" varchar(40),
	"input_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_model_runs_tier" CHECK ("model_runs"."tier" in ('FAST', 'STANDARD', 'REASONING', 'VISION')),
	CONSTRAINT "ck_model_runs_status" CHECK ("model_runs"."status" in ('COMPLETED', 'FAILED')),
	CONSTRAINT "ck_model_runs_data_class" CHECK ("model_runs"."data_class" in ('HEALTH', 'NON_HEALTH'))
);
--> statement-breakpoint
CREATE TABLE "model_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tier" varchar(16) NOT NULL,
	"position" smallint NOT NULL,
	"vendor" varchar(16) NOT NULL,
	"model" varchar(80) NOT NULL,
	"max_output_tokens" integer NOT NULL,
	"timeout_ms" integer NOT NULL,
	"temperature" numeric(3, 2) NOT NULL,
	"vision" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_model_tiers_tier_position" UNIQUE("tier","position"),
	CONSTRAINT "ck_model_tiers_tier" CHECK ("model_tiers"."tier" in ('FAST', 'STANDARD', 'REASONING', 'VISION')),
	CONSTRAINT "ck_model_tiers_vendor" CHECK ("model_tiers"."vendor" in ('DEEPSEEK', 'OPENAI', 'ANTHROPIC'))
);
--> statement-breakpoint
ALTER TABLE "model_runs" ADD CONSTRAINT "model_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_tiers" ADD CONSTRAINT "model_tiers_updated_by_staff_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_model_runs_user" ON "model_runs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_model_runs_task" ON "model_runs" USING btree ("task_id","created_at");