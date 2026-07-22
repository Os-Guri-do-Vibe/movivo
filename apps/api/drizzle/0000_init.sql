CREATE TYPE "public"."ai_job_status" AS ENUM('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'DLQ');--> statement-breakpoint
CREATE TYPE "public"."ai_job_type" AS ENUM('PROTOCOL_GENERATION', 'AI_RESPONSE', 'CHECKIN_ADJUSTMENT');--> statement-breakpoint
CREATE TYPE "public"."anamnesis_status" AS ENUM('IN_PROGRESS', 'SUBMITTED', 'EXPIRED', 'PROCESSED');--> statement-breakpoint
CREATE TYPE "public"."consent_type" AS ENUM('DATA_PROCESSING', 'HEALTH_DATA', 'MARKETING', 'TERMS_OF_SERVICE');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('INBOUND', 'OUTBOUND');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('TEXT', 'IMAGE', 'AUDIO', 'TEMPLATE', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('STRIPE', 'ASAAS');--> statement-breakpoint
CREATE TYPE "public"."protocol_status" AS ENUM('DRAFT', 'PENDING_SIGNATURE', 'ACTIVE', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."subscription_plan" AS ENUM('MONTHLY', 'QUARTERLY', 'ANNUAL');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ONBOARDING', 'TRIAL', 'ACTIVE', 'CHURNED', 'PAUSED');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_number" varchar(20) NOT NULL,
	"name" varchar(255),
	"email" varchar(255),
	"whatsapp_name" varchar(255),
	"status" "user_status" DEFAULT 'ONBOARDING' NOT NULL,
	"trial_started_at" timestamp with time zone,
	"trial_ends_at" timestamp with time zone,
	"anonymized_at" timestamp with time zone,
	"requires_professional_review" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_number_unique" UNIQUE("phone_number"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "anamnesis_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"token" varchar(64) NOT NULL,
	"status" "anamnesis_status" DEFAULT 'IN_PROGRESS' NOT NULL,
	"last_block" smallint DEFAULT 1 NOT NULL,
	"data_block_1" jsonb,
	"data_block_2" jsonb,
	"data_block_3" jsonb,
	"primary_goal" varchar(30),
	"expires_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anamnesis_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"consent_type" "consent_type" NOT NULL,
	"version" varchar(20) NOT NULL,
	"accepted" boolean NOT NULL,
	"ip_address" "inet",
	"user_agent" text,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_consents_user_type_version" UNIQUE("user_id","consent_type","version")
);
--> statement-breakpoint
CREATE TABLE "protocols" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"version" smallint DEFAULT 1 NOT NULL,
	"status" "protocol_status" DEFAULT 'DRAFT' NOT NULL,
	"professional_id" uuid,
	"signed_at" timestamp with time zone,
	"signature_hash" varchar(64),
	"current_week" smallint DEFAULT 1 NOT NULL,
	"total_weeks" smallint DEFAULT 12 NOT NULL,
	"content" jsonb NOT NULL,
	"constraints" jsonb NOT NULL,
	"par_q_flags" jsonb,
	"human_review_required" boolean DEFAULT false NOT NULL,
	"generated_by" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_protocols_user_version" UNIQUE("user_id","version")
);
--> statement-breakpoint
CREATE TABLE "protocol_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"protocol_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"version" smallint NOT NULL,
	"status" "protocol_status" DEFAULT 'DRAFT' NOT NULL,
	"content" jsonb NOT NULL,
	"diff" jsonb,
	"change_reason" text,
	"generated_by" varchar(50),
	"signature_hash" varchar(64),
	"signed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_protocol_versions_protocol_version" UNIQUE("protocol_id","version")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"protocol_id" uuid,
	"direction" "message_direction" NOT NULL,
	"message_type" "message_type" DEFAULT 'TEXT' NOT NULL,
	"content" text NOT NULL,
	"whatsapp_msg_id" varchar(255),
	"ai_job_id" uuid,
	"model_used" varchar(50),
	"latency_ms" integer,
	"validation_passed" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_whatsapp_msg_id_unique" UNIQUE("whatsapp_msg_id")
);
--> statement-breakpoint
CREATE TABLE "checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"protocol_id" uuid NOT NULL,
	"week_number" smallint NOT NULL,
	"sent_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"responses" jsonb,
	"adjustments" jsonb,
	"new_protocol_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_checkins_user_protocol_week" UNIQUE("user_id","protocol_id","week_number")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan" "subscription_plan" NOT NULL,
	"price_cents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'BRL' NOT NULL,
	"status" "subscription_status" DEFAULT 'TRIALING' NOT NULL,
	"payment_provider" "payment_provider",
	"external_subscription_id" varchar(255),
	"trial_ends_at" timestamp with time zone,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_type" "ai_job_type" NOT NULL,
	"status" "ai_job_status" DEFAULT 'QUEUED' NOT NULL,
	"conversation_id" uuid,
	"model_used" varchar(50),
	"tokens_input" integer,
	"tokens_output" integer,
	"latency_ms" integer,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "anamnesis_sessions" ADD CONSTRAINT "anamnesis_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_versions" ADD CONSTRAINT "protocol_versions_protocol_id_protocols_id_fk" FOREIGN KEY ("protocol_id") REFERENCES "public"."protocols"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_versions" ADD CONSTRAINT "protocol_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_protocol_id_protocols_id_fk" FOREIGN KEY ("protocol_id") REFERENCES "public"."protocols"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_protocol_id_protocols_id_fk" FOREIGN KEY ("protocol_id") REFERENCES "public"."protocols"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_new_protocol_id_protocols_id_fk" FOREIGN KEY ("new_protocol_id") REFERENCES "public"."protocols"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_users_status" ON "users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_users_trial_ends_at" ON "users" USING btree ("trial_ends_at");--> statement-breakpoint
CREATE INDEX "idx_anamnesis_sessions_user" ON "anamnesis_sessions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_anamnesis_sessions_status" ON "anamnesis_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_anamnesis_sessions_expires_at" ON "anamnesis_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_consents_user" ON "consents" USING btree ("user_id","accepted_at");--> statement-breakpoint
CREATE INDEX "idx_protocols_user" ON "protocols" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_protocols_status" ON "protocols" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_protocols_review" ON "protocols" USING btree ("human_review_required","created_at");--> statement-breakpoint
CREATE INDEX "idx_protocol_versions_user" ON "protocol_versions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_protocol_versions_protocol" ON "protocol_versions" USING btree ("protocol_id","version");--> statement-breakpoint
CREATE INDEX "idx_conversations_user_created_at" ON "conversations" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_conversations_protocol" ON "conversations" USING btree ("protocol_id");--> statement-breakpoint
CREATE INDEX "idx_checkins_user_week" ON "checkins" USING btree ("user_id","week_number");--> statement-breakpoint
CREATE INDEX "idx_checkins_sent_at" ON "checkins" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_user" ON "subscriptions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_status" ON "subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_trial_ends_at" ON "subscriptions" USING btree ("trial_ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_subscriptions_external_id" ON "subscriptions" USING btree ("external_subscription_id");--> statement-breakpoint
CREATE INDEX "idx_ai_jobs_user_created_at" ON "ai_jobs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_ai_jobs_status" ON "ai_jobs" USING btree ("status");