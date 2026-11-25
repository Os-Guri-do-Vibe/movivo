import { migrationPostgresTls } from '../src/core/database/postgres-tls';
/**
 * Campanha da anamnese complementar contra o Postgres real: convida só quem está ativo, ainda
 * não aceitou o texto vigente, não revogou o consentimento e não tem convite válido.
 */
import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CONSENT_TEXTS } from '@movivo/shared';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module';
import { loadEnv } from '../src/core/config/load-env';
import { ComplementaryCampaignService } from '../src/modules/anamnesis/complementary-campaign.service';
import { QueueManager } from '../src/modules/jobs/queue-manager.service';
import { WHATSAPP_TRANSPORT } from '../src/modules/whatsapp/whatsapp-transport';

const { env } = loadEnv();
const RUN = Date.now().toString().slice(-7);
const apiRoot = process.cwd();

const admin = postgres({
  host: env.MIGRATION_DATABASE_HOST ?? 'localhost',
  ssl: migrationPostgresTls(env, env.MIGRATION_DATABASE_HOST ?? 'localhost'),
  port: Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT ?? 15432),
  user: 'postgres',
  password: readFileSync(
    resolve(apiRoot, '..', '..', 'secrets', 'desenvolvimento', 'postgres_superuser_password'),
    'utf8',
  ).trimEnd(),
  database: env.DATABASE_NAME ?? 'movivo',
  max: 1,
  idle_timeout: 5,
  onnotice: () => undefined,
});

let app: INestApplication;
let campaign: ComplementaryCampaignService;
const enqueued: Array<{ queue: string; data: Record<string, unknown> }> = [];
const ids: Record<string, string> = {};

async function student(
  key: string,
  options: { subscription?: string; consent?: 'CURRENT' | 'OLD' | 'REVOKED' | 'NONE' },
) {
  const [user] = await admin<Array<{ id: string }>>`
    INSERT INTO users (phone_number, name, email, status)
    VALUES (${`+5541${RUN}${Object.keys(ids).length}`}, ${`Aluno ${key}`}, ${`camp-${RUN}-${key}@example.invalid`}, 'ACTIVE')
    RETURNING id`;
  ids[key] = user.id;
  if (options.subscription) {
    await admin`
      INSERT INTO subscriptions (user_id, plan, status, price_cents, monthly_price_cents, total_price_cents, commitment_months)
      VALUES (${user.id}::uuid, 'MONTHLY', ${options.subscription}, 3900, 3900, 3900, 1)`;
  }
  const version =
    options.consent === 'CURRENT'
      ? CONSENT_TEXTS.HEALTH_DATA.version
      : options.consent === 'OLD' || options.consent === 'REVOKED'
        ? 'consent-health-2026-08-v3'
        : null;
  if (version) {
    await admin`
      INSERT INTO consents (user_id, consent_type, version, accepted, revoked_at)
      VALUES (${user.id}::uuid, 'HEALTH_DATA', ${version}, true,
        ${options.consent === 'REVOKED' ? new Date() : null})`;
  }
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(WHATSAPP_TRANSPORT)
    .useValue({
      hasCredentials: () => true,
      send: async () => undefined,
      sendTemplate: async () => undefined,
    })
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  campaign = app.get(ComplementaryCampaignService);
  // Sem fila de verdade: o que importa aqui é QUEM é convidado e COM QUE texto.
  vi.spyOn(app.get(QueueManager), 'enqueue').mockImplementation(async (queue, _name, data) => {
    enqueued.push({ queue, data: data as unknown as Record<string, unknown> });
    return 'job';
  });

  await student('elegivel', { subscription: 'ACTIVE', consent: 'OLD' });
  await student('trial', { subscription: 'TRIALING', consent: 'NONE' });
  await student('ja-aceitou', { subscription: 'ACTIVE', consent: 'CURRENT' });
  await student('revogou', { subscription: 'ACTIVE', consent: 'REVOKED' });
  await student('cancelado', { subscription: 'CANCELED', consent: 'OLD' });
  await student('sem-assinatura', { consent: 'OLD' });
}, 60_000);

afterAll(async () => {
  try {
    const list = Object.values(ids);
    await admin`DELETE FROM anamnesis_sessions WHERE user_id = ANY(${list}::uuid[])`;
    await admin`DELETE FROM consents WHERE user_id = ANY(${list}::uuid[])`;
    await admin`DELETE FROM subscriptions WHERE user_id = ANY(${list}::uuid[])`;
    await admin`ALTER TABLE user_status_transitions DISABLE TRIGGER trg_user_status_transitions_immutable`;
    await admin`DELETE FROM user_status_transitions WHERE user_id = ANY(${list}::uuid[])`;
    await admin`ALTER TABLE user_status_transitions ENABLE TRIGGER trg_user_status_transitions_immutable`;
    await admin`DELETE FROM users WHERE id = ANY(${list}::uuid[])`;
  } finally {
    await Promise.all([app?.close(), admin.end({ timeout: 5 })]);
  }
}, 60_000);

describe('campanha da anamnese complementar', () => {
  it('convida só o aluno ativo sem aceite vigente, e não repete enquanto o convite vale', async () => {
    const mine = (queued: typeof enqueued) =>
      queued.filter((job) => Object.values(ids).includes(String(job.data.userId)));

    const first = await campaign.run();
    const sent = mine(enqueued).map((job) => job.data.userId);
    expect(sent.sort()).toEqual([ids.elegivel, ids.trial].sort());
    expect(first.invited).toBeGreaterThanOrEqual(2);
    for (const job of mine(enqueued)) {
      expect(job.data.type).toBe('CONSENT_STATUS');
      expect(String(job.data.text)).toMatch(/\/anamnese\/c\//);
    }

    enqueued.length = 0;
    await campaign.run();
    expect(mine(enqueued)).toHaveLength(0);
  });
});
