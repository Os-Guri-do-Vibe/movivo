-- Sprint 5: distingue assinatura humana CREF de aprovacao automatica da metodologia.
ALTER TYPE "public"."protocol_approval_status" ADD VALUE 'HUMAN_APPROVED' BEFORE 'BLOCKED_PENDING_CLEARANCE';
