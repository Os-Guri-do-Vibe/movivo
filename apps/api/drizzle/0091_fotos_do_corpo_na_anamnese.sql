ALTER TYPE "public"."consent_type" ADD VALUE 'BODY_PHOTOS';--> statement-breakpoint
CREATE TABLE "anamnesis_session_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"anamnesis_session_id" uuid NOT NULL,
	"angle" varchar(8) NOT NULL,
	"format" varchar(8) NOT NULL,
	"size_bytes" integer NOT NULL,
	"content" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_anamnesis_session_photos_angle" UNIQUE("anamnesis_session_id","angle"),
	CONSTRAINT "ck_anamnesis_session_photos_angle" CHECK ("anamnesis_session_photos"."angle" in ('FRONT', 'RIGHT', 'BACK', 'LEFT')),
	CONSTRAINT "ck_anamnesis_session_photos_format" CHECK ("anamnesis_session_photos"."format" in ('jpeg', 'png', 'webp'))
);
--> statement-breakpoint
ALTER TABLE "body_photos" DROP CONSTRAINT "ck_body_photos_angle";--> statement-breakpoint
ALTER TABLE "anamnesis_session_photos" ADD CONSTRAINT "anamnesis_session_photos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anamnesis_session_photos" ADD CONSTRAINT "anamnesis_session_photos_anamnesis_session_id_anamnesis_sessions_id_fk" FOREIGN KEY ("anamnesis_session_id") REFERENCES "public"."anamnesis_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_photos" ADD CONSTRAINT "ck_body_photos_angle" CHECK ("body_photos"."angle" in ('FRONT', 'RIGHT', 'BACK', 'LEFT'));