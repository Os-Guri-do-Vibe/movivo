CREATE TABLE "conversation_followups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"subject_date" date NOT NULL,
	"session_key" varchar(60),
	"workout_session_id" uuid,
	"protocol_id" uuid,
	"topic_label" varchar(120) NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING_SEND' NOT NULL,
	"delivered_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_conversation_followups_user_kind_subject" UNIQUE("user_id","kind","subject_date"),
	CONSTRAINT "ck_conversation_followups_status" CHECK ("conversation_followups"."status" in ('PENDING_SEND','OPEN','ANSWERED','RESUMED','EXPIRED','CANCELLED','NOT_SENT')),
	CONSTRAINT "ck_conversation_followups_open_delivered" CHECK ("conversation_followups"."status" <> 'OPEN' or "conversation_followups"."delivered_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "conversation_followups" ADD CONSTRAINT "conversation_followups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_followups" ADD CONSTRAINT "conversation_followups_workout_session_id_workout_sessions_id_fk" FOREIGN KEY ("workout_session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_followups" ADD CONSTRAINT "conversation_followups_protocol_id_protocols_id_fk" FOREIGN KEY ("protocol_id") REFERENCES "public"."protocols"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_conversation_followups_user_open" ON "conversation_followups" USING btree ("user_id","delivered_at") WHERE "conversation_followups"."status" = 'OPEN';--> statement-breakpoint
CREATE INDEX "idx_conversation_followups_user_created" ON "conversation_followups" USING btree ("user_id","created_at");