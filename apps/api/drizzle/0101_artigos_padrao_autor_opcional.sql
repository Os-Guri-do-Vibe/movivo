-- Artigos padrão da Base de Conhecimento: a carga do deploy não tem autor (mesma regra das fichas
-- dos agentes e da metodologia padrão: created_by/published_by nulos). Só afrouxa a obrigatoriedade;
-- todo artigo enviado pelo painel continua gravando quem enviou. Os artigos em si entram no fim do
-- migrate.ts (default-articles.ts), com texto, trechos e vetores versionados em assets/knowledge/.
ALTER TABLE "knowledge_documents" ALTER COLUMN "uploaded_by" DROP NOT NULL;
