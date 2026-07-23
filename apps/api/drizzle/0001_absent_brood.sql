CREATE TYPE "public"."user_role" AS ENUM('USER', 'PROFESSIONAL', 'ADMIN');--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"jti" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" "user_role" DEFAULT 'USER' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_auth_sessions_jti" ON "auth_sessions" USING btree ("jti");--> statement-breakpoint
CREATE INDEX "idx_auth_sessions_user" ON "auth_sessions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_auth_sessions_family" ON "auth_sessions" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "idx_auth_sessions_expires_at" ON "auth_sessions" USING btree ("expires_at");