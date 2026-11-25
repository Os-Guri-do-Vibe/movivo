CREATE TABLE "eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" varchar(60) NOT NULL,
	"prompt_version" varchar(64) NOT NULL,
	"methodology_versions" jsonb NOT NULL,
	"vendor" varchar(16),
	"model" varchar(80),
	"cases_total" integer NOT NULL,
	"cases_passed" integer NOT NULL,
	"passed" boolean NOT NULL,
	"cost_brl" numeric(10, 5) NOT NULL,
	"results" jsonb NOT NULL,
	"requested_by" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_requested_by_staff_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_eval_runs_task" ON "eval_runs" USING btree ("task_id","finished_at");