/** RLS real: operações SQL sem filtros da aplicação e reconciliação de políticas. */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadEnv } from '../src/core/config/load-env';
import { buildRlsPoliciesSql, RLS_TENANT_TABLES } from '../src/core/database/security-policies';

const { env } = loadEnv();
const run = randomUUID();
const suffix = `${Date.now()}${Math.floor(Math.random() * 100)}`;
const app = postgres({
  host: env.DATABASE_HOST ?? 'localhost',
  port: Number(env.DATABASE_PORT ?? 5433),
  user: env.DATABASE_USER ?? 'movivo_app',
  password: env.DATABASE_PASSWORD,
  database: env.DATABASE_NAME ?? 'movivo',
  ssl: false,
  prepare: false,
  max: 1,
  onnotice: () => {
    /* Notices SQL não devem registrar valores da fixture. */
  },
});
const admin = postgres({
  host: env.MIGRATION_DATABASE_HOST ?? 'localhost',
  port: Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT ?? 15432),
  user: 'postgres',
  password: readFileSync(
    resolve(process.cwd(), '../../secrets/postgres_superuser_password'),
    'utf8',
  ).trimEnd(),
  database: env.DATABASE_NAME ?? 'movivo',
  ssl: false,
  max: 1,
  onnotice: () => {
    /* Notices SQL não devem registrar valores da fixture. */
  },
});
let userA: string;
let userB: string;
let messageA: string;
let messageB: string;
let professional: string;

async function context(tx: postgres.TransactionSql, userId: string, role: string) {
  await tx`SELECT set_config('app.current_user_id', ${userId}, true),
    set_config('app.current_role', ${role}, true)`;
}

async function rollbackApp(callback: (tx: postgres.TransactionSql) => Promise<void>) {
  const rollback = new Error('rollback esperado da fixture');
  await expect(
    app.begin(async (tx) => {
      await context(tx, userA, 'USER');
      await callback(tx);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
}

beforeAll(async () => {
  [userA, userB] = await admin.begin(async (tx) => {
    const rows = await tx<{ id: string }[]>`
      INSERT INTO users (phone_number, name, email)
      VALUES (${`+551${suffix}1`}, 'RLS A', ${`${run}-a@example.invalid`}),
        (${`+551${suffix}2`}, 'RLS B', ${`${run}-b@example.invalid`}) RETURNING id
    `;
    return rows.map((row) => row.id);
  });
  const messages = await admin<{ id: string }[]>`
    INSERT INTO conversations (user_id, direction, content)
    VALUES (${userA}::uuid, 'INBOUND', 'fixture A'), (${userB}::uuid, 'INBOUND', 'fixture B')
    RETURNING id
  `;
  [messageA, messageB] = messages.map((row) => row.id);
  const [staff] = await admin<{ id: string }[]>`
    INSERT INTO staff (phone_number, email, name, role, password_hash, cref_active)
    VALUES (${`+551${suffix}3`}, ${`${run}@example.invalid`}, 'RLS CREF', 'PROFESSIONAL', 'fixture', true)
    RETURNING id
  `;
  professional = staff.id;
  await admin`
    INSERT INTO professional_assignments (professional_id, user_id)
    VALUES (${professional}::uuid, ${userA}::uuid)
  `;
});

afterAll(async () => {
  try {
    if (!userA || !userB) return;
    await admin`DELETE FROM conversations WHERE user_id IN (${userA}::uuid, ${userB}::uuid)`;
    if (professional) {
      await admin`DELETE FROM professional_assignments WHERE professional_id = ${professional}::uuid`;
      await admin`DELETE FROM staff WHERE id = ${professional}::uuid`;
    }
    await admin`DELETE FROM users WHERE id IN (${userA}::uuid, ${userB}::uuid)`;
  } finally {
    await Promise.all([app.end({ timeout: 5 }), admin.end({ timeout: 5 })]);
  }
});

describe('RLS de vínculos — recurso e pai pertencem ao mesmo titular', () => {
  it.each(['anamnese', 'renovação', 'protocolo anterior', 'conversa', 'pagamento'])(
    'recusa vínculo cruzado de %s e aceita vínculo próprio',
    async (kind) => {
      for (const owner of [userB, userA]) {
        const rollback = new Error('rollback do vínculo permitido');
        const operation = app.begin(async (tx) => {
          await context(tx, '', 'SYSTEM');
          const [protocol] = await tx<{ id: string }[]>`
            INSERT INTO protocols (user_id, mesocycle_name, start_date, end_date, content, constraints)
            VALUES (${owner}::uuid, 'fixture', now(), now() + interval '1 day', '{}', '{}') RETURNING id
          `;
          let parent = protocol.id;
          if (kind === 'anamnese') {
            const [row] = await tx<{ id: string }[]>`
              INSERT INTO anamnesis_sessions (user_id, token, expires_at)
              VALUES (${owner}::uuid, ${randomUUID()}, now() + interval '1 day') RETURNING id
            `;
            parent = row.id;
          } else if (kind === 'renovação') {
            const [row] = await tx<{ id: string }[]>`
              INSERT INTO protocol_renewal_sessions (user_id, previous_protocol_id, token, expires_at)
              VALUES (${owner}::uuid, ${protocol.id}::uuid, ${randomUUID()}, now() + interval '1 day') RETURNING id
            `;
            parent = row.id;
          } else if (kind === 'pagamento') {
            const [row] = await tx<{ id: string }[]>`
              INSERT INTO subscriptions (user_id, plan, price_cents, monthly_price_cents, total_price_cents, commitment_months)
              VALUES (${owner}::uuid, 'MONTHLY', 3900, 3900, 3900, 1) RETURNING id
            `;
            parent = row.id;
          }
          await context(tx, userA, 'USER');
          if (kind === 'anamnese' || kind === 'renovação') {
            const column = kind === 'anamnese' ? 'anamnesis_session_id' : 'renewal_session_id';
            await tx.unsafe(
              `INSERT INTO protocols
              (user_id, ${column}, version, mesocycle_name, start_date, end_date, content, constraints)
              VALUES ($1::uuid, $2::uuid, 2, 'fixture', now(), now() + interval '1 day', '{}', '{}')`,
              [userA, parent],
            );
          } else if (kind === 'protocolo anterior') {
            await tx`INSERT INTO protocol_renewal_sessions (user_id, previous_protocol_id, token, expires_at)
              VALUES (${userA}::uuid, ${parent}::uuid, ${randomUUID()}, now() + interval '1 day')`;
          } else if (kind === 'conversa') {
            await tx`INSERT INTO conversations (user_id, protocol_id, direction, content)
              VALUES (${userA}::uuid, ${parent}::uuid, 'INBOUND', 'fixture')`;
          } else {
            await tx`INSERT INTO payments (user_id, subscription_id, gateway, gateway_event_id, status,
              amount_cents, net_amount_cents, occurred_at, raw_payload)
              VALUES (${userA}::uuid, ${parent}::uuid, 'MOCK', ${randomUUID()}, 'SETTLED', 3900, 3900, now(), '{}')`;
          }
          throw rollback;
        });
        if (owner === userB) await expect(operation).rejects.toMatchObject({ code: '42501' });
        else await expect(operation).rejects.toBe(rollback);
      }
    },
  );
});

describe('RLS por operação — titular A não acessa ou modifica B', () => {
  it('SELECT sem filtro de titular oculta B e mantém A visível', async () => {
    await rollbackApp(async (tx) => {
      const rows = await tx<{ id: string }[]>`
        SELECT id FROM conversations WHERE id IN (${messageA}::uuid, ${messageB}::uuid)
      `;
      expect(rows.map((row) => row.id)).toEqual([messageA]);
    });
  });

  it('INSERT próprio é permitido', async () => {
    await rollbackApp(async (tx) => {
      const rows = await tx`
        INSERT INTO conversations (user_id, direction, content)
        VALUES (${userA}::uuid, 'INBOUND', 'próprio') RETURNING id
      `;
      expect(rows).toHaveLength(1);
    });
  });

  it('INSERT atribuído a B é recusado por WITH CHECK', async () => {
    await expect(
      app.begin(async (tx) => {
        await context(tx, userA, 'USER');
        await tx`INSERT INTO conversations (user_id, direction, content)
          VALUES (${userB}::uuid, 'INBOUND', 'indevido')`;
        throw new Error('rollback de INSERT indevido');
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('UPDATE próprio funciona e UPDATE de B afeta zero linhas', async () => {
    await rollbackApp(async (tx) => {
      expect(
        await tx`UPDATE conversations SET content = 'próprio atualizado'
        WHERE id = ${messageA}::uuid RETURNING id`,
      ).toHaveLength(1);
      expect(
        await tx`UPDATE conversations SET content = 'indevido'
        WHERE id = ${messageB}::uuid RETURNING id`,
      ).toHaveLength(0);
    });
    const [row] = await admin<{ content: string }[]>`
      SELECT content FROM conversations WHERE id = ${messageB}::uuid
    `;
    expect(row.content).toBe('fixture B');
  });

  it('UPDATE não pode transferir a própria linha para B', async () => {
    await expect(
      app.begin(async (tx) => {
        await context(tx, userA, 'USER');
        await tx`UPDATE conversations SET user_id = ${userB}::uuid WHERE id = ${messageA}::uuid`;
        throw new Error('rollback de UPDATE indevido');
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('DELETE de A e B é negado ao aluno; SYSTEM tem operação válida', async () => {
    await rollbackApp(async (tx) => {
      expect(
        await tx`DELETE FROM conversations
        WHERE id IN (${messageA}::uuid, ${messageB}::uuid) RETURNING id`,
      ).toHaveLength(0);
      await context(tx, '', 'SYSTEM');
      expect(
        await tx`DELETE FROM conversations WHERE id = ${messageA}::uuid RETURNING id`,
      ).toHaveLength(1);
    });
  });
});

describe('Contexto ausente ou desconhecido não concede exceções', () => {
  it.each(['', 'DESCONHECIDO'])('atribuições não são visíveis com papel %j', async (role) => {
    await rollbackApp(async (tx) => {
      await context(tx, professional, role);
      expect(
        await tx`SELECT id FROM professional_assignments
        WHERE professional_id = ${professional}::uuid`,
      ).toHaveLength(0);
      await context(tx, professional, 'PROFESSIONAL');
      expect(
        await tx`SELECT id FROM professional_assignments
        WHERE professional_id = ${professional}::uuid`,
      ).toHaveLength(1);
    });
  });

  it.each(['', 'DESCONHECIDO'])('auditoria própria exige papel válido: %j', async (role) => {
    await expect(
      app.begin(async (tx) => {
        await context(tx, userA, role);
        await tx`INSERT INTO audit_logs (actor_id, user_id, action, entity_type, entity_id, changes)
          VALUES (${userA}::uuid, ${userA}::uuid, 'rls_test', 'user', ${userA}::uuid, '{}'::jsonb)`;
        throw new Error('rollback de auditoria indevida');
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('auditoria própria permanece permitida para USER, com rollback', async () => {
    await rollbackApp(async (tx) => {
      expect(
        await tx`INSERT INTO audit_logs
        (actor_id, user_id, action, entity_type, entity_id, changes)
        VALUES (${userA}::uuid, ${userA}::uuid, 'rls_test', 'user', ${userA}::uuid, '{}'::jsonb)
        RETURNING id`,
      ).toHaveLength(1);
    });
  });
});

describe('Catálogo e reconciliação de políticas efetivas', () => {
  it('cada operação tem política explícita; consents não concede DELETE', async () => {
    const policies = await admin<
      {
        tablename: string;
        policyname: string;
        cmd: string;
        qual: string | null;
        with_check: string | null;
      }[]
    >`
      SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies
      WHERE schemaname = 'public' AND tablename = ANY(${RLS_TENANT_TABLES})
    `;
    for (const table of RLS_TENANT_TABLES) {
      const expected =
        table === 'consents'
          ? ['INSERT', 'SELECT', 'UPDATE']
          : ['DELETE', 'INSERT', 'SELECT', 'UPDATE'];
      const entries = policies.filter((row) => row.tablename === table);
      expect(entries.map((row) => row.cmd).sort(), table).toEqual(expected);
      for (const policy of entries) {
        expect(policy.policyname).toBe(`${table}_rls_${policy.cmd.toLowerCase()}`);
        if (policy.cmd !== 'INSERT') expect(policy.qual).toBeTruthy();
        if (policy.cmd === 'INSERT' || policy.cmd === 'UPDATE') {
          expect(policy.with_check).toBeTruthy();
        }
      }
    }
  });

  it('reconciliação remove policy OR true sem publicar a policy insegura', async () => {
    const rollback = new Error('rollback esperado de DDL transacional');
    await expect(
      admin.begin(async (tx) => {
        await tx.unsafe(
          'CREATE POLICY rls_test_allow_all ON public.conversations FOR ALL USING (true) WITH CHECK (true)',
        );
        const [before] = await tx<{ count: number }[]>`
          SELECT count(*)::int AS count FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'conversations'
            AND policyname = 'rls_test_allow_all'
        `;
        expect(before.count).toBe(1);
        await tx.unsafe(buildRlsPoliciesSql());
        const [after] = await tx<{ count: number }[]>`
          SELECT count(*)::int AS count FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'conversations'
            AND policyname = 'rls_test_allow_all'
        `;
        expect(after.count).toBe(0);
        const remaining = await tx<{ cmd: string }[]>`
          SELECT cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = 'conversations'
        `;
        expect(remaining.map((row) => row.cmd).sort()).toEqual([
          'DELETE',
          'INSERT',
          'SELECT',
          'UPDATE',
        ]);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});
