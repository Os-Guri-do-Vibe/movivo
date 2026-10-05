CREATE TABLE "access_link_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" varchar(24) NOT NULL,
	"resource_id" uuid NOT NULL,
	"token_hash" char(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_access_link_tokens_purpose" CHECK ("access_link_tokens"."purpose" in ('PROTOCOL', 'CHECKOUT', 'SUBSCRIPTION_PORTAL'))
);
--> statement-breakpoint
ALTER TABLE "access_link_tokens" ADD CONSTRAINT "access_link_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_access_link_tokens_hash" ON "access_link_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_access_link_tokens_resource" ON "access_link_tokens" USING btree ("user_id","purpose","resource_id");