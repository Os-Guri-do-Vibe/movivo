-- FAQ e guardrails L1 padrão: a carga do deploy não tem autor (mesma regra das fichas dos agentes,
-- da metodologia padrão e dos artigos: created_by nulo = carga do sistema). Só afrouxa a
-- obrigatoriedade; tudo que a equipe publica pelo painel continua gravando quem publicou.
-- As linhas em si entram no fim do migrate.ts (default-ai-config.ts), só se ainda não existirem.
ALTER TABLE "faq_entries" ALTER COLUMN "created_by" DROP NOT NULL;
ALTER TABLE "ai_guardrail_rules" ALTER COLUMN "created_by" DROP NOT NULL;
