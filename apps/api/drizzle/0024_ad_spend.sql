CREATE TABLE "ad_spend" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"campaign" text NOT NULL,
	"spent_on" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"reverses_ad_spend_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_ad_spend_reversal" UNIQUE("reverses_ad_spend_id")
);
--> statement-breakpoint
ALTER TABLE "ad_spend" ADD CONSTRAINT "ad_spend_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ad_spend_spent_on" ON "ad_spend" USING btree ("spent_on");--> statement-breakpoint
CREATE INDEX "idx_ad_spend_channel" ON "ad_spend" USING btree ("channel","spent_on");