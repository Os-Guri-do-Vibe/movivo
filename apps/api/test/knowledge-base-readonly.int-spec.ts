/**
 * Corpus do RAG somente-leitura para o runtime (US-3.3 / Sato §10.4 — anti-envenenamento),
 * reverificado como gate da Sprint 7 (TASK-7.9.5).
 *
 * A Sprint 7 introduziu escrita de configuração de IA pelo painel (`agent_config`). Este
 * teste prova que essa superfície nova **não** trouxe junto escrita no corpus: a role de
 * runtime (`movivo_app`) continua sem INSERT/UPDATE/DELETE em `knowledge_base` — a mesma
 * asserção sobre `information_schema.role_table_grants` usada em
 * `agent-config-immutability.int-spec.ts`, mais a tentativa real de escrita (42501).
 *
 * O `REVOKE` vem de `KNOWLEDGE_BASE_SQL` em `core/database/migrate.ts`, aplicado DEPOIS do
 * grant genérico — se alguém inverter essa ordem, ou remover o REVOKE, este teste falha.
 *
 * Pré-requisito: `pnpm run infra:up` + `db:migrate`.
 */
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

import { loadEnv } from '../src/core/config/load-env';

const { env } = loadEnv();

const appClient = postgres({
  host: env.DATABASE_HOST ?? 'localhost',
  port: Number(env.DATABASE_PORT ?? 5433),
  user: env.DATABASE_USER ?? 'movivo_app',
  password: env.DATABASE_PASSWORD,
  database: env.DATABASE_NAME ?? 'movivo',
  ssl: false,
  max: 2,
  prepare: false,
  idle_timeout: 5,
  onnotice: () => {
    /* notices podem conter valores — nunca vão para o log do teste. */
  },
});

afterAll(async () => {
  await appClient.end({ timeout: 5 });
});

describe('knowledge_base — corpus read-only para a role de runtime (TASK-7.9.5)', () => {
  it('a role de runtime não tem grant de INSERT/UPDATE/DELETE', async () => {
    const rows = await appClient<{ privilege_type: string }[]>`
      SELECT privilege_type FROM information_schema.role_table_grants
      WHERE table_name = 'knowledge_base'
        AND grantee = current_user
        AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
    `;
    expect(rows).toEqual([]);
  });

  it('a leitura continua permitida (o RAG precisa consultar o corpus)', async () => {
    const rows = await appClient<{ privilege_type: string }[]>`
      SELECT privilege_type FROM information_schema.role_table_grants
      WHERE table_name = 'knowledge_base'
        AND grantee = current_user AND privilege_type = 'SELECT'
    `;
    expect(rows).toHaveLength(1);
  });

  it('INSERT real é barrado por falta de privilégio (42501)', async () => {
    await expect(
      appClient`INSERT INTO knowledge_base (chunk_text, topic, title)
                VALUES ('conteudo injetado', 'hipertrofia', 'envenenamento')`,
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('UPDATE e DELETE reais são barrados por falta de privilégio (42501)', async () => {
    await expect(
      appClient`UPDATE knowledge_base SET chunk_text = 'adulterado'`,
    ).rejects.toMatchObject({ code: '42501' });
    await expect(appClient`DELETE FROM knowledge_base`).rejects.toMatchObject({ code: '42501' });
  });
});
