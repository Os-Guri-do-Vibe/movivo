/**
 * Integração — AUTH (US-1.4 / valida TASK-1.4.1..1.4.3 — Sato §9.1).
 *
 * Sobe o `AppModule` REAL contra o stack Docker (Postgres via PgBouncer 5433, Redis via
 * Sentinel) e prova, por I/O de verdade, o que a US-1.8 exige da auth:
 *   · o app **boota** com as chaves RS256 (o login assina/valida um token real);
 *   · login (Argon2id) emite access + refresh (cookie httpOnly);
 *   · refresh rotaciona e invalida o anterior; reuse do anterior invalida a FAMÍLIA;
 *   · logout coloca o jti na denylist Redis (o access deixa de valer);
 *   · RBAC barra `USER` num endpoint `@Roles(PROFESSIONAL, ADMIN)`;
 *   · `alg:none` e `HS256` são recusados;
 *   · rate limit de `/auth/login` (10/min por IP).
 *
 * Pré-requisito: `pnpm run infra:up` + `db:migrate` + `gen-local-secrets.sh` (chaves RS256).
 */
import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { sql } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
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

let app: INestApplication;
let prefix: string;
let config: AppConfigService;
let proId = '';
let userId = '';

const PASSWORD = 'Senha-Forte-Teste-123!';
const proEmail = `pro_${RUN}@movivo.test`;
const userEmail = `user_${RUN}@movivo.test`;

// Cliente admin (superusuário, BYPASSRLS) só para teardown.
const adminClient = postgres({
  host: env.MIGRATION_DATABASE_HOST ?? 'localhost',
  port: Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT ?? 5432),
  user: 'postgres',
  password: readFileSync(
    resolve(apiRoot, '..', '..', 'secrets', 'postgres_superuser_password'),
    'utf8',
  ).trimEnd(),
  database: env.DATABASE_NAME ?? 'movivo',
  ssl: false,
  max: 1,
  idle_timeout: 5,
  onnotice: () => {
    /* notices do Postgres podem conter valores — nunca vão para o log do teste. */
  },
});

function base() {
  return request(app.getHttpServer());
}

/** Extrai o valor do cookie de refresh de um header set-cookie. */
function refreshCookie(res: request.Response): string {
  const setCookie = res.headers['set-cookie'] as unknown as string[];
  const raw = setCookie.find((c) => c.startsWith('movivo_refresh='));
  if (!raw) throw new Error('cookie de refresh ausente na resposta');
  return raw.split(';')[0];
}

async function login(email = proEmail, password = PASSWORD) {
  return base().post(`/${prefix}/auth/login`).send({ email, password });
}

beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  app.use(cookieParser());
  config = app.get(AppConfigService);
  prefix = config.globalPrefix;
  app.setGlobalPrefix(prefix);
  await app.init();

  const passwords = app.get(PasswordService);
  const tenant = app.get(TenantDatabase);
  const hash = await passwords.hash(PASSWORD);

  proId = await tenant.runAsSystem(async (tx) => {
    const rows = (await tx.execute(
      sql`INSERT INTO users (phone_number, email, name, role, password_hash)
          VALUES (${`+55558${RUN}1`}, ${proEmail}, 'Pro Teste', 'PROFESSIONAL', ${hash})
          RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    return rows[0].id;
  });
  userId = await tenant.runAsSystem(async (tx) => {
    const rows = (await tx.execute(
      sql`INSERT INTO users (phone_number, email, name, role, password_hash)
          VALUES (${`+55558${RUN}2`}, ${userEmail}, 'User Teste', 'USER', ${hash})
          RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    return rows[0].id;
  });
}, 60_000);

afterAll(async () => {
  try {
    await adminClient.unsafe(`DELETE FROM users WHERE id IN ('${proId}','${userId}')`);
  } finally {
    await adminClient.end({ timeout: 5 });
    await app?.close();
  }
});

describe('login (Argon2id) — o app boota com as chaves RS256', () => {
  it('emite access RS256 + refresh httpOnly para credencial válida', async () => {
    const res = await login();
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user).toMatchObject({ id: proId, role: 'PROFESSIONAL' });

    // O access é um JWT RS256 com kid.
    const decoded = jwt.decode(res.body.accessToken, { complete: true });
    expect(decoded?.header.alg).toBe('RS256');
    expect(decoded?.header.kid).toBe(config.jwt.keyId);

    // Cookie de refresh: httpOnly + SameSite=Strict.
    const setCookie = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(setCookie).toMatch(/movivo_refresh=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
  });

  it('recusa senha errada com 401 (sem vazar se o e-mail existe)', async () => {
    const res = await login(proEmail, 'senha-errada');
    expect(res.status).toBe(401);
    const res2 = await login('inexistente@movivo.test', 'x');
    expect(res2.status).toBe(401);
  });
});

describe('RBAC — @Roles(PROFESSIONAL, ADMIN)', () => {
  it('PROFESSIONAL passa em /auth/admin/ping; USER é barrado (403)', async () => {
    const proAccess = (await login()).body.accessToken as string;
    const userAccess = (await login(userEmail)).body.accessToken as string;

    const pro = await base()
      .get(`/${prefix}/auth/admin/ping`)
      .set('Authorization', `Bearer ${proAccess}`);
    expect(pro.status).toBe(200);
    expect(pro.body).toMatchObject({ ok: true, role: 'PROFESSIONAL' });

    const user = await base()
      .get(`/${prefix}/auth/admin/ping`)
      .set('Authorization', `Bearer ${userAccess}`);
    expect(user.status).toBe(403);

    // /auth/me é autenticado (qualquer papel).
    const me = await base().get(`/${prefix}/auth/me`).set('Authorization', `Bearer ${userAccess}`);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ userId, role: 'USER' });
  });
});

describe('alg:none e HS256 são recusados (Sato §9.1)', () => {
  it('recusa um token alg:none', async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const header = b64({ alg: 'none', typ: 'JWT', kid: config.jwt.keyId });
    const payload = b64({ sub: proId, role: 'PROFESSIONAL', jti: 'x', iat: now, exp: now + 900 });
    const token = `${header}.${payload}.`;
    const res = await base().get(`/${prefix}/auth/me`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('recusa um token HS256 forjado com a chave pública', async () => {
    const forged = jwt.sign({ sub: proId, role: 'ADMIN', jti: 'x' }, config.jwt.publicKey, {
      algorithm: 'HS256',
      keyid: config.jwt.keyId,
    });
    const res = await base().get(`/${prefix}/auth/me`).set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });
});

describe('refresh rotation + detecção de reuse', () => {
  it('rotaciona e invalida o anterior; reuse do anterior mata a família', async () => {
    const loginRes = await login();
    const cookie1 = refreshCookie(loginRes);

    // 1ª rotação: cookie1 → cookie2 (200).
    const r1 = await base().post(`/${prefix}/auth/refresh`).set('Cookie', cookie1);
    expect(r1.status).toBe(200);
    expect(r1.body.accessToken).toBeTruthy();
    const cookie2 = refreshCookie(r1);
    expect(cookie2).not.toBe(cookie1);

    // Reuse do cookie1 (já rotacionado) → 401 e invalida a família inteira.
    const reuse = await base().post(`/${prefix}/auth/refresh`).set('Cookie', cookie1);
    expect(reuse.status).toBe(401);

    // Como a família foi invalidada, o cookie2 (descendente) também deixa de valer.
    const afterReuse = await base().post(`/${prefix}/auth/refresh`).set('Cookie', cookie2);
    expect(afterReuse.status).toBe(401);
  });

  it('recusa refresh sem cookie', async () => {
    const res = await base().post(`/${prefix}/auth/refresh`);
    expect(res.status).toBe(401);
  });
});

describe('logout — denylist Redis', () => {
  it('após logout, o access token é recusado (jti na denylist)', async () => {
    const loginRes = await login();
    const access = loginRes.body.accessToken as string;
    const cookie = refreshCookie(loginRes);

    // O access vale antes do logout.
    const before = await base().get(`/${prefix}/auth/me`).set('Authorization', `Bearer ${access}`);
    expect(before.status).toBe(200);

    const out = await base()
      .post(`/${prefix}/auth/logout`)
      .set('Authorization', `Bearer ${access}`)
      .set('Cookie', cookie);
    expect(out.status).toBe(204);

    // Depois do logout, o mesmo access é recusado pela denylist.
    const after = await base().get(`/${prefix}/auth/me`).set('Authorization', `Bearer ${access}`);
    expect(after.status).toBe(401);
  });
});

describe('rate limit de /auth/login (10/min por IP)', () => {
  it('retorna 429 ao estourar o limite', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 15; i++) {
      const res = await login(proEmail, 'senha-errada');
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
  });
});
