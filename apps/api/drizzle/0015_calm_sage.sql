-- Assinaturas de protocolo sempre apontam para uma identidade real; a elegibilidade
-- CREF e a atribuição ativa continuam validadas pela função fail-closed da aplicação.
-- Primeiro, remapeia o identificador legado para o CREF real atualmente atribuído.
UPDATE "protocols" AS protocol
SET "professional_id" = assignment."professional_id", "updated_at" = now()
FROM "professional_assignments" AS assignment
INNER JOIN "users" AS professional ON professional."id" = assignment."professional_id"
WHERE protocol."professional_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "users" AS existing
    INNER JOIN "professional_assignments" AS existing_assignment
      ON existing_assignment."professional_id" = existing."id"
     AND existing_assignment."user_id" = protocol."user_id"
     AND existing_assignment."active" = true
     AND existing_assignment."revoked_at" IS NULL
    WHERE existing."id" = protocol."professional_id"
      AND existing."role" = 'PROFESSIONAL'
      AND existing."cref_active" = true
  )
  AND assignment."user_id" = protocol."user_id"
  AND assignment."active" = true
  AND assignment."revoked_at" IS NULL
  AND professional."role" = 'PROFESSIONAL'
  AND professional."cref_active" = true;
--> statement-breakpoint
-- Sem vínculo CREF válido, a migração invalida a assinatura órfã e exige revisão
-- humana. Nenhum protocolo ACTIVE permanece atribuído a uma identidade inexistente.
UPDATE "protocols" AS protocol
SET "professional_id" = NULL,
    "signed_at" = NULL,
    "signature_hash" = NULL,
    "status" = 'PENDING_SIGNATURE',
    "approval_status" = 'PENDING_REVIEW',
    "human_review_required" = true,
    "updated_at" = now()
WHERE protocol."professional_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "users" AS existing
    INNER JOIN "professional_assignments" AS existing_assignment
      ON existing_assignment."professional_id" = existing."id"
     AND existing_assignment."user_id" = protocol."user_id"
     AND existing_assignment."active" = true
     AND existing_assignment."revoked_at" IS NULL
    WHERE existing."id" = protocol."professional_id"
      AND existing."role" = 'PROFESSIONAL'
      AND existing."cref_active" = true
  );
--> statement-breakpoint
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_professional_id_users_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
