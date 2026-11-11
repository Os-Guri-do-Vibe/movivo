-- Assinatura do protocolo: quem liberou, quando, e o SHA-256 do conteúdo liberado. Prova, meses
-- depois, que o entregue é o que o profissional assinou. Liberação automática (janela vencida)
-- não é assinatura: as três colunas ficam nulas.
ALTER TABLE "training_plans" ADD COLUMN "signed_by" uuid;--> statement-breakpoint
ALTER TABLE "training_plans" ADD COLUMN "signed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "training_plans" ADD COLUMN "signature_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "nutrition_plans" ADD COLUMN "signed_by" uuid;--> statement-breakpoint
ALTER TABLE "nutrition_plans" ADD COLUMN "signed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "nutrition_plans" ADD COLUMN "signature_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_signed_by_staff_id_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_plans" ADD CONSTRAINT "nutrition_plans_signed_by_staff_id_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_plans" ADD CONSTRAINT "ck_training_plans_signature" CHECK (("training_plans"."signed_at" IS NULL) = ("training_plans"."signature_hash" IS NULL));--> statement-breakpoint
ALTER TABLE "nutrition_plans" ADD CONSTRAINT "ck_nutrition_plans_signature" CHECK (("nutrition_plans"."signed_at" IS NULL) = ("nutrition_plans"."signature_hash" IS NULL));
