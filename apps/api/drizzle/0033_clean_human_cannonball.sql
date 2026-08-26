ALTER TABLE "protocols" ADD COLUMN "mesocycle_name" varchar(120);--> statement-breakpoint
ALTER TABLE "protocols" ADD COLUMN "start_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "protocols" ADD COLUMN "end_date" timestamp with time zone;--> statement-breakpoint
UPDATE "protocols" SET
  "start_date" = COALESCE("start_date", "created_at"),
  "end_date" = COALESCE("end_date", "created_at" + ("total_weeks" || ' weeks')::interval),
  "mesocycle_name" = COALESCE(
    "mesocycle_name",
    'Mesociclo ' || "version" || ' — ' || CASE (content->>'phase')
      WHEN 'ADAPTACAO' THEN 'Adaptação'
      WHEN 'HIPERTROFIA' THEN 'Hipertrofia'
      WHEN 'FORCA' THEN 'Força'
      WHEN 'DELOAD' THEN 'Recuperação (deload)'
      ELSE content->>'phase'
    END
  )
WHERE "mesocycle_name" IS NULL OR "start_date" IS NULL OR "end_date" IS NULL;--> statement-breakpoint
ALTER TABLE "protocols" ALTER COLUMN "mesocycle_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "protocols" ALTER COLUMN "start_date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "protocols" ALTER COLUMN "end_date" SET NOT NULL;
