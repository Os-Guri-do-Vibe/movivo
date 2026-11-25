-- O que o aluno conta do treino ao fechar ("como você se sentiu?"), em texto livre: o
-- especialista do retorno pós-treino lê junto do esforço e da dor.
ALTER TABLE "session_executions" ADD COLUMN "feedback" varchar(1000);
