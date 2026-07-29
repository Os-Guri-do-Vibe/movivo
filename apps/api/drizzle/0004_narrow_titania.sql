ALTER TABLE "ai_jobs" ADD COLUMN "provider" varchar(30);--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD COLUMN "data_class" varchar(12);--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD COLUMN "tokens_cached" integer;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD COLUMN "attempt" smallint;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD COLUMN "intent" varchar(30);--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD COLUMN "cost_brl" numeric(10, 5);--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD COLUMN "validation_action" varchar(20);--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD COLUMN "input_snapshot" text;