ALTER TABLE "users" RENAME COLUMN "coach_paused_at" TO "attendance_paused_at";--> statement-breakpoint
-- `conversations` está sob RLS FORCE: o migrador atua como SYSTEM só nesta transação.
SELECT set_config('app.current_role', 'SYSTEM', true);--> statement-breakpoint
UPDATE "conversations" SET "origin" = 'AGENT' WHERE "origin" = 'COACH';
