ALTER TABLE "short_links" DROP CONSTRAINT "ck_short_links_code_len";--> statement-breakpoint
ALTER TABLE "short_links" ALTER COLUMN "code" SET DATA TYPE varchar(64);--> statement-breakpoint
-- Credenciais antigas, de baixa entropia, não podem continuar autorizando redirects.
UPDATE "short_links" SET "code" = encode(digest("code", 'sha256'), 'hex'),
  "expires_at" = LEAST("expires_at", now()), "updated_at" = now();--> statement-breakpoint
ALTER TABLE "short_links" ADD CONSTRAINT "ck_short_links_code_len" CHECK (char_length("short_links"."code") = 64);
