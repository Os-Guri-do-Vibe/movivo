CREATE TYPE "public"."handoff_level" AS ENUM('ALERT', 'SAFETY');--> statement-breakpoint
CREATE TYPE "public"."handoff_status" AS ENUM('OPEN', 'RESOLVED');--> statement-breakpoint
CREATE TABLE "handoff_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"level" "handoff_level" NOT NULL,
	"reason" varchar(60) NOT NULL,
	"status" "handoff_status" DEFAULT 'OPEN' NOT NULL,
	"conversation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "handoff_alerts" ADD CONSTRAINT "handoff_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_handoff_alerts_user" ON "handoff_alerts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_handoff_alerts_queue" ON "handoff_alerts" USING btree ("status","level","created_at");