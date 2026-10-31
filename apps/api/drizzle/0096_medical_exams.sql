CREATE TABLE "medical_exams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"media_type" varchar(40) NOT NULL,
	"file" "bytea" NOT NULL,
	"status" varchar(16) DEFAULT 'RECEIVED' NOT NULL,
	"reading" "bytea",
	"comment" "bytea",
	"exception_case_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_medical_exams_status" CHECK ("medical_exams"."status" in ('RECEIVED', 'COMMENTED', 'NOT_EXAM', 'FAILED'))
);
--> statement-breakpoint
ALTER TABLE "student_health_records" DROP CONSTRAINT "ck_student_health_records_kind";--> statement-breakpoint
ALTER TABLE "exception_cases" DROP CONSTRAINT "ck_exception_cases_kind";--> statement-breakpoint
ALTER TABLE "agent_profiles" DROP CONSTRAINT "ck_agent_profiles_agent";--> statement-breakpoint
ALTER TABLE "medical_exams" ADD CONSTRAINT "medical_exams_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_medical_exams_user" ON "medical_exams" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "student_health_records" ADD CONSTRAINT "ck_student_health_records_kind" CHECK ("student_health_records"."kind" in ('PARQ', 'CONDITION', 'INJURY', 'PAIN', 'MEDICATION', 'SURGERY', 'PREGNANCY', 'EATING_DISORDER_HISTORY', 'PROFESSIONAL_GUIDANCE', 'FOOD_ALLERGY', 'NOTES', 'MENSTRUAL_CYCLE', 'EXAM'));--> statement-breakpoint
ALTER TABLE "exception_cases" ADD CONSTRAINT "ck_exception_cases_kind" CHECK ("exception_cases"."kind" in ('SAFETY', 'NO_APPLICABLE_POLICY', 'STUDENT_REVIEW_REQUEST', 'DECISION_FAILURE', 'CONVERSATION_TAKEOVER', 'MEDICAL_EXAM'));--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD CONSTRAINT "ck_agent_profiles_agent" CHECK ("agent_profiles"."agent" in ('COORDINATOR', 'STRATEGY', 'STRENGTH', 'RUNNING', 'HYROX', 'HYBRID', 'NUTRITION', 'COMMUNICATION', 'RECOVERY', 'HABITS', 'MEDICAL'));