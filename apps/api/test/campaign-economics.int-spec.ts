/** Agregacao real por utm_campaign: k-anonimato e formulas com tolerancia zero. */
import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { loadEnv } from '../src/core/config/load-env';
import { ControlCenterService } from '../src/modules/admin/control-center.service';

const { env } = loadEnv();
const RUN = Date.now().toString().slice(-8);
const CAMPAIGN = `camp_${RUN}`;
const SMALL_CAMPAIGN = `small_${RUN}`;
const migrator = postgres({
  host: env.MIGRATION_DATABASE_HOST ?? 'localhost',
  port: Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT ?? 15432),
  user: env.MIGRATION_DATABASE_USER ?? 'movivo_migrator',
  password: env.MIGRATION_DATABASE_PASSWORD,
  database: env.DATABASE_NAME ?? 'movivo',
  ssl: false,
  max: 1,
  prepare: false,
  idle_timeout: 5,
  onnotice: () => undefined,
});
const userIds: string[] = [];
let actorId = '';
let app: INestApplication;

beforeAll(async () => {
  for (let index = 0; index < 19; index += 1) {
    const [user] = await migrator<{ id: string }[]>`
      INSERT INTO users (phone_number, name)
      VALUES (${`+5560${RUN}${index.toString().padStart(2, '0')}`}, ${`Campanha ${RUN} ${index}`})
      RETURNING id
    `;
    if (!user) throw new Error('Falha ao criar titular da campanha de teste.');
    userIds.push(user.id);
    const campaign = index < 10 ? CAMPAIGN : SMALL_CAMPAIGN;
    await migrator`
      INSERT INTO anamnesis_sessions (
        user_id, token, status, expires_at, utm_source, utm_medium,
        utm_campaign, first_touch_at, created_at, updated_at
      ) VALUES (
        ${user.id}::uuid, ${randomUUID().replaceAll('-', '')}, 'SUBMITTED',
        '2026-12-31T00:00:00Z', 'instagram', 'cpc', ${campaign},
        '2026-07-01T12:00:00Z', '2026-07-01T12:00:00Z', '2026-07-01T12:00:00Z'
      )
    `;
  }
  actorId = userIds[0];
  for (const [index, userId] of userIds.slice(0, 2).entries()) {
    await migrator`
      INSERT INTO user_status_transitions (user_id, to_status, occurred_at, actor)
      VALUES (${userId}::uuid, 'CONVERTED', '2026-07-02T12:00:00Z', 'SYSTEM')
    `;
    await migrator`
      INSERT INTO payments (
        user_id, gateway, gateway_event_id, status, amount_cents,
        net_amount_cents, occurred_at, raw_payload
      ) VALUES (
        ${userId}::uuid, 'MOCK', ${`campaign-${RUN}-${index}`}, 'SETTLED',
        200000, 200000, '2026-07-03T12:00:00Z', '{}'::jsonb
      )
    `;
  }
  await migrator`
    INSERT INTO ad_spend (channel, campaign, spent_on, amount_cents, created_by)
    VALUES ('meta_ads', ${CAMPAIGN}, '2026-07-01', 200000, ${actorId}::uuid)
  `;
  app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
}, 30_000);

afterAll(async () => {
  await app?.close();
  await migrator`ALTER TABLE ad_spend DISABLE TRIGGER trg_ad_spend_immutable`;
  await migrator`DELETE FROM ad_spend WHERE campaign IN (${CAMPAIGN}, ${SMALL_CAMPAIGN})`;
  await migrator`ALTER TABLE ad_spend ENABLE TRIGGER trg_ad_spend_immutable`;
  await migrator`ALTER TABLE payments DISABLE TRIGGER trg_payments_immutable`;
  await migrator`DELETE FROM payments WHERE gateway_event_id LIKE ${`campaign-${RUN}-%`}`;
  await migrator`ALTER TABLE payments ENABLE TRIGGER trg_payments_immutable`;
  await migrator`ALTER TABLE user_status_transitions DISABLE TRIGGER trg_user_status_transitions_immutable`;
  await migrator`DELETE FROM user_status_transitions WHERE user_id = ANY(${userIds}::uuid[])`;
  await migrator`ALTER TABLE user_status_transitions ENABLE TRIGGER trg_user_status_transitions_immutable`;
  await migrator`DELETE FROM anamnesis_sessions WHERE user_id = ANY(${userIds}::uuid[])`;
  await migrator`DELETE FROM users WHERE id = ANY(${userIds}::uuid[])`;
  await migrator.end({ timeout: 5 });
});

describe('economia de campanhas', () => {
  it('publica n=10, suprime n=9 e confere CAC/receita/ROAS exatamente', async () => {
    const response = await app.get(ControlCenterService).campaigns();
    const published = response.data.campaigns.find((item) => item.campaign === CAMPAIGN);
    expect(response.data.campaigns.some((item) => item.campaign === SMALL_CAMPAIGN)).toBe(false);
    expect(published).toMatchObject({
      students: 10,
      converted: 2,
      investmentBrl: 2000,
      cac: { value: 1000 },
      receivedRevenue: { value: 4000 },
      roas: { value: 2 },
      ltv: { value: 2000 },
      ltvToCac: { value: 2 },
    });
  });
});
