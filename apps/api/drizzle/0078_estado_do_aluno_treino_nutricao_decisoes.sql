CREATE TABLE "goal_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"ordinal" smallint NOT NULL,
	"milestone" jsonb NOT NULL,
	"due_on" date NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_goal_milestones_goal_ordinal" UNIQUE("goal_id","ordinal"),
	CONSTRAINT "ck_goal_milestones_status" CHECK ("goal_milestones"."status" in ('PENDING', 'ACHIEVED', 'MISSED', 'REVISED'))
);
--> statement-breakpoint
CREATE TABLE "goal_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"title" varchar(120) NOT NULL,
	"window_start" date NOT NULL,
	"window_end" date NOT NULL,
	"target" smallint NOT NULL,
	"progress" smallint DEFAULT 0 NOT NULL,
	"status" varchar(16) DEFAULT 'OPEN' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_goal_tasks_window" UNIQUE("goal_id","kind","window_start"),
	CONSTRAINT "ck_goal_tasks_kind" CHECK ("goal_tasks"."kind" in ('COMPLETE_SESSIONS', 'COMPLETE_KEY_SESSION', 'LOG_MEALS', 'HIT_PROTEIN', 'RECORD_MEASUREMENTS', 'RECORD_PHOTOS', 'ANSWER_CHECK_IN', 'SLEEP_ROUTINE', 'CUSTOM')),
	CONSTRAINT "ck_goal_tasks_status" CHECK ("goal_tasks"."status" in ('OPEN', 'DONE', 'MISSED', 'CANCELED'))
);
--> statement-breakpoint
CREATE TABLE "student_constraints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"constraint" jsonb NOT NULL,
	"origin" varchar(16) NOT NULL,
	"valid_from" date NOT NULL,
	"valid_until" date,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_student_constraints_kind" CHECK ("student_constraints"."kind" in ('AVAILABILITY', 'AVAILABILITY_OVERRIDE', 'MOVEMENT_RESTRICTION', 'EQUIPMENT', 'DIETARY_RESTRICTION', 'FOOD_ALLERGY')),
	CONSTRAINT "ck_student_constraints_origin" CHECK ("student_constraints"."origin" in ('DECLARED', 'OBSERVED', 'INFERRED'))
);
--> statement-breakpoint
CREATE TABLE "student_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"declared" jsonb NOT NULL,
	"strategy" jsonb,
	"strategy_decision_id" uuid,
	"started_on" date NOT NULL,
	"review_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_student_goals_user_version" UNIQUE("user_id","version"),
	CONSTRAINT "ck_student_goals_status" CHECK ("student_goals"."status" in ('ACTIVE', 'SUPERSEDED', 'ACHIEVED', 'ABANDONED'))
);
--> statement-breakpoint
CREATE TABLE "student_health_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"payload" "bytea" NOT NULL,
	"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"origin" varchar(16) NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_student_health_records_kind" CHECK ("student_health_records"."kind" in ('PARQ', 'CONDITION', 'INJURY', 'PAIN', 'MEDICATION', 'SURGERY', 'PREGNANCY', 'EATING_DISORDER_HISTORY', 'PROFESSIONAL_GUIDANCE')),
	CONSTRAINT "ck_student_health_records_status" CHECK ("student_health_records"."status" in ('ACTIVE', 'RESOLVED')),
	CONSTRAINT "ck_student_health_records_origin" CHECK ("student_health_records"."origin" in ('DECLARED', 'OBSERVED', 'INFERRED'))
);
--> statement-breakpoint
CREATE TABLE "student_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"observation" jsonb NOT NULL,
	"source_event_ids" jsonb NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"domain" varchar(32) NOT NULL,
	"key" varchar(80) NOT NULL,
	"value" jsonb NOT NULL,
	"strength" varchar(16) NOT NULL,
	"origin" varchar(16) NOT NULL,
	"confidence" smallint NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_student_preferences_domain" CHECK ("student_preferences"."domain" in ('TRAINING_STRUCTURE', 'EXERCISE', 'SESSION_LENGTH', 'EFFORT', 'SCHEDULE', 'FOOD', 'COMMUNICATION')),
	CONSTRAINT "ck_student_preferences_strength" CHECK ("student_preferences"."strength" in ('REQUIRED', 'STRONG', 'FLEXIBLE', 'HYPOTHESIS')),
	CONSTRAINT "ck_student_preferences_origin" CHECK ("student_preferences"."origin" in ('DECLARED', 'OBSERVED', 'INFERRED')),
	CONSTRAINT "ck_student_preferences_inferred_not_required" CHECK (not ("student_preferences"."origin" = 'INFERRED' and "student_preferences"."strength" = 'REQUIRED'))
);
--> statement-breakpoint
CREATE TABLE "student_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"profile" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "student_state_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"state" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_state_snapshots_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "execution_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"execution_id" uuid NOT NULL,
	"metrics" jsonb NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "execution_metrics_execution_id_unique" UNIQUE("execution_id")
);
--> statement-breakpoint
CREATE TABLE "execution_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"execution_id" uuid NOT NULL,
	"exercise_id" varchar(80) NOT NULL,
	"set_number" smallint NOT NULL,
	"reps" smallint,
	"load_kg" numeric(6, 2),
	"duration_seconds" integer,
	"rir" smallint,
	"completed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_execution_sets_set" UNIQUE("execution_id","exercise_id","set_number")
);
--> statement-breakpoint
CREATE TABLE "plan_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"key" varchar(24) NOT NULL,
	"modality" varchar(16) NOT NULL,
	"title" varchar(80) NOT NULL,
	"priority" varchar(16) NOT NULL,
	"weekly_frequency" smallint NOT NULL,
	"estimated_minutes" smallint NOT NULL,
	"estimated_load" integer NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_plan_sessions_plan_key" UNIQUE("plan_id","key"),
	CONSTRAINT "ck_plan_sessions_modality" CHECK ("plan_sessions"."modality" in ('STRENGTH', 'RUNNING', 'HYROX', 'EXTERNAL_SPORT')),
	CONSTRAINT "ck_plan_sessions_priority" CHECK ("plan_sessions"."priority" in ('KEY', 'IMPORTANT', 'COMPLEMENTARY'))
);
--> statement-breakpoint
CREATE TABLE "scheduled_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"plan_session_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"occurrence" smallint NOT NULL,
	"scheduled_on" date NOT NULL,
	"slot" varchar(16) DEFAULT 'ANY' NOT NULL,
	"status" varchar(16) DEFAULT 'PLANNED' NOT NULL,
	"change_source" varchar(16) DEFAULT 'PLANNER' NOT NULL,
	"decision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_scheduled_sessions_occurrence" UNIQUE("plan_session_id","week_start","occurrence"),
	CONSTRAINT "ck_scheduled_sessions_slot" CHECK ("scheduled_sessions"."slot" in ('MORNING', 'AFTERNOON', 'EVENING', 'ANY')),
	CONSTRAINT "ck_scheduled_sessions_status" CHECK ("scheduled_sessions"."status" in ('PLANNED', 'DONE', 'PARTIAL', 'MISSED', 'SKIPPED', 'MOVED')),
	CONSTRAINT "ck_scheduled_sessions_change_source" CHECK ("scheduled_sessions"."change_source" in ('PLANNER', 'STUDENT', 'COACHING', 'STAFF'))
);
--> statement-breakpoint
CREATE TABLE "session_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"scheduled_session_id" uuid,
	"plan_session_id" uuid,
	"modality" varchar(16) NOT NULL,
	"performed_on" date NOT NULL,
	"status" varchar(16) DEFAULT 'IN_PROGRESS' NOT NULL,
	"source" varchar(24) NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"rpe" numeric(3, 1),
	"duration_minutes" smallint,
	"load" integer,
	"enjoyment" smallint,
	"pain_reports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"logged_late" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_session_executions_modality" CHECK ("session_executions"."modality" in ('STRENGTH', 'RUNNING', 'HYROX', 'EXTERNAL_SPORT')),
	CONSTRAINT "ck_session_executions_status" CHECK ("session_executions"."status" in ('IN_PROGRESS', 'COMPLETED', 'PARTIAL', 'ABANDONED')),
	CONSTRAINT "ck_session_executions_source" CHECK ("session_executions"."source" in ('LINK', 'WHATSAPP_TEXT', 'WHATSAPP_SCREENSHOT', 'FIT_FILE', 'GPX_FILE', 'STAFF'))
);
--> statement-breakpoint
CREATE TABLE "training_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" varchar(16) DEFAULT 'DRAFT' NOT NULL,
	"goal_id" uuid,
	"structure" jsonb NOT NULL,
	"starts_on" date NOT NULL,
	"methodology_versions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_training_plans_user_version" UNIQUE("user_id","version"),
	CONSTRAINT "ck_training_plans_status" CHECK ("training_plans"."status" in ('DRAFT', 'ACTIVE', 'SUPERSEDED'))
);
--> statement-breakpoint
CREATE TABLE "food_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" varchar(16) NOT NULL,
	"source_code" varchar(32),
	"name" varchar(200) NOT NULL,
	"search_name" varchar(200) NOT NULL,
	"category" varchar(80) NOT NULL,
	"per_100g" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_food_items_source_code" UNIQUE("source","source_code"),
	CONSTRAINT "ck_food_items_source" CHECK ("food_items"."source" in ('TACO', 'CUSTOM'))
);
--> statement-breakpoint
CREATE TABLE "food_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"logged_on" date NOT NULL,
	"meal" varchar(24) NOT NULL,
	"items" jsonb NOT NULL,
	"totals" jsonb NOT NULL,
	"source" varchar(16) NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"photo_path" varchar(120),
	"hunger" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_food_logs_meal" CHECK ("food_logs"."meal" in ('BREAKFAST', 'MORNING_SNACK', 'LUNCH', 'AFTERNOON_SNACK', 'DINNER', 'SUPPER', 'PRE_WORKOUT', 'POST_WORKOUT')),
	CONSTRAINT "ck_food_logs_source" CHECK ("food_logs"."source" in ('TEXT', 'PHOTO', 'MANUAL', 'AUDIO'))
);
--> statement-breakpoint
CREATE TABLE "nutrition_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" varchar(16) DEFAULT 'DRAFT' NOT NULL,
	"goal_id" uuid,
	"structure" jsonb NOT NULL,
	"starts_on" date NOT NULL,
	"methodology_versions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_nutrition_plans_user_version" UNIQUE("user_id","version"),
	CONSTRAINT "ck_nutrition_plans_status" CHECK ("nutrition_plans"."status" in ('DRAFT', 'ACTIVE', 'SUPERSEDED'))
);
--> statement-breakpoint
CREATE TABLE "body_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"assessed_on" date NOT NULL,
	"photo_ids" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"model_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "body_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(24) NOT NULL,
	"value" numeric(6, 2) NOT NULL,
	"method" varchar(16) NOT NULL,
	"measured_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_body_measurements_kind" CHECK ("body_measurements"."kind" in ('WEIGHT', 'WAIST', 'HIP', 'NECK', 'CHEST', 'ARM', 'THIGH', 'CALF', 'BODY_FAT_PERCENT')),
	CONSTRAINT "ck_body_measurements_method" CHECK ("body_measurements"."method" in ('SELF_TAPE', 'SCALE', 'BIOIMPEDANCE', 'SKINFOLD', 'DEXA', 'ESTIMATED'))
);
--> statement-breakpoint
CREATE TABLE "body_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"angle" varchar(8) NOT NULL,
	"taken_on" date NOT NULL,
	"storage_path" varchar(120) NOT NULL,
	"consent_id" uuid NOT NULL,
	"quality" jsonb,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_body_photos_angle" CHECK ("body_photos"."angle" in ('FRONT', 'SIDE', 'BACK'))
);
--> statement-breakpoint
CREATE TABLE "check_ins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'SENT' NOT NULL,
	"questions" jsonb NOT NULL,
	"answers" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"answered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_check_ins_kind" CHECK ("check_ins"."kind" in ('WEEKLY', 'MILESTONE', 'AD_HOC')),
	CONSTRAINT "ck_check_ins_status" CHECK ("check_ins"."status" in ('SENT', 'ANSWERED', 'EXPIRED'))
);
--> statement-breakpoint
CREATE TABLE "coaching_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"verdict" varchar(16) NOT NULL,
	"policy_version_id" uuid,
	"reasons" jsonb NOT NULL,
	"decided_by" varchar(16) NOT NULL,
	"staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_coaching_decisions_verdict" CHECK ("coaching_decisions"."verdict" in ('EXECUTE', 'ASK', 'ESCALATE', 'BLOCK')),
	CONSTRAINT "ck_coaching_decisions_decided_by" CHECK ("coaching_decisions"."decided_by" in ('POLICY_ENGINE', 'STAFF'))
);
--> statement-breakpoint
CREATE TABLE "coaching_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"trigger_event_id" uuid,
	"task_id" varchar(60) NOT NULL,
	"action_type" varchar(32) NOT NULL,
	"action" jsonb NOT NULL,
	"rationale" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"assumptions" jsonb NOT NULL,
	"uncertainty" varchar(8) NOT NULL,
	"expected_outcome" text NOT NULL,
	"state_version" smallint NOT NULL,
	"model_run_id" uuid,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_coaching_proposals_action" CHECK ("coaching_proposals"."action_type" in ('RESCHEDULE_WEEK', 'SUBSTITUTE_EXERCISE', 'SHORTEN_SESSION', 'ADJUST_WEEKLY_VOLUME', 'PUBLISH_TRAINING_PLAN', 'PUBLISH_NUTRITION_PLAN', 'ADJUST_ENERGY_TARGET', 'ADJUST_MEAL_GUIDANCE', 'DEFINE_STRATEGY', 'RECORD_PREFERENCE', 'RECORD_CONSTRAINT', 'SEND_MESSAGE', 'ASK_STUDENT')),
	CONSTRAINT "ck_coaching_proposals_uncertainty" CHECK ("coaching_proposals"."uncertainty" in ('LOW', 'MEDIUM', 'HIGH')),
	CONSTRAINT "ck_coaching_proposals_status" CHECK ("coaching_proposals"."status" in ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'SUPERSEDED'))
);
--> statement-breakpoint
CREATE TABLE "decision_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"command" varchar(60) NOT NULL,
	"status" varchar(16) NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_executions_decision_id_unique" UNIQUE("decision_id"),
	CONSTRAINT "ck_decision_executions_status" CHECK ("decision_executions"."status" in ('SUCCEEDED', 'FAILED', 'SKIPPED'))
);
--> statement-breakpoint
CREATE TABLE "exception_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"priority" varchar(8) NOT NULL,
	"status" varchar(16) DEFAULT 'OPEN' NOT NULL,
	"domain" varchar(16) NOT NULL,
	"subject" jsonb NOT NULL,
	"summary" text NOT NULL,
	"assigned_staff_id" uuid,
	"resolution" jsonb,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_exception_cases_kind" CHECK ("exception_cases"."kind" in ('SAFETY', 'NO_APPLICABLE_POLICY', 'STUDENT_REVIEW_REQUEST', 'DECISION_FAILURE', 'CONVERSATION_TAKEOVER')),
	CONSTRAINT "ck_exception_cases_priority" CHECK ("exception_cases"."priority" in ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
	CONSTRAINT "ck_exception_cases_status" CHECK ("exception_cases"."status" in ('OPEN', 'IN_REVIEW', 'RESOLVED')),
	CONSTRAINT "ck_exception_cases_domain" CHECK ("exception_cases"."domain" in ('TRAINING', 'NUTRITION', 'GENERAL'))
);
--> statement-breakpoint
CREATE TABLE "safety_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"severity" varchar(16) NOT NULL,
	"scope" varchar(16) NOT NULL,
	"detected_by" varchar(16) NOT NULL,
	"evidence" text NOT NULL,
	"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"resolved_by" uuid,
	"resolution_note" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_safety_events_kind" CHECK ("safety_events"."kind" in ('PARQ_POSITIVE', 'CHEST_PAIN', 'FAINTING_OR_DIZZINESS', 'SHORTNESS_OF_BREATH', 'SEVERE_PAIN', 'PERSISTENT_PAIN', 'NEW_INJURY', 'MEDICATION_CHANGE', 'PREGNANCY', 'RECENT_SURGERY', 'EATING_DISORDER_SIGNS', 'RAPID_WEIGHT_CHANGE', 'MENTAL_DISTRESS', 'OTHER')),
	CONSTRAINT "ck_safety_events_severity" CHECK ("safety_events"."severity" in ('ATTENTION', 'URGENT', 'EMERGENCY')),
	CONSTRAINT "ck_safety_events_scope" CHECK ("safety_events"."scope" in ('TRAINING', 'NUTRITION', 'ALL')),
	CONSTRAINT "ck_safety_events_detected_by" CHECK ("safety_events"."detected_by" in ('RULE', 'DETECTOR', 'STAFF')),
	CONSTRAINT "ck_safety_events_status" CHECK ("safety_events"."status" in ('ACTIVE', 'RESOLVED'))
);
--> statement-breakpoint
CREATE TABLE "domain_event_receipts" (
	"event_id" uuid NOT NULL,
	"consumer" varchar(60) NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domain_event_receipts_event_id_consumer_pk" PRIMARY KEY("event_id","consumer")
);
--> statement-breakpoint
CREATE TABLE "domain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"type" varchar(40) NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_domain_events_type" CHECK ("domain_events"."type" in ('OnboardingCompleted', 'StrategyDefined', 'PlanVersionPublished', 'NutritionPlanPublished', 'SessionScheduled', 'SessionRescheduled', 'SessionExecuted', 'SessionMissed', 'FoodLogged', 'CheckInSubmitted', 'BodyAssessmentRecorded', 'ConstraintChanged', 'PreferenceObserved', 'InboundMessageReceived', 'ProposalCreated', 'DecisionMade', 'DecisionExecuted', 'SafetySignalRaised', 'ExceptionOpened', 'ExceptionResolved', 'MethodologyPublished', 'SubscriptionActivated', 'SubscriptionPaymentFailed', 'SubscriptionCanceled'))
);
--> statement-breakpoint
ALTER TABLE "goal_milestones" ADD CONSTRAINT "goal_milestones_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_milestones" ADD CONSTRAINT "goal_milestones_goal_id_student_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."student_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_tasks" ADD CONSTRAINT "goal_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_tasks" ADD CONSTRAINT "goal_tasks_goal_id_student_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."student_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_constraints" ADD CONSTRAINT "student_constraints_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_goals" ADD CONSTRAINT "student_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_goals" ADD CONSTRAINT "student_goals_strategy_decision_id_coaching_decisions_id_fk" FOREIGN KEY ("strategy_decision_id") REFERENCES "public"."coaching_decisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_health_records" ADD CONSTRAINT "student_health_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_observations" ADD CONSTRAINT "student_observations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_preferences" ADD CONSTRAINT "student_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_state_snapshots" ADD CONSTRAINT "student_state_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_metrics" ADD CONSTRAINT "execution_metrics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_metrics" ADD CONSTRAINT "execution_metrics_execution_id_session_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."session_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_sets" ADD CONSTRAINT "execution_sets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_sets" ADD CONSTRAINT "execution_sets_execution_id_session_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."session_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_sessions" ADD CONSTRAINT "plan_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_sessions" ADD CONSTRAINT "plan_sessions_plan_id_training_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."training_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_sessions" ADD CONSTRAINT "scheduled_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_sessions" ADD CONSTRAINT "scheduled_sessions_plan_id_training_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."training_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_sessions" ADD CONSTRAINT "scheduled_sessions_plan_session_id_plan_sessions_id_fk" FOREIGN KEY ("plan_session_id") REFERENCES "public"."plan_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_sessions" ADD CONSTRAINT "scheduled_sessions_decision_id_coaching_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."coaching_decisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_executions" ADD CONSTRAINT "session_executions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_executions" ADD CONSTRAINT "session_executions_scheduled_session_id_scheduled_sessions_id_fk" FOREIGN KEY ("scheduled_session_id") REFERENCES "public"."scheduled_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_executions" ADD CONSTRAINT "session_executions_plan_session_id_plan_sessions_id_fk" FOREIGN KEY ("plan_session_id") REFERENCES "public"."plan_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_goal_id_student_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."student_goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_logs" ADD CONSTRAINT "food_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_plans" ADD CONSTRAINT "nutrition_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_plans" ADD CONSTRAINT "nutrition_plans_goal_id_student_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."student_goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_assessments" ADD CONSTRAINT "body_assessments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_photos" ADD CONSTRAINT "body_photos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_photos" ADD CONSTRAINT "body_photos_consent_id_consents_id_fk" FOREIGN KEY ("consent_id") REFERENCES "public"."consents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_decisions" ADD CONSTRAINT "coaching_decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_decisions" ADD CONSTRAINT "coaching_decisions_proposal_id_coaching_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."coaching_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_decisions" ADD CONSTRAINT "coaching_decisions_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_proposals" ADD CONSTRAINT "coaching_proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_executions" ADD CONSTRAINT "decision_executions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_executions" ADD CONSTRAINT "decision_executions_decision_id_coaching_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."coaching_decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception_cases" ADD CONSTRAINT "exception_cases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception_cases" ADD CONSTRAINT "exception_cases_assigned_staff_id_staff_id_fk" FOREIGN KEY ("assigned_staff_id") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_events" ADD CONSTRAINT "safety_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_events" ADD CONSTRAINT "safety_events_resolved_by_staff_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_event_receipts" ADD CONSTRAINT "domain_event_receipts_event_id_domain_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."domain_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_goal_milestones_user" ON "goal_milestones" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_goal_tasks_user_window" ON "goal_tasks" USING btree ("user_id","window_end");--> statement-breakpoint
CREATE INDEX "idx_student_constraints_user_active" ON "student_constraints" USING btree ("user_id","kind") WHERE "student_constraints"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "idx_student_goals_user_status" ON "student_goals" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_student_health_records_user" ON "student_health_records" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_student_observations_user" ON "student_observations" USING btree ("user_id","observed_at");--> statement-breakpoint
CREATE INDEX "idx_student_preferences_user_active" ON "student_preferences" USING btree ("user_id","domain","key") WHERE "student_preferences"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "idx_execution_metrics_user" ON "execution_metrics" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_execution_sets_user_exercise" ON "execution_sets" USING btree ("user_id","exercise_id");--> statement-breakpoint
CREATE INDEX "idx_plan_sessions_user" ON "plan_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_scheduled_sessions_user_day" ON "scheduled_sessions" USING btree ("user_id","scheduled_on");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_session_executions_scheduled" ON "session_executions" USING btree ("scheduled_session_id") WHERE "session_executions"."scheduled_session_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_session_executions_user_day" ON "session_executions" USING btree ("user_id","performed_on");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_training_plans_one_active" ON "training_plans" USING btree ("user_id") WHERE "training_plans"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "idx_food_items_active" ON "food_items" USING btree ("active","category");--> statement-breakpoint
CREATE INDEX "idx_food_logs_user_day" ON "food_logs" USING btree ("user_id","logged_on");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_nutrition_plans_one_active" ON "nutrition_plans" USING btree ("user_id") WHERE "nutrition_plans"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "idx_body_assessments_user" ON "body_assessments" USING btree ("user_id","assessed_on");--> statement-breakpoint
CREATE INDEX "idx_body_measurements_user_kind" ON "body_measurements" USING btree ("user_id","kind","measured_on");--> statement-breakpoint
CREATE INDEX "idx_body_photos_user_active" ON "body_photos" USING btree ("user_id","taken_on") WHERE "body_photos"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_check_ins_user" ON "check_ins" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_coaching_decisions_user" ON "coaching_decisions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_coaching_decisions_proposal" ON "coaching_decisions" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "idx_coaching_proposals_user" ON "coaching_proposals" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_decision_executions_user" ON "decision_executions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_exception_cases_open" ON "exception_cases" USING btree ("status","priority","created_at") WHERE "exception_cases"."status" <> 'RESOLVED';--> statement-breakpoint
CREATE INDEX "idx_exception_cases_user" ON "exception_cases" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_safety_events_user_active" ON "safety_events" USING btree ("user_id","scope") WHERE "safety_events"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "idx_domain_events_unpublished" ON "domain_events" USING btree ("occurred_at") WHERE "domain_events"."published_at" is null;--> statement-breakpoint
CREATE INDEX "idx_domain_events_user" ON "domain_events" USING btree ("user_id","occurred_at");