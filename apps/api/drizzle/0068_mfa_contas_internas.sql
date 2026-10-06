ALTER TABLE "staff" ADD COLUMN "mfa_secret_cipher" "bytea";--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "mfa_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "mfa_last_step" bigint;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "mfa_recovery_hashes" text[];