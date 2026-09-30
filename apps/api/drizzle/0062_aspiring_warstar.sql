ALTER TABLE "exercise_catalog_entries" ADD COLUMN "levels" jsonb;--> statement-breakpoint
-- Backfill (decisão do fundador 2026-09-29, `levels` substitui `min_level` como seleção múltipla).
-- Aditiva: `min_level` continua NOT NULL e gravado pela API nova (menor nível marcado), então a
-- versão anterior da API segue funcionando após rollback só de imagem. O mapeamento preserva
-- EXATAMENTE o comportamento atual ("a partir de X"); é o mesmo de `levelsFromMinLevel()`.
UPDATE "exercise_catalog_entries"
SET "levels" = CASE "min_level"
  WHEN 'INICIANTE' THEN '["INICIANTE","INTERMEDIARIO","AVANCADO"]'::jsonb
  WHEN 'INTERMEDIARIO' THEN '["INTERMEDIARIO","AVANCADO"]'::jsonb
  WHEN 'AVANCADO' THEN '["AVANCADO"]'::jsonb
END
WHERE "levels" IS NULL;
