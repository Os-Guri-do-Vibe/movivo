-- Acompanhamento premium: observações do aluno, estudo do dia, snapshots de sessão, compromissos,
-- contatos iniciados pela MOVIVO e auditoria de qualidade das mensagens dos agentes.
CREATE TABLE "student_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "on_date" date NOT NULL,
  "kind" varchar(12) NOT NULL,
  "score" smallint,
  "value_num" numeric(6, 2),
  "phase" varchar(8) DEFAULT 'NONE' NOT NULL,
  "source" varchar(10) NOT NULL,
  "note" bytea,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ck_student_reports_kind" CHECK ("student_reports"."kind" in ('SLEEP', 'STRESS', 'ENERGY', 'MOOD', 'SORENESS', 'HUNGER', 'DIGESTION', 'ILLNESS', 'ALCOHOL', 'TRAVEL', 'WORK', 'SOCIAL', 'OTHER')),
  CONSTRAINT "ck_student_reports_phase" CHECK ("student_reports"."phase" in ('BEFORE', 'AFTER', 'NONE')),
  CONSTRAINT "ck_student_reports_source" CHECK ("student_reports"."source" in ('CHAT', 'CHECK_IN', 'SESSION')),
  CONSTRAINT "ck_student_reports_score" CHECK ("student_reports"."score" is null or "student_reports"."score" between 1 and 5)
);--> statement-breakpoint
ALTER TABLE "student_reports" ADD CONSTRAINT "student_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_student_reports_user" ON "student_reports" USING btree ("user_id","on_date");--> statement-breakpoint

CREATE TABLE "student_day_digests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "on_date" date NOT NULL,
  "digest" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_student_day_digests_day" UNIQUE("user_id","on_date")
);--> statement-breakpoint
ALTER TABLE "student_day_digests" ADD CONSTRAINT "student_day_digests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_student_day_digests_user" ON "student_day_digests" USING btree ("user_id","on_date");--> statement-breakpoint

CREATE TABLE "session_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "execution_id" uuid NOT NULL,
  "performed_on" date NOT NULL,
  "modality" varchar(16) NOT NULL,
  "session_key" varchar(80) NOT NULL,
  "readiness" jsonb NOT NULL,
  "performance" jsonb NOT NULL,
  "comparison" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_session_snapshots_execution" UNIQUE("execution_id")
);--> statement-breakpoint
ALTER TABLE "session_snapshots" ADD CONSTRAINT "session_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_snapshots" ADD CONSTRAINT "session_snapshots_execution_id_session_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."session_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_session_snapshots_user" ON "session_snapshots" USING btree ("user_id","performed_on");--> statement-breakpoint
CREATE INDEX "idx_session_snapshots_key" ON "session_snapshots" USING btree ("user_id","session_key","performed_on");--> statement-breakpoint

CREATE TABLE "student_commitments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "source" varchar(10) NOT NULL,
  "text" varchar(240) NOT NULL,
  "created_on" date NOT NULL,
  "due_on" date NOT NULL,
  "status" varchar(10) DEFAULT 'OPEN' NOT NULL,
  "evidence" varchar(200),
  "reviewed_at" timestamp with time zone,
  "nudged_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ck_student_commitments_source" CHECK ("student_commitments"."source" in ('TRAINING', 'NUTRITION', 'HABITS')),
  CONSTRAINT "ck_student_commitments_status" CHECK ("student_commitments"."status" in ('OPEN', 'KEPT', 'PARTIAL', 'NOT_KEPT', 'DROPPED'))
);--> statement-breakpoint
ALTER TABLE "student_commitments" ADD CONSTRAINT "student_commitments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_student_commitments_user" ON "student_commitments" USING btree ("user_id","status","due_on");--> statement-breakpoint

CREATE TABLE "agent_outreaches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "kind" varchar(20) NOT NULL,
  "level" smallint,
  "strategy" varchar(32),
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL,
  "responded_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ck_agent_outreaches_kind" CHECK ("agent_outreaches"."kind" in ('LOGGING_GAP', 'MISSED_SESSION', 'SILENCE', 'COMMITMENT_NUDGE', 'SPECIALIST_DAILY')),
  CONSTRAINT "ck_agent_outreaches_level" CHECK ("agent_outreaches"."level" is null or "agent_outreaches"."level" between 1 and 4)
);--> statement-breakpoint
ALTER TABLE "agent_outreaches" ADD CONSTRAINT "agent_outreaches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_outreaches_user" ON "agent_outreaches" USING btree ("user_id","sent_at");--> statement-breakpoint

CREATE TABLE "message_quality_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "dedupe_id" varchar(120) NOT NULL,
  "flow" varchar(40) NOT NULL,
  "checks" jsonb NOT NULL,
  "scores" jsonb,
  "judged" boolean DEFAULT false NOT NULL,
  "verdict" varchar(8) NOT NULL,
  "overall" numeric(3, 2),
  "reviewed_by_staff_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_message_quality_reviews_send" UNIQUE("user_id","dedupe_id"),
  CONSTRAINT "ck_message_quality_reviews_verdict" CHECK ("message_quality_reviews"."verdict" in ('OK', 'REVIEW'))
);--> statement-breakpoint
ALTER TABLE "message_quality_reviews" ADD CONSTRAINT "message_quality_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_message_quality_reviews_flow" ON "message_quality_reviews" USING btree ("flow","created_at");--> statement-breakpoint
CREATE INDEX "idx_message_quality_reviews_verdict" ON "message_quality_reviews" USING btree ("verdict","created_at");
