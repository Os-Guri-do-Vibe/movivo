CREATE TYPE "public"."substitution_request_status" AS ENUM('PENDING', 'RELEASED', 'DISCARDED');--> statement-breakpoint
CREATE TABLE "protocol_substitution_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"protocol_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"from_exercise_id" varchar(100) NOT NULL,
	"from_exercise_name" varchar(200) NOT NULL,
	"to_exercise_id" varchar(100) NOT NULL,
	"to_exercise_name" varchar(200) NOT NULL,
	"proposed_content" jsonb NOT NULL,
	"diff" jsonb NOT NULL,
	"change_reason" text NOT NULL,
	"base_version" smallint NOT NULL,
	"status" "substitution_request_status" DEFAULT 'PENDING' NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "protocol_substitution_requests" ADD CONSTRAINT "protocol_substitution_requests_protocol_id_protocols_id_fk" FOREIGN KEY ("protocol_id") REFERENCES "public"."protocols"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_substitution_requests" ADD CONSTRAINT "protocol_substitution_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_substitution_requests" ADD CONSTRAINT "protocol_substitution_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_protocol_substitution_requests_pending" ON "protocol_substitution_requests" USING btree ("protocol_id") WHERE "protocol_substitution_requests"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "idx_protocol_substitution_requests_user" ON "protocol_substitution_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_protocol_substitution_requests_queue" ON "protocol_substitution_requests" USING btree ("status","created_at");