import { migrationPostgresTls } from '../src/core/database/postgres-tls';
/**
 * Trilha de acesso (`audit_logs`) ponta a ponta contra o Postgres real: login, falhas
 * (deduplicadas), logout e troca de senha viram linhas imutáveis com o ator certo.
 */
import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { AppConfigService } from '../src/core/config';
import { loadEnv } from '../src/core/config/load-env';
import { TenantDatabase } from '../src/core/database';
import { PasswordService } from '../src/modules/auth/password.service';

const { env } = loadEnv();
const apiRoot = process.cwd();
const RUN = Date.now().toString().slice(-8);
const PASSWORD = 'Senha-Forte-Teste-123!';
const email = `audit_${RUN}@movivo.test`;
const phone = `+55559${RUN}1`;

let app: INestApplication;
let prefix: string;
let staffId = '';

const adminClient = postgres({
  host: env.MIGRATION_DATABASE_HOST ?? 'localhost',
  ssl: migrationPostgresTls(env, env.MIGRATION_DATABASE_HOST ?? 'localhost'),
  port: Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT ?? 5432),
  user: 'postgres',
  password: readFileSync(
    resolve(apiRoot, '..', '..', 'secrets', 'postgres_superuser_password'),
    'utf8',
  ).trimEnd(),
  database: env.DATABASE_NAME ?? 'movivo',

  max: 1,
  idle_timeout: 5,
  onnotice: () => undefined,
});

const http = () => request(app.getHttpServer());
const login = (e: string, password = PASSWORD) =>
  http()
    .post(`/${prefix}/auth/login`)
    .set('User-Agent', 'int-spec/1.0')
    .send({ email: e, password });

async function trail(action?: string) {
  const rows = await adminClient<
    { action: string; actor_id: string; user_id: string; changes: Record<string, unknown> }[]
  >`
    SELECT action, actor_id, user_id, changes FROM audit_logs
     WHERE actor_id = ${staffId} AND action LIKE 'AUTH_%' ORDER BY id`;
  return action ? rows.filter((r) => r.action === action) : rows;
}

beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  app.use(cookieParser());
  prefix = app.get(AppConfigService).globalPrefix;
  app.setGlobalPrefix(prefix);
  await app.init();
  const hash = await app.get(PasswordService).hash(PASSWORD);
  staffId = await app.get(TenantDatabase).runAsSystem(async (tx) => {
    const rows = (await tx.execute(
      sql`INSERT INTO staff (phone_number, email, name, role, password_hash)
          VALUES (${phone}, ${email}, 'Conta Auditada', 'ADMIN', ${hash}) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    return rows[0].id;
  });
}, 60_000);

afterAll(async () => {
  try {
    await adminClient`DELETE FROM staff WHERE id = ${staffId}`;
  } finally {
    await adminClient.end({ timeout: 5 });
    await app?.close();
  }
});

describe('trilha de acesso das contas internas', () => {
  it('e-mail desconhecido não grava nada (sem ator para a trilha)', async () => {
    const res = await login(`ninguem_${RUN}@movivo.test`, 'qualquer');
    expect(res.status).toBe(401);
    expect(await trail()).toHaveLength(0);
  });

  it('martelar senha errada grava UMA falha por janela, com IP e user-agent', async () => {
    for (let i = 0; i < 5; i += 1) expect((await login(email, 'errada')).status).toBe(401);
    const failed = await trail('AUTH_LOGIN_FAILED');
    expect(failed).toHaveLength(1);
    expect(failed[0].user_id).toBe(staffId); // sentinela: sem titular, userId = actorId
    expect(failed[0].changes).toMatchObject({
      reason: 'invalid_credentials',
      attemptsSinceLast: 1,
      userAgent: 'int-spec/1.0',
    });
    expect(String(failed[0].changes.ip)).not.toBe('');
  });

  it('login válido grava AUTH_LOGIN com papel, IP e user-agent', async () => {
    const res = await login(email);
    expect(res.status).toBe(200);
    const rows = await trail('AUTH_LOGIN');
    expect(rows).toHaveLength(1);
    expect(rows[0].changes).toMatchObject({ role: 'ADMIN', userAgent: 'int-spec/1.0' });
    expect(res.body.accessToken).toBeTruthy();
  });

  it('troca de senha grava AUTH_PASSWORD_CHANGED e logout grava AUTH_LOGOUT', async () => {
    const access = (await login(email)).body.accessToken as string;
    const change = await http()
      .post(`/${prefix}/account/password`)
      .set('Authorization', `Bearer ${access}`)
      .send({ currentPassword: PASSWORD, newPassword: 'Outra-Senha-Forte-456!' });
    expect(change.status).toBe(204);
    expect(await trail('AUTH_PASSWORD_CHANGED')).toHaveLength(1);

    // A troca revoga todas as sessões: loga de novo com a senha nova para testar o logout.
    const again = await login(email, 'Outra-Senha-Forte-456!');
    expect(again.status).toBe(200);
    const out = await http()
      .post(`/${prefix}/auth/logout`)
      .set('Authorization', `Bearer ${again.body.accessToken as string}`);
    expect(out.status).toBe(204);
    expect(await trail('AUTH_LOGOUT')).toHaveLength(1);
  });

  it('a trilha é imutável: nem o superusuário atualiza uma linha', async () => {
    await expect(
      adminClient`UPDATE audit_logs SET action = 'X' WHERE actor_id = ${staffId}`,
    ).rejects.toThrow(/append-only/);
  });
});
