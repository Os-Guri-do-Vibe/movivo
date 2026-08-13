CREATE TYPE "public"."status_transition_actor" AS ENUM('SYSTEM', 'USER', 'PROFESSIONAL', 'BACKFILL');--> statement-breakpoint
CREATE TYPE "public"."user_lifecycle_status" AS ENUM('TRIAL_STARTED', 'CONVERTED', 'RENEWED', 'PAUSED', 'RESUMED', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."expense_category" AS ENUM('INFRA', 'IA_LLM', 'WHATSAPP', 'GATEWAY_PAGAMENTO', 'MARKETING', 'JURIDICO_CONTABIL', 'FERRAMENTAS', 'PESSOAS', 'IMPOSTOS', 'OUTROS');--> statement-breakpoint
CREATE TYPE "public"."expense_recurrence_period" AS ENUM('MONTHLY', 'QUARTERLY', 'YEARLY');--> statement-breakpoint
CREATE TABLE "user_status_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"from_status" "user_lifecycle_status",
	"to_status" "user_lifecycle_status" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"actor" "status_transition_actor" DEFAULT 'SYSTEM' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_user_status_transitions_event" UNIQUE("user_id","to_status","occurred_at")
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_on" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"category" "expense_category" NOT NULL,
	"supplier" text NOT NULL,
	"description" text NOT NULL,
	"is_recurring" boolean DEFAULT false NOT NULL,
	"recurrence_period" "expense_recurrence_period",
	"receipt_ref" text,
	"reverses_expense_id" uuid,
	"recurring_parent_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_expenses_recurring_period" UNIQUE("recurring_parent_id","occurred_on"),
	CONSTRAINT "uq_expenses_reversal" UNIQUE("reverses_expense_id")
);
--> statement-breakpoint
CREATE TABLE "model_pricing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model" text NOT NULL,
	"input_price_per_1k_cents" numeric(14, 6) NOT NULL,
	"output_price_per_1k_cents" numeric(14, 6) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_model_pricing_model_valid_from" UNIQUE("model","valid_from")
);
--> statement-breakpoint
ALTER TABLE "user_status_transitions" ADD CONSTRAINT "user_status_transitions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_pricing" ADD CONSTRAINT "model_pricing_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_user_status_transitions_to_status" ON "user_status_transitions" USING btree ("to_status","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_user_status_transitions_user" ON "user_status_transitions" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_expenses_occurred_on" ON "expenses" USING btree ("occurred_on");--> statement-breakpoint
-- Semente de `model_pricing` com EXATAMENTE os precos da constante versionada da
-- TASK-7.2.3 (USD por 1k tokens x 100 = centavos de USD por 1k tokens). `valid_from`
-- retroativo cobre todo job ja gravado: a troca de fonte nao pode mudar o numero
-- apurado da Sprint 7 (teste de nao-regressao da TASK-8.4.3).
INSERT INTO "model_pricing" ("model", "input_price_per_1k_cents", "output_price_per_1k_cents", "currency", "valid_from")
VALUES
  ('gpt-4.1', 0.2, 0.8, 'USD', '2020-01-01'),
  ('gpt-4.1-mini', 0.04, 0.16, 'USD', '2020-01-01'),
  ('claude-sonnet-4-5', 0.3, 1.5, 'USD', '2020-01-01')
ON CONFLICT ("model", "valid_from") DO NOTHING;
