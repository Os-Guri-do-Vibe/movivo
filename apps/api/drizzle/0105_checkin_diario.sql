-- Check-in do dia: disposição, sono, corpo, estresse, ânimo e alimentação (uma linha por aluno e dia).
CREATE TABLE "daily_check_ins" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "on_date" date NOT NULL,
  "energy" smallint,
  "sleep" smallint,
  "soreness" smallint,
  "mood" smallint,
  "stress" smallint,
  "nutrition" varchar(10),
  "source" varchar(8) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_daily_check_ins_day" UNIQUE("user_id","on_date"),
  CONSTRAINT "ck_daily_check_ins_scales" CHECK (("daily_check_ins"."energy" is null or "daily_check_ins"."energy" between 1 and 5)
        and ("daily_check_ins"."sleep" is null or "daily_check_ins"."sleep" between 1 and 5)
        and ("daily_check_ins"."soreness" is null or "daily_check_ins"."soreness" between 1 and 5)
        and ("daily_check_ins"."mood" is null or "daily_check_ins"."mood" between 1 and 5)
        and ("daily_check_ins"."stress" is null or "daily_check_ins"."stress" between 1 and 5)),
  CONSTRAINT "ck_daily_check_ins_nutrition" CHECK ("daily_check_ins"."nutrition" is null or "daily_check_ins"."nutrition" in ('ON_TRACK', 'PARTIAL', 'OFF')),
  CONSTRAINT "ck_daily_check_ins_source" CHECK ("daily_check_ins"."source" in ('SESSION', 'DAILY'))
);--> statement-breakpoint
ALTER TABLE "daily_check_ins" ADD CONSTRAINT "daily_check_ins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_daily_check_ins_user" ON "daily_check_ins" USING btree ("user_id","on_date");
