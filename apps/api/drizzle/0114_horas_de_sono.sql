-- Horas dormidas na noite passada, informadas nas perguntas do dia (em minutos, de 1 h a 16 h).
ALTER TABLE "daily_check_ins" ADD COLUMN "sleep_minutes" smallint;--> statement-breakpoint
ALTER TABLE "daily_check_ins" ADD CONSTRAINT "ck_daily_check_ins_sleep_minutes" CHECK ("daily_check_ins"."sleep_minutes" is null or "daily_check_ins"."sleep_minutes" between 60 and 960);
