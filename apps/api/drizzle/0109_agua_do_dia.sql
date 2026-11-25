-- Água do dia (ml), somada a cada registro do aluno pelo WhatsApp.
ALTER TABLE "daily_check_ins" ADD COLUMN "water_ml" integer;--> statement-breakpoint
ALTER TABLE "daily_check_ins" ADD CONSTRAINT "ck_daily_check_ins_water" CHECK ("daily_check_ins"."water_ml" is null or "daily_check_ins"."water_ml" between 0 and 15000);
