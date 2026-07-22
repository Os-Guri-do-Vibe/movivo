-- =============================================================================
-- MOVIVO — Extensões obrigatórias do PostgreSQL
-- =============================================================================
-- Dono: Henrique (Platform/SRE) · US-0.2 / TASK-0.2.1
-- Origem do requisito: ARQUITETURA.md §2 (stack) — "Extensões: vector,
-- uuid-ossp, pgcrypto".
--
-- Este script roda UMA ÚNICA VEZ, no bootstrap do cluster, executado pelo
-- entrypoint da imagem oficial como superusuário `postgres`, já conectado ao
-- banco `$POSTGRES_DB`. Se o volume nomeado já existir, o entrypoint pula todo
-- o /docker-entrypoint-initdb.d/ — por isso a migração 0000_init de Leonardo
-- (US-0.4/TASK-0.4.2) repete os CREATE EXTENSION IF NOT EXISTS: é a rede de
-- segurança para um banco provisionado fora deste Compose (staging/produção).
--
-- Ordem importa: este arquivo (01) precede a criação das roles (02), porque o
-- 02 reatribui a propriedade do schema `public` e endurece os GRANTs.
-- =============================================================================

-- Busca vetorial do RAG (corpus ACSM/NSCA/PubMed) — índice HNSW m=16,
-- ef_construction=64 vem na sprint de RAG, não aqui (ARQUITETURA.md §2).
CREATE EXTENSION IF NOT EXISTS vector;

-- Geração de UUID v4 para as PKs de todas as tabelas-base (US-0.4).
-- `pgcrypto` também oferece gen_random_uuid(); mantemos uuid-ossp porque o
-- schema lógico de Lucas (08-relatorio-lucas.md §9) a referencia explicitamente.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Criptografia em repouso das colunas de saúde (LGPD Art. 11) — a cifra em si
-- é implementada na sprint de anamnese; aqui só garantimos a extensão.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
