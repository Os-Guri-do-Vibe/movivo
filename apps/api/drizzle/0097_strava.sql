CREATE TABLE "wearable_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" varchar(16) DEFAULT 'STRAVA' NOT NULL,
	"athlete_id" varchar(24) NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session_executions" DROP CONSTRAINT "ck_session_executions_source";--> statement-breakpoint
ALTER TABLE "session_executions" ADD COLUMN "external_id" varchar(64);--> statement-breakpoint
ALTER TABLE "wearable_connections" ADD CONSTRAINT "wearable_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_wearable_connections_user" ON "wearable_connections" USING btree ("user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_wearable_connections_athlete" ON "wearable_connections" USING btree ("provider","athlete_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_session_executions_external" ON "session_executions" USING btree ("user_id","external_id") WHERE "session_executions"."external_id" is not null;--> statement-breakpoint
ALTER TABLE "session_executions" ADD CONSTRAINT "ck_session_executions_source" CHECK ("session_executions"."source" in ('LINK', 'WHATSAPP_TEXT', 'WHATSAPP_SCREENSHOT', 'FIT_FILE', 'GPX_FILE', 'STAFF', 'STRAVA'));