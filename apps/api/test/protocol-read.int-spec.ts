/**
 * Teste de integração da LEITURA read-only do protocolo (US-2.6 / TASK-2.6.1).
 *
 * Roda contra o stack real, como a aplicação (`movivo_app` via PgBouncer 5433). Prova o
 * contrato IDOR-safe de `ProtocolRepository.findByToken` (o que o endpoint público
 * devolve):
 *   - protocolo ACTIVE (auto-aprovado/assinado) → DTO **sem `userId`/PII**;
 *   - protocolo não-ACTIVE (PENDING_SIGNATURE) → null (o controller vira 404);
 *   - UUID inexistente → null.
 *
 * Pré-requisito: `pnpm run infra:up` + `db:migrate`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ProtocolStructure } from '@movivo/shared';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

import { loadEnv } from '../src/core/config/load-env';
import { type DrizzleClient } from '../src/core/database/database.module';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { ProtocolRepository } from '../src/modules/protocol/protocol.repository';

const { env } = loadEnv();
const apiRoot = process.cwd();
const RUN = Date.now().toString().slice(-8);

const appClient = postgres({
  host: env.DATABASE_HOST ?? 'localhost',
  port: Number(env.DATABASE_PORT ?? 5433),
  user: env.DATABASE_USER ?? 'movivo_app',
  password: env.DATABASE_PASSWORD,
  database: env.DATABASE_NAME ?? 'movivo',
  ssl: false,
  max: 3,
  prepare: false,
  idle_timeout: 5,
  onnotice: () => undefined,
});
const db = drizzle(appClient) as unknown as DrizzleClient;
const tenant = new TenantDatabase(db);
const repo = new ProtocolRepository(tenant);

const adminClient = postgres({
  host: env.MIGRATION_DATABASE_HOST ?? 'localhost',
  port: Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT ?? 15432),
  user: 'postgres',
  password: readFileSync(
    resolve(apiRoot, '..', '..', 'secrets', 'postgres_superuser_password'),
    'utf8',
  ).trimEnd(),
  database: env.DATABASE_NAME ?? 'movivo',
  ssl: false,
  max: 1,
  idle_timeout: 5,
  onnotice: () => undefined,
});

const content: ProtocolStructure = {
  promptVersion: 'v1',
  goal: 'GAIN_MUSCLE',
  phase: 'ADAPTACAO',
  weeklyFrequency: 3,
  sessions: [
    {
      dayLabel: 'A',
      focus: 'Full body',
      exercises: [
        {
          exerciseId: 'goblet_squat',
          name: 'Agachamento',
          sets: 3,
          reps: { min: 8, max: 12 },
          loadStrategy: 'DOUBLE_PROGRESSION',
          restSeconds: 90,
        },
      ],
    },
  ],
};

let seq = 0;
async function createUser(): Promise<string> {
  const phone = `+5542${RUN}${(seq += 1)}`;
  const [row] = await adminClient<Array<{ id: string }>>`
    INSERT INTO users (phone_number) VALUES (${phone}) RETURNING id`;
  return row.id;
}

function persistInput(userId: string, active: boolean) {
  return {
    userId,
    content,
    constraints: {},
    parqFlags: [],
    approvalStatus: (active ? 'AUTO_APPROVED' : 'PENDING_REVIEW') as
      'AUTO_APPROVED' | 'PENDING_REVIEW',
    status: (active ? 'ACTIVE' : 'PENDING_SIGNATURE') as 'ACTIVE' | 'PENDING_SIGNATURE',
    humanReviewRequired: !active,
    totalWeeks: 12,
    generatedBy: 'AI',
    modelVersion: 'gpt-4.1',
    promptVersion: 'v1',
    signed: active,
  };
}

afterAll(async () => {
  try {
    await adminClient.unsafe(
      `DELETE FROM protocol_versions WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5542${RUN}%');
       DELETE FROM protocols WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5542${RUN}%');
       DELETE FROM users WHERE phone_number LIKE '+5542${RUN}%';`,
    );
  } finally {
    await Promise.all([appClient.end({ timeout: 5 }), adminClient.end({ timeout: 5 })]);
  }
}, 30_000);

describe('LEITURA read-only do protocolo (US-2.6)', () => {
  it('protocolo ACTIVE → DTO sem userId, com respaldo CREF', async () => {
    const userId = await createUser();
    const { protocolId } = await repo.persist(persistInput(userId, true));

    const dto = await repo.findByToken(protocolId);
    if (!dto) throw new Error('esperava DTO do protocolo ACTIVE');
    expect(Object.keys(dto)).not.toContain('userId');
    expect(JSON.stringify(dto)).not.toContain(userId);
    expect(dto.status).toBe('ACTIVE');
    expect(dto.approvalStatus).toBe('AUTO_APPROVED');
    expect(dto.signatureHash).toHaveLength(64);
    expect(dto.professionalId).not.toBeNull();
    expect(dto.content.goal).toBe('GAIN_MUSCLE');
  });

  it('protocolo não-ACTIVE (PENDING_SIGNATURE) → null (vira 404)', async () => {
    const userId = await createUser();
    const { protocolId } = await repo.persist(persistInput(userId, false));

    expect(await repo.findByToken(protocolId)).toBeNull();
  });

  it('UUID inexistente → null (não vaza existência)', async () => {
    expect(await repo.findByToken('99999999-9999-4999-8999-999999999999')).toBeNull();
  });
});
