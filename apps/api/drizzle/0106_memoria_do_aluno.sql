-- Memória do aluno: fatos curtos e cifrados que os agentes usam para acompanhar de perto.
CREATE TABLE "student_memories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "kind" varchar(16) NOT NULL,
  "content" bytea NOT NULL,
  "importance" smallint DEFAULT 2 NOT NULL,
  "origin" varchar(16) NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone,
  "retired_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ck_student_memories_kind" CHECK ("student_memories"."kind" in ('ROUTINE', 'MOTIVATION', 'BARRIER', 'PREFERENCE', 'PERSONAL', 'HEALTH_CONTEXT', 'COMMUNICATION', 'MILESTONE')),
  CONSTRAINT "ck_student_memories_origin" CHECK ("student_memories"."origin" in ('CONVERSATION', 'WORKOUT', 'CHECK_IN', 'REASSESSMENT', 'AGENT'))
);--> statement-breakpoint
ALTER TABLE "student_memories" ADD CONSTRAINT "student_memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_student_memories_user" ON "student_memories" USING btree ("user_id","retired_at");
