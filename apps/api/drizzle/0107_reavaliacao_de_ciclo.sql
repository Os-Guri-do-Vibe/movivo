-- Reavaliação de fim de ciclo: link no dia do vencimento, respostas e análise (cifradas) e o próximo protocolo.
CREATE TABLE "cycle_reassessments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "training_plan_id" uuid,
  "nutrition_plan_id" uuid,
  "cycle_ended_on" date NOT NULL,
  "status" varchar(12) DEFAULT 'SENT' NOT NULL,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL,
  "submitted_at" timestamp with time zone,
  "answers" bytea,
  "analysis" bytea,
  "next_training_plan_id" uuid,
  "next_nutrition_plan_id" uuid,
  "failure_reason" varchar(200),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_cycle_reassessments_cycle" UNIQUE("user_id","cycle_ended_on"),
  CONSTRAINT "ck_cycle_reassessments_status" CHECK ("cycle_reassessments"."status" in ('SENT', 'SUBMITTED', 'ANALYZED', 'PLANNED', 'FAILED'))
);--> statement-breakpoint
ALTER TABLE "cycle_reassessments" ADD CONSTRAINT "cycle_reassessments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_reassessments" ADD CONSTRAINT "cycle_reassessments_training_plan_id_training_plans_id_fk" FOREIGN KEY ("training_plan_id") REFERENCES "public"."training_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_reassessments" ADD CONSTRAINT "cycle_reassessments_nutrition_plan_id_nutrition_plans_id_fk" FOREIGN KEY ("nutrition_plan_id") REFERENCES "public"."nutrition_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_reassessments" ADD CONSTRAINT "cycle_reassessments_next_training_plan_id_training_plans_id_fk" FOREIGN KEY ("next_training_plan_id") REFERENCES "public"."training_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_reassessments" ADD CONSTRAINT "cycle_reassessments_next_nutrition_plan_id_nutrition_plans_id_fk" FOREIGN KEY ("next_nutrition_plan_id") REFERENCES "public"."nutrition_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_cycle_reassessments_user" ON "cycle_reassessments" USING btree ("user_id","cycle_ended_on");
