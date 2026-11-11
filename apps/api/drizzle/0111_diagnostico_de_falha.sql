-- Falha de geração (DECISION_FAILURE): tarefa, violações e a última saída reprovada do agente,
-- para diagnosticar o caso sem reproduzir a chamada ao modelo.
ALTER TABLE "exception_cases" ADD COLUMN "diagnostics" jsonb;
