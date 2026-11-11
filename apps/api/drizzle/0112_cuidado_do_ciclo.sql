-- Lembretes de autocuidado do ciclo menstrual entram na memória de contatos proativos
-- (`agent_outreaches`), como os demais fluxos que a MOVIVO inicia.
ALTER TABLE "agent_outreaches" DROP CONSTRAINT "ck_agent_outreaches_kind";--> statement-breakpoint
ALTER TABLE "agent_outreaches" ADD CONSTRAINT "ck_agent_outreaches_kind" CHECK ("agent_outreaches"."kind" in ('LOGGING_GAP', 'MISSED_SESSION', 'SILENCE', 'COMMITMENT_NUDGE', 'SPECIALIST_DAILY', 'CYCLE_CARE'));
