import { migrationPostgresTls } from '../src/core/database/postgres-tls';
/**
 * Integração — AUTH (US-1.4 / valida TASK-1.4.1..1.4.3 — Sato §9.1).
 *
 * Sobe o `AppModule` REAL contra o stack Docker (Postgres via PgBouncer 5433, Redis via
 * Sentinel) e prova, por I/O de verdade, o que a US-1.8 exige da auth:
 *   · o app **boota** com as chaves RS256 (o login assina/valida um token real);
 *   · login (Argon2id) emite access + refresh (cookie httpOnly);
 *   · refresh rotaciona; repetição concorrente não derruba o descendente e replay posterior invalida a FAMÍLIA;
 *   · logout coloca o jti na denylist Redis (o access deixa de valer);
 *   · RBAC barra papel de staff sem privilégio num endpoint `@Roles(PROFESSIONAL, ADMIN)`;
 *   · `alg:none` e `HS256` são recusados;
 *   · rate limit de `/auth/login` (10/min por IP).
 *
 * Pré-requisito: `pnpm run infra:up` + `db:migrate` + `gen-local-secrets.sh` (chaves RS256).
 */
import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { type INestApplication } from '@nestjs/common';
import { ModulesContainer, NestFactory } from '@nestjs/core';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard';
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
import { AuthService } from '../src/modules/auth/auth.service';
import { REDIS_CLIENT } from '../src/core/redis/redis.constants';
import { REDIS_KEY_BUILDER, RedisKeyBuilder } from '../src/core/redis/redis-key.util';
import type { Redis } from 'ioredis';
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
  ssl: migrationPostgresTls(env, env.MIGRATION_DATABASE_HOST ?? 'localhost'),
  port: Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT ?? 5432),
  user: 'postgres',
  password: readFileSync(
    resolve(apiRoot, '..', '..', 'secrets', 'desenvolvimento', 'postgres_superuser_password'),
    'utf8',
  ).trimEnd(),
  database: env.DATABASE_NAME ?? 'movivo',

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
      sql`INSERT INTO staff (phone_number, email, name, role, password_hash)
          VALUES (${`+55558${RUN}1`}, ${proEmail}, 'Pro Teste', 'PROFESSIONAL', ${hash})
          RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    return rows[0].id;
  });
  userId = await tenant.runAsSystem(async (tx) => {
    const rows = (await tx.execute(
      sql`INSERT INTO staff (phone_number, email, name, role, password_hash)
          VALUES (${`+55558${RUN}2`}, ${userEmail}, 'Staff Sem Privilegio Teste', 'SUPPORT', ${hash})
          RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    return rows[0].id;
  });
}, 60_000);

afterAll(async () => {
  try {
    await adminClient.unsafe(`DELETE FROM staff WHERE id IN ('${proId}','${userId}')`);
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
  it('PROFESSIONAL passa em /auth/admin/ping; SUPPORT é barrado (403)', async () => {
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
    expect(me.body).toMatchObject({ userId, role: 'SUPPORT' });
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
  it('rotação concorrente preserva o descendente; replay posterior mata a família', async () => {
    const loginRes = await login();
    const cookie1 = refreshCookie(loginRes);

    // 1ª rotação: cookie1 → cookie2 (200).
    const r1 = await base().post(`/${prefix}/auth/refresh`).set('Cookie', cookie1);
    expect(r1.status).toBe(200);
    expect(r1.body.accessToken).toBeTruthy();
    const cookie2 = refreshCookie(r1);
    expect(cookie2).not.toBe(cookie1);

    // A mesma aba pode ter enviado cookie1 em outra requisição antes de receber cookie2.
    const concurrent = await base().post(`/${prefix}/auth/refresh`).set('Cookie', cookie1);
    expect(concurrent.status).toBe(409);
    expect(
      (await base().get(`/${prefix}/auth/me`).set('Authorization', `Bearer ${r1.body.accessToken}`))
        .status,
    ).toBe(200);

    // Simula a passagem da janela de concorrência sem esperar 30 segundos no teste.
    const firstId = cookie1.replace(/^movivo_refresh=/, '').split('.')[0];
    await app
      .get(TenantDatabase)
      .runAsSystem((tx) =>
        tx.execute(
          sql`UPDATE auth_sessions SET revoked_at=now()-interval '31 seconds' WHERE id=${firstId}`,
        ),
      );
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

describe('autenticação autoritativa no servidor', () => {
  // Emissão real sem consumir o rate limit HTTP reservado ao teste de brute force.
  const issue = () => app.get(AuthService).login({ email: proEmail, password: PASSWORD });
  const me = (access: string) =>
    base().get(`/${prefix}/auth/me`).set('Authorization', `Bearer ${access}`);
  const cookie = (value: string) => `movivo_refresh=${value}`;
  it('todas as operações administrativas recusam HTTP direto sem autenticação', async () => {
    const modules = app.get(ModulesContainer);
    const methods = { 0: 'get', 1: 'post', 2: 'put', 3: 'delete', 4: 'patch' } as const;
    let checked = 0;
    for (const module of modules.values()) {
      if (module.metatype.name !== 'AdminModule') continue;
      for (const wrapper of module.controllers.values()) {
        const controller = wrapper.metatype;
        if (!controller) throw new Error('Controller administrativo sem tipo.');
        const guards = Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[];
        expect(guards).toContain(JwtAuthGuard);
        const controllerPath = Reflect.getMetadata(PATH_METADATA, controller) as string;
        for (const name of Object.getOwnPropertyNames(controller.prototype)) {
          const handler = controller.prototype[name];
          if (typeof handler !== 'function') continue;
          const verb = Reflect.getMetadata(METHOD_METADATA, handler) as
            keyof typeof methods | undefined;
          if (verb === undefined) continue;
          const method = methods[verb];
          if (!method) throw new Error('Método HTTP administrativo não coberto.');
          const routePath = Reflect.getMetadata(PATH_METADATA, handler) as string;
          const path = `/${prefix}/${controllerPath}/${routePath}`
            .replace(/\/+/g, '/')
            .replace(/:[A-Za-z]+/g, '11111111-1111-4111-8111-111111111111');
          const response = await base()[method](path);
          expect(response.status, `${method} ${path}`).toBe(401);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
  });
  it('logout só com refresh revoga access e refresh, sem exigir access válido', async () => {
    const session = await issue();
    expect(
      (
        await base()
          .post(`/${prefix}/auth/logout/refresh`)
          .set('Cookie', cookie(session.refreshCookie))
      ).status,
    ).toBe(204);
    expect((await me(session.accessToken)).status).toBe(401);
    expect(
      (await base().post(`/${prefix}/auth/refresh`).set('Cookie', cookie(session.refreshCookie)))
        .status,
    ).toBe(401);
  });
  it('nega segredo de logout adulterado sem revogar sessão legítima', async () => {
    const session = await issue();
    const id = session.refreshCookie.split('.')[0];
    expect(
      (
        await base()
          .post(`/${prefix}/auth/logout/refresh`)
          .set('Cookie', cookie(id + '.' + '0'.repeat(64)))
      ).status,
    ).toBe(401);
    expect((await me(session.accessToken)).status).toBe(200);
  });
  it('rotação mantém prazo absoluto e invalida access anterior', async () => {
    const session = await issue();
    const firstId = session.refreshCookie.split('.')[0];
    const refresh = await app.get(AuthService).refresh(session.refreshCookie);
    const secondId = refresh.refreshCookie.split('.')[0];
    const rows = await app
      .get(TenantDatabase)
      .runAsSystem((tx) =>
        tx.execute(
          sql`SELECT expires_at FROM auth_sessions WHERE id IN (${firstId},${secondId}) ORDER BY created_at`,
        ),
      );
    expect(rows).toHaveLength(2);
    expect(rows[0].expires_at).toEqual(rows[1].expires_at);
    expect((await me(session.accessToken)).status).toBe(401);
    expect((await me(refresh.accessToken)).status).toBe(200);
  });
  it('migração recupera o primeiro prazo das famílias antigas sem estender outras', async () => {
    const first = await issue(),
      second = await app.get(AuthService).refresh(first.refreshCookie);
    const firstId = first.refreshCookie.split('.')[0],
      secondId = second.refreshCookie.split('.')[0];
    await app.get(TenantDatabase).runAsUser(proId, 'PROFESSIONAL', async (tx) => {
      await tx.execute(
        sql`UPDATE auth_sessions SET expires_at=now()-interval '1 day' WHERE id=${firstId}`,
      );
      await tx.execute(
        sql`UPDATE auth_sessions SET expires_at=now()+interval '30 days' WHERE id=${secondId}`,
      );
      const migration = readFileSync(
        resolve(apiRoot, 'drizzle', '0067_prazo_absoluto_auth_sessions.sql'),
        'utf8',
      );
      await tx.execute(sql.raw(migration));
      const rows = await tx.execute(
        sql`SELECT expires_at FROM auth_sessions WHERE id IN (${firstId},${secondId})`,
      );
      expect(rows).toHaveLength(2);
      expect(rows[0].expires_at).toEqual(rows[1].expires_at);
    });
    await expect(app.get(AuthService).refresh(second.refreshCookie)).rejects.toThrow(/expirado/);
    expect((await me(second.accessToken)).status).toBe(401);
  });
  it('duas rotações concorrentes preservam um único descendente válido', async () => {
    const session = await issue();
    const results = await Promise.allSettled([
      app.get(AuthService).refresh(session.refreshCookie),
      app.get(AuthService).refresh(session.refreshCookie),
    ]);
    const successful = results.filter((result) => result.status === 'fulfilled');
    expect(successful).toHaveLength(1);
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    const rotated = successful[0];
    if (rotated.status !== 'fulfilled') throw new Error('Rotação ausente');
    expect((await me(rotated.value.accessToken)).status).toBe(200);
    await expect(app.get(AuthService).refresh(rotated.value.refreshCookie)).resolves.toHaveProperty(
      'accessToken',
    );
  });
  it('logout de ancestral concorre com refresh sem deixar descendentes vivos', async () => {
    const first = await issue();
    const second = await app.get(AuthService).refresh(first.refreshCookie);
    const results = await Promise.allSettled([
      app.get(AuthService).refresh(second.refreshCookie),
      app.get(AuthService).logoutRefresh(first.refreshCookie),
    ]);
    expect(results[1].status).toBe('fulfilled');
    expect((await me(second.accessToken)).status).toBe(401);
    const rotated = results[0];
    if (rotated.status === 'fulfilled') {
      expect((await me(rotated.value.accessToken)).status).toBe(401);
      await expect(app.get(AuthService).refresh(rotated.value.refreshCookie)).rejects.toThrow();
    }
  });
  it('Redis vazio não ressuscita logout persistido no PostgreSQL', async () => {
    const session = await issue();
    await app.get(AuthService).logoutRefresh(session.refreshCookie);
    const claims = jwt.decode(session.accessToken) as jwt.JwtPayload;
    if (!claims.jti) throw new Error('JWT sem jti');
    const key = app.get<RedisKeyBuilder>(REDIS_KEY_BUILDER).global('jwt-denylist', claims.jti);
    await app.get<Redis>(REDIS_CLIENT).del(key);
    expect((await me(session.accessToken)).status).toBe(401);
  });
  it('sessão vencida no banco e claims sem exp/iat ou TTL excessivo são recusados', async () => {
    const session = await issue();
    const claims = jwt.decode(session.accessToken) as jwt.JwtPayload;
    const now = Math.floor(Date.now() / 1000);
    for (const payload of [
      { sub: proId, role: 'PROFESSIONAL', jti: claims.jti },
      { sub: proId, role: 'PROFESSIONAL', jti: claims.jti, iat: now, exp: now + 901 },
      { sub: proId, role: 'PROFESSIONAL', jti: claims.jti, iat: now - 1000, exp: now - 1 },
    ]) {
      const token = jwt.sign(payload, config.jwt.privateKey, {
        algorithm: 'RS256',
        keyid: config.jwt.keyId,
      });
      expect((await me(token)).status).toBe(401);
    }
    await app
      .get(TenantDatabase)
      .runAsSystem((tx) =>
        tx.execute(
          sql`UPDATE auth_sessions SET expires_at = now() - interval '1 second' WHERE jti=${claims.jti}`,
        ),
      );
    expect((await me(session.accessToken)).status).toBe(401);
  });
  it('papel removido no banco revoga acesso na próxima operação', async () => {
    const session = await issue();
    try {
      await app
        .get(TenantDatabase)
        .runAsSystem((tx) => tx.execute(sql`UPDATE staff SET role='SUPPORT' WHERE id=${proId}`));
      expect((await me(session.accessToken)).status).toBe(401);
    } finally {
      await app
        .get(TenantDatabase)
        .runAsSystem((tx) =>
          tx.execute(sql`UPDATE staff SET role='PROFESSIONAL' WHERE id=${proId}`),
        );
    }
  });
  it('troca de senha revoga todas as sessões e exige novo login', async () => {
    const first = await issue(),
      second = await issue();
    const changed = 'Senha-Nova-Teste-123!';
    try {
      const out = await base()
        .post(`/${prefix}/account/password`)
        .set('Authorization', `Bearer ${first.accessToken}`)
        .send({ currentPassword: PASSWORD, newPassword: changed });
      expect(out.status).toBe(204);
      for (const session of [first, second]) {
        expect((await me(session.accessToken)).status).toBe(401);
        await expect(app.get(AuthService).refresh(session.refreshCookie)).rejects.toThrow();
      }
      await expect(issue()).rejects.toThrow();
      const renewed = await app.get(AuthService).login({ email: proEmail, password: changed });
      expect((await me(renewed.accessToken)).status).toBe(200);
    } finally {
      const hash = await app.get(PasswordService).hash(PASSWORD);
      await app
        .get(TenantDatabase)
        .runAsSystem((tx) =>
          tx.execute(sql`UPDATE staff SET password_hash=${hash} WHERE id=${proId}`),
        );
    }
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
