CREATE TABLE "dashboard_notification_reads" (
	"user_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"ref_id" uuid NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_notification_reads_user_id_kind_ref_id_pk" PRIMARY KEY("user_id","kind","ref_id")
);
--> statement-breakpoint
ALTER TABLE "dashboard_notification_reads" ADD CONSTRAINT "dashboard_notification_reads_user_id_staff_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_dashboard_notification_reads_user" ON "dashboard_notification_reads" USING btree ("user_id","read_at");