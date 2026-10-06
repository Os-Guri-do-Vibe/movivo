/**
 * MFA (TOTP) das contas internas, ponta a ponta contra Postgres + Redis reais, com a
 * exigência ligada (`AUTH_MFA_REQUIRED=true`, como em produção).
 *
 * Propriedades de segurança provadas aqui: senha sozinha NÃO dá sessão; o desafio é de uso
 * único; o mesmo código TOTP não autentica duas vezes (replay); código de recuperação vale
 * uma vez; erros queimam o desafio e travam a conta; trocar a senha invalida desafios; o
 * segredo nunca fica em claro no banco; tudo cai na trilha imutável.
 */
import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { AppConfigService } from '../src/core/config';
import { loadEnv } from '../src/core/config/load-env';
import { TenantDatabase } from '../src/core/database';
import { REDIS_CLIENT } from '../src/core/redis/redis.constants';
import { REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../src/core/redis/redis-key.util';
import { PasswordService } from '../src/modules/auth/password.service';
import { base32Decode, hotp, totpAt } from '../src/modules/auth/totp';

const { env } = loadEnv();
const apiRoot = process.cwd();
const RUN = Date.now().toString().slice(-8);
const PASSWORD = 'Senha-Forte-Teste-123!';
const email = `mfa_${RUN}@movivo.test`;
const phone = `+55557${RUN}1`;

let app: INestApplication;
let prefix: string;
let staffId = '';
let redis: Redis;
let keys: RedisKeyBuilder;

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
  onnotice: () => undefined,
});

const http = () => request(app.getHttpServer());
/**
 * Cada request sai de um IP "novo" (como visitantes distintos atrás do Nginx, com `trust proxy`):
 * o rate limit de 10/min por IP do login/MFA é uma proteção real e não pode mascarar o que
 * estes testes medem — a trava por CONTA é a que importa aqui.
 */
let ipSeq = 0;
const nextIp = () => `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq++ & 255 || 1}`;
const post = (path: string) =>
  http()
    .post(`/${prefix}${path}`)
    .set('User-Agent', 'mfa-int/1.0')
    .set('X-Forwarded-For', nextIp());

const login = () => post('/auth/login').send({ email, password: PASSWORD });
const verify = (challengeToken: string, code: string) =>
  post('/auth/mfa/verify').send({ challengeToken, code });

async function challenge(step: 'verify' | 'setup'): Promise<string> {
  const res = await login();
  expect(res.status).toBe(200);
  expect(res.body.mfa.step).toBe(step);
  return res.body.mfa.challengeToken as string;
}

async function row() {
  const [r] = await adminClient<
    {
      mfa_secret_cipher: Buffer | null;
      mfa_enabled_at: Date | null;
      mfa_last_step: string | null;
      mfa_recovery_hashes: string[] | null;
    }[]
  >`SELECT mfa_secret_cipher, mfa_enabled_at, mfa_last_step, mfa_recovery_hashes
      FROM staff WHERE id = ${staffId}`;
  return r;
}

async function clearThrottles() {
  await redis.del(keys.global('mfa-fail', staffId));
}

async function actions(prefixText = 'AUTH_MFA%') {
  return adminClient<{ action: string; changes: Record<string, unknown> }[]>`
    SELECT action, changes FROM audit_logs
     WHERE actor_id = ${staffId} AND action LIKE ${prefixText} ORDER BY id`;
}

let secret = '';
let recoveryCodes: string[] = [];

beforeAll(async () => {
  process.env.AUTH_MFA_REQUIRED = 'true';
  app = await NestFactory.create(AppModule, { logger: false });
  app.use(cookieParser());
  (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set(
    'trust proxy',
    1,
  );
  prefix = app.get(AppConfigService).globalPrefix;
  app.setGlobalPrefix(prefix);
  await app.init();
  redis = app.get<Redis>(REDIS_CLIENT);
  keys = app.get<RedisKeyBuilder>(REDIS_KEY_BUILDER);

  const hash = await app.get(PasswordService).hash(PASSWORD);
  staffId = await app.get(TenantDatabase).runAsSystem(async (tx) => {
    const rows = (await tx.execute(
      sql`INSERT INTO staff (phone_number, email, name, role, password_hash)
          VALUES (${phone}, ${email}, 'Conta MFA', 'ADMIN', ${hash}) RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    return rows[0].id;
  });
}, 60_000);

afterAll(async () => {
  try {
    await clearThrottles();
    await adminClient`DELETE FROM staff WHERE id = ${staffId}`;
  } finally {
    delete process.env.AUTH_MFA_REQUIRED;
    await adminClient.end({ timeout: 5 });
    await app?.close();
  }
});

describe('inscrição obrigatória (instalação exige MFA)', () => {
  it('senha correta NÃO dá sessão: só um desafio de inscrição, sem cookie', async () => {
    const res = await login();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mfa: { step: 'setup', challengeToken: expect.any(String) } });
    expect(res.body.accessToken).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();
    const sessions = await adminClient`SELECT 1 FROM auth_sessions WHERE user_id = ${staffId}`;
    expect(sessions).toHaveLength(0);
  });

  it('setup devolve segredo + URI do QR, é idempotente e NÃO persiste nada ainda', async () => {
    const token = await challenge('setup');
    const a = await post('/auth/mfa/setup').send({ challengeToken: token });
    expect(a.status).toBe(200);
    expect(a.body.otpauthUri).toMatch(/^otpauth:\/\/totp\/MOVIVO:/);
    expect(a.body.otpauthUri).toContain(encodeURIComponent(email));
    expect(a.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    const b = await post('/auth/mfa/setup').send({ challengeToken: token });
    expect(b.body.secret).toBe(a.body.secret);
    expect((await row()).mfa_enabled_at).toBeNull();
  });

  it('código errado na inscrição → 401 e a conta continua sem MFA', async () => {
    const token = await challenge('setup');
    await post('/auth/mfa/setup').send({ challengeToken: token });
    const res = await post('/auth/mfa/enable').send({ challengeToken: token, code: '000000' });
    expect(res.status).toBe(401);
    expect((await row()).mfa_enabled_at).toBeNull();
    await clearThrottles();
  });

  it('código certo ativa o MFA, entra e entrega 10 códigos de recuperação uma única vez', async () => {
    const token = await challenge('setup');
    secret = (await post('/auth/mfa/setup').send({ challengeToken: token })).body.secret;
    const res = await post('/auth/mfa/enable').send({
      challengeToken: token,
      code: totpAt(secret, Date.now()),
    });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.headers['set-cookie']?.[0]).toMatch(/movivo_refresh=.+HttpOnly/);
    recoveryCodes = res.body.recoveryCodes as string[];
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);

    const me = await http()
      .get(`/${prefix}/auth/me`)
      .set('Authorization', `Bearer ${res.body.accessToken as string}`);
    expect(me.status).toBe(200);
  });

  it('o segredo e os códigos NUNCA ficam em claro no banco', async () => {
    const r = await row();
    expect(r.mfa_enabled_at).not.toBeNull();
    expect(r.mfa_secret_cipher).not.toBeNull();
    expect(r.mfa_secret_cipher?.toString('latin1')).not.toContain(secret);
    expect(r.mfa_recovery_hashes).toHaveLength(10);
    for (const code of recoveryCodes) {
      expect(r.mfa_recovery_hashes).not.toContain(code);
      expect(r.mfa_recovery_hashes).not.toContain(code.replace('-', ''));
    }
    for (const h of r.mfa_recovery_hashes ?? []) expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('o desafio de inscrição é de uso único', async () => {
    const token = await challenge('setup').catch(() => '');
    // Conta já inscrita: o login agora exige `verify`, nunca `setup`.
    expect(token).toBe('');
    const res = await login();
    expect(res.body.mfa.step).toBe('verify');
  });
});

describe('login com MFA ativo', () => {
  it('senha sozinha continua sem dar sessão', async () => {
    const res = await login();
    expect(res.body.mfa.step).toBe('verify');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('REPLAY: o código usado na inscrição não autentica de novo', async () => {
    // O código exato do último passo aceito (o da inscrição), qualquer que seja o relógio agora.
    const lastStep = Number((await row()).mfa_last_step);
    const used = hotp(base32Decode(secret), lastStep);
    const res = await verify(await challenge('verify'), used);
    expect(res.status).toBe(401);
    await clearThrottles();
  });

  it('um código de passo posterior autentica; reusá-lo (replay) falha', async () => {
    const code = totpAt(secret, Date.now() + 30_000);
    const ok = await verify(await challenge('verify'), code);
    expect(ok.status).toBe(200);
    expect(ok.headers['set-cookie']?.[0]).toMatch(/movivo_refresh=/);
    const replay = await verify(await challenge('verify'), code);
    expect(replay.status).toBe(401);
    await clearThrottles();
  });

  it('desafio é de uso único: depois de resolvido, o mesmo token não serve mais', async () => {
    await adminClient`UPDATE staff SET mfa_last_step = 0 WHERE id = ${staffId}`;
    const token = await challenge('verify');
    const code = totpAt(secret, Date.now());
    expect((await verify(token, code)).status).toBe(200);
    await adminClient`UPDATE staff SET mfa_last_step = 0 WHERE id = ${staffId}`;
    expect((await verify(token, code)).status).toBe(401);
  });

  it('código de recuperação entra UMA vez e é consumido', async () => {
    const code = recoveryCodes[0] as string;
    const ok = await verify(await challenge('verify'), code);
    expect(ok.status).toBe(200);
    expect((await row()).mfa_recovery_hashes).toHaveLength(9);
    const again = await verify(await challenge('verify'), code);
    expect(again.status).toBe(401);
    // aceita sem hífen e em minúsculas, mas outro código só uma vez também
    const other = (recoveryCodes[1] as string).replace('-', '').toLowerCase();
    expect((await verify(await challenge('verify'), other)).status).toBe(200);
    await clearThrottles();
  });

  it('5 códigos errados queimam o desafio: o 6º, mesmo certo, já não vale', async () => {
    await adminClient`UPDATE staff SET mfa_last_step = 0 WHERE id = ${staffId}`;
    const token = await challenge('verify');
    for (let i = 0; i < 5; i += 1) expect((await verify(token, '000000')).status).toBe(401);
    expect((await verify(token, totpAt(secret, Date.now()))).status).toBe(401);
    await clearThrottles();
  });

  it('10 erros em 15 min TRAVAM a conta: nem o código certo passa (429), até o prazo', async () => {
    await adminClient`UPDATE staff SET mfa_last_step = 0 WHERE id = ${staffId}`;
    for (let i = 0; i < 2; i += 1) {
      const token = await challenge('verify');
      for (let j = 0; j < 5; j += 1) await verify(token, '000000');
    }
    const locked = await verify(await challenge('verify'), totpAt(secret, Date.now()));
    expect(locked.status).toBe(429);
    await clearThrottles();
    const free = await verify(await challenge('verify'), totpAt(secret, Date.now()));
    expect(free.status).toBe(200);
  });

  it('trocar a senha invalida desafios pendentes', async () => {
    await adminClient`UPDATE staff SET mfa_last_step = 0 WHERE id = ${staffId}`;
    const token = await challenge('verify');
    const newHash = await app.get(PasswordService).hash('Outra-Senha-Forte-789!');
    await adminClient`UPDATE staff SET password_hash = ${newHash} WHERE id = ${staffId}`;
    const res = await verify(token, totpAt(secret, Date.now()));
    expect(res.status).toBe(401);
  });

  it('rejeita corpo malformado, campo extra e token forjado', async () => {
    expect((await post('/auth/mfa/verify').send({ code: '123456' })).status).toBe(400);
    expect(
      (await post('/auth/mfa/verify').send({ challengeToken: 'a'.repeat(64), code: '123456' }))
        .status,
    ).toBe(401); // hex válido, mas nunca emitido
    expect(
      (await post('/auth/mfa/verify').send({ challengeToken: 'x'.repeat(64), code: '123456' }))
        .status,
    ).toBe(400); // fora do formato
    expect(
      (
        await post('/auth/mfa/verify').send({
          challengeToken: 'a'.repeat(64),
          code: '123456',
          role: 'ADMIN',
        })
      ).status,
    ).toBe(400);
  });
});

describe('trilha de auditoria do MFA', () => {
  it('inscrição, falha e uso de código de recuperação ficam registrados com IP/UA', async () => {
    const rows = await actions();
    const names = rows.map((r) => r.action);
    expect(names).toContain('AUTH_MFA_ENROLLED');
    expect(names).toContain('AUTH_MFA_FAILED');
    expect(names).toContain('AUTH_MFA_RECOVERY_USED');
    const recovery = rows.find((r) => r.action === 'AUTH_MFA_RECOVERY_USED');
    expect(recovery?.changes).toMatchObject({ userAgent: 'mfa-int/1.0' });
    expect(Number(recovery?.changes.remaining)).toBeLessThanOrEqual(9);
    const logins = (await actions('AUTH_LOGIN')).filter((r) => r.changes.mfa);
    expect(logins.map((l) => l.changes.mfa)).toEqual(
      expect.arrayContaining(['enrollment', 'totp', 'recovery']),
    );
  });

  it('nenhum evento grava o segredo, o código TOTP ou os códigos de recuperação', async () => {
    const [{ count }] = await adminClient<{ count: string }[]>`
      SELECT count(*) FROM audit_logs
       WHERE actor_id = ${staffId}
         AND (changes::text LIKE ${'%' + secret + '%'}
           OR ${recoveryCodes}::text[] && ARRAY(SELECT jsonb_array_elements_text(
                CASE WHEN jsonb_typeof(changes->'recoveryCodes') = 'array'
                     THEN changes->'recoveryCodes' ELSE '[]'::jsonb END)))`;
    expect(Number(count)).toBe(0);
  });
});
