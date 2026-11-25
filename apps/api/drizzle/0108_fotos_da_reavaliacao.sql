-- Fotos da reavaliação de ciclo: quatro posições, conteúdo cifrado, presas ao consentimento das fotos.
CREATE TABLE "cycle_reassessment_photos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "reassessment_id" uuid NOT NULL,
  "angle" varchar(8) NOT NULL,
  "format" varchar(8) NOT NULL,
  "size_bytes" integer NOT NULL,
  "content" bytea NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_cycle_reassessment_photos_angle" UNIQUE("reassessment_id","angle"),
  CONSTRAINT "ck_cycle_reassessment_photos_angle" CHECK ("cycle_reassessment_photos"."angle" in ('FRONT', 'RIGHT', 'BACK', 'LEFT')),
  CONSTRAINT "ck_cycle_reassessment_photos_format" CHECK ("cycle_reassessment_photos"."format" in ('jpeg', 'png', 'webp'))
);--> statement-breakpoint
ALTER TABLE "cycle_reassessment_photos" ADD CONSTRAINT "cycle_reassessment_photos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_reassessment_photos" ADD CONSTRAINT "cycle_reassessment_photos_reassessment_id_cycle_reassessments_id_fk" FOREIGN KEY ("reassessment_id") REFERENCES "public"."cycle_reassessments"("id") ON DELETE cascade ON UPDATE no action;
