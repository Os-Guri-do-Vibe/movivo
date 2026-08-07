-- Sprint 5 hardening: um titular nao pode ter dois vinculos CREF ativos simultaneos.
CREATE UNIQUE INDEX "uq_professional_assignments_active_user" ON "professional_assignments" USING btree ("user_id") WHERE "professional_assignments"."active" = true AND "professional_assignments"."revoked_at" IS NULL;
