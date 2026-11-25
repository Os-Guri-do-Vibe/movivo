ALTER TABLE "student_constraints" DROP CONSTRAINT "ck_student_constraints_kind";--> statement-breakpoint
ALTER TABLE "student_health_records" DROP CONSTRAINT "ck_student_health_records_kind";--> statement-breakpoint
ALTER TABLE "anamnesis_sessions" ADD COLUMN "flow" varchar(16) DEFAULT 'INITIAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "anamnesis_sessions" ADD COLUMN "blocks" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "anamnesis_sessions" ADD COLUMN "sensitive" "bytea";--> statement-breakpoint
ALTER TABLE "anamnesis_sessions" ADD COLUMN "completed_steps" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "anamnesis_sessions" ADD CONSTRAINT "ck_anamnesis_sessions_flow" CHECK ("anamnesis_sessions"."flow" in ('INITIAL', 'COMPLEMENTARY'));--> statement-breakpoint
ALTER TABLE "student_constraints" ADD CONSTRAINT "ck_student_constraints_kind" CHECK ("student_constraints"."kind" in ('AVAILABILITY', 'AVAILABILITY_OVERRIDE', 'EQUIPMENT', 'DIETARY_RESTRICTION'));--> statement-breakpoint
ALTER TABLE "student_health_records" ADD CONSTRAINT "ck_student_health_records_kind" CHECK ("student_health_records"."kind" in ('PARQ', 'CONDITION', 'INJURY', 'PAIN', 'MEDICATION', 'SURGERY', 'PREGNANCY', 'EATING_DISORDER_HISTORY', 'PROFESSIONAL_GUIDANCE', 'FOOD_ALLERGY', 'NOTES'));