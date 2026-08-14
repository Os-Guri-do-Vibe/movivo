CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"share_basis_points" integer NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_partners_name_valid_from" UNIQUE("name","valid_from"),
	CONSTRAINT "ck_partners_share_range" CHECK ("share_basis_points" > 0 AND "share_basis_points" <= 10000)
);
--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_partners_valid_to" ON "partners" USING btree ("valid_to");--> statement-breakpoint
-- Fechamento do cap table em 10.000 bps, imposto pelo banco.
--
-- DEFERRABLE INITIALLY DEFERRED: uma troca de composicao fecha linhas e abre outras na
-- MESMA transacao e passa por estados intermediarios invalidos; validar por linha
-- tornaria qualquer alteracao impossivel. Validado no commit, que e o unico momento em
-- que "a soma das vigentes" tem significado.
--
-- A tabela vazia e valida (soma 0): antes do seed nao ha cap table, e nao ha o que fechar.
CREATE OR REPLACE FUNCTION public.partners_assert_share_total()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total integer;
BEGIN
  SELECT coalesce(sum(share_basis_points), 0) INTO total FROM public.partners WHERE valid_to IS NULL;
  IF total NOT IN (0, 10000) THEN
    RAISE EXCEPTION 'partners: soma das participacoes vigentes e % bps, deve ser exatamente 10000', total
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.partners_assert_share_total() FROM PUBLIC;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trg_partners_share_total
  AFTER INSERT OR UPDATE OR DELETE ON public.partners
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.partners_assert_share_total();--> statement-breakpoint
-- Semente do quadro societario ja definido (CLAUDE.md): 5 socios, 20% cada = 2.000 bps.
-- `valid_from` = data do primeiro commit do repositorio (inicio do projeto).
-- Vesting e clausula de desempate NAO estao formalizados — a tela diz isso com todas as
-- letras; a tabela registra a participacao atual, nao um acordo assinado.
INSERT INTO "partners" ("name", "share_basis_points", "valid_from", "notes")
VALUES
  ('Rodrigo', 2000, '2026-07-22', 'Fundador — desenvolvimento'),
  ('Pedro', 2000, '2026-07-22', 'Fundador — desenvolvimento'),
  ('Joaquim', 2000, '2026-07-22', 'Fundador — desenvolvimento'),
  ('Cahuã', 2000, '2026-07-22', 'Fundador — marca, marketing e vendas'),
  ('Treinador do Cahuã', 2000, '2026-07-22', 'Fundador — Responsável Técnico CREF')
ON CONFLICT ("name", "valid_from") DO NOTHING;
