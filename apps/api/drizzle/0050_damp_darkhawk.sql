CREATE TYPE "public"."protocol_renewal_status" AS ENUM('IN_PROGRESS', 'SUBMITTED', 'EXPIRED', 'PROCESSED');--> statement-breakpoint
CREATE TABLE "protocol_renewal_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"previous_protocol_id" uuid NOT NULL,
	"token" varchar(64) NOT NULL,
	"status" "protocol_renewal_status" DEFAULT 'IN_PROGRESS' NOT NULL,
	"last_step" smallint DEFAULT 1 NOT NULL,
	"data_block_1" jsonb,
	"data_block_2" jsonb,
	"data_block_3" "bytea",
	"data_block_4" jsonb,
	"data_block_5" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "protocol_renewal_sessions_token_unique" UNIQUE("token"),
	CONSTRAINT "uq_protocol_renewal_sessions_previous_protocol" UNIQUE("previous_protocol_id")
);
--> statement-breakpoint
ALTER TABLE "protocols" DROP CONSTRAINT "uq_protocols_user_version";--> statement-breakpoint
ALTER TABLE "protocols" ADD COLUMN "renewal_session_id" uuid;--> statement-breakpoint
ALTER TABLE "protocols" ADD COLUMN "mesocycle_number" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "protocol_renewal_sessions" ADD CONSTRAINT "protocol_renewal_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_renewal_sessions" ADD CONSTRAINT "protocol_renewal_sessions_previous_protocol_id_protocols_id_fk" FOREIGN KEY ("previous_protocol_id") REFERENCES "public"."protocols"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_protocol_renewal_sessions_user" ON "protocol_renewal_sessions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_protocol_renewal_sessions_status" ON "protocol_renewal_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_protocol_renewal_sessions_expires_at" ON "protocol_renewal_sessions" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_renewal_session_id_protocol_renewal_sessions_id_fk" FOREIGN KEY ("renewal_session_id") REFERENCES "public"."protocol_renewal_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_protocols_renewal_session" ON "protocols" USING btree ("renewal_session_id");--> statement-breakpoint
ALTER TABLE "protocols" ADD CONSTRAINT "uq_protocols_user_mesocycle_version" UNIQUE("user_id","mesocycle_number","version");