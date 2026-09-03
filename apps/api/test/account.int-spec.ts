/**
 * Integração — ACCOUNT (tela "Minha Conta"): sobe o `AppModule` REAL contra o stack
 * Docker (Postgres via PgBouncer, Redis) e prova, por I/O de verdade — não mock —, o
 * que a RLS de `users` (self-service) e o storage de avatar em disco precisam garantir:
 *
 *   · GET/PATCH /account/profile só enxerga e só grava a PRÓPRIA linha (RLS `self`);
 *   · e-mail nunca muda, mesmo enviado no corpo (não existe no schema Zod do endpoint);
 *   · telefone duplicado vira 409, formato fora de E.164 vira 400 (Zod, antes do banco);
 *   · POST /account/password exige a senha atual — sem ela, nada muda;
 *   · POST /account/avatar grava no disco e devolve uma URL; GET nessa URL funciona SEM
 *     Authorization (é `<img src>` de navegador) e um nome de arquivo forjado dá 404.
 *
 * `/auth/login` tem throttle de 10/min por IP (compartilhado, em memória, com
 * `auth.int-spec.ts` — mesmo fork único da suíte de integração). Por isso este arquivo
 * faz login UMA vez por conta em `beforeAll` e reusa o access token; só chama
 * `/auth/login` de novo onde o próprio comportamento testado exige (troca de senha).
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
let userAId = '';
let userBId = '';
let accessA = '';
let accessB = '';

const PASSWORD = 'Senha-Forte-Teste-123!';
const emailA = `conta_a_${RUN}@movivo.test`;
const emailB = `conta_b_${RUN}@movivo.test`;
const phoneA = `+55558${RUN}3`;
const phoneB = `+55558${RUN}4`;

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

async function login(email: string, password = PASSWORD): Promise<request.Response> {
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

  userAId = await tenant.runAsSystem(async (tx) => {
    const rows = (await tx.execute(
      sql`INSERT INTO users (phone_number, email, name, role, password_hash)
          VALUES (${phoneA}, ${emailA}, 'Conta A', 'ADMIN', ${hash})
          RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    return rows[0].id;
  });
  userBId = await tenant.runAsSystem(async (tx) => {
    const rows = (await tx.execute(
      sql`INSERT INTO users (phone_number, email, name, role, password_hash)
          VALUES (${phoneB}, ${emailB}, 'Conta B', 'MARKETING', ${hash})
          RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    return rows[0].id;
  });

  accessA = (await login(emailA)).body.accessToken as string;
  accessB = (await login(emailB)).body.accessToken as string;
}, 60_000);

afterAll(async () => {
  try {
    await adminClient.unsafe(`DELETE FROM users WHERE id IN ('${userAId}','${userBId}')`);
  } finally {
    await adminClient.end({ timeout: 5 });
    await app?.close();
  }
});

describe('GET /account/profile', () => {
  it('devolve a própria conta — nome, e-mail, telefone, papel e avatar nulo', async () => {
    const res = await base()
      .get(`/${prefix}/account/profile`)
      .set('Authorization', `Bearer ${accessA}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Conta A',
      email: emailA,
      phoneNumber: phoneA,
      avatarUrl: null,
      role: 'ADMIN',
    });
  });

  it('exige autenticação', async () => {
    const res = await base().get(`/${prefix}/account/profile`);
    expect(res.status).toBe(401);
  });
});

describe('PATCH /account/profile', () => {
  it('atualiza o nome e ignora e-mail enviado no corpo (imutável)', async () => {
    const res = await base()
      .patch(`/${prefix}/account/profile`)
      .set('Authorization', `Bearer ${accessA}`)
      .send({ name: 'Conta A Renomeada', email: 'nao-deveria-mudar@movivo.test' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Conta A Renomeada');
    expect(res.body.email).toBe(emailA);
  });

  it('recusa telefone fora do formato E.164 antes de tocar o banco', async () => {
    const res = await base()
      .patch(`/${prefix}/account/profile`)
      .set('Authorization', `Bearer ${accessA}`)
      .send({ phoneNumber: '11999999999' });
    expect(res.status).toBe(400);
  });

  it('recusa telefone já usado por outra conta com 409', async () => {
    const res = await base()
      .patch(`/${prefix}/account/profile`)
      .set('Authorization', `Bearer ${accessA}`)
      .send({ phoneNumber: phoneB });
    expect(res.status).toBe(409);
  });

  it('recusa corpo vazio (nenhum campo para atualizar)', async () => {
    const res = await base()
      .patch(`/${prefix}/account/profile`)
      .set('Authorization', `Bearer ${accessA}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /account/password', () => {
  it('recusa com senha atual incorreta e não altera nada', async () => {
    const res = await base()
      .post(`/${prefix}/account/password`)
      .set('Authorization', `Bearer ${accessB}`)
      .send({ currentPassword: 'senha-errada', newPassword: 'Nova-Senha-Forte-123' });
    expect(res.status).toBe(401);

    // A senha antiga continua válida — a troca não teve efeito nenhum.
    expect((await login(emailB)).status).toBe(200);
  });

  it('troca a senha com a senha atual correta; login antigo passa a falhar', async () => {
    const res = await base()
      .post(`/${prefix}/account/password`)
      .set('Authorization', `Bearer ${accessB}`)
      .send({ currentPassword: PASSWORD, newPassword: 'Nova-Senha-Forte-123' });
    expect(res.status).toBe(204);

    expect((await login(emailB, PASSWORD)).status).toBe(401);
    expect((await login(emailB, 'Nova-Senha-Forte-123')).status).toBe(200);
  });
});

describe('POST /account/avatar + GET /account/avatar/:filename', () => {
  it('grava o arquivo, devolve avatarUrl e a URL serve a imagem sem autenticação', async () => {
    const png = Buffer.from(
      // Um PNG 1x1 mínimo válido é irrelevante aqui — o serviço confia no
      // Content-Type declarado no multipart, não faz sniffing de bytes.
      '89504e470d0a1a0a0000000d49484452',
      'hex',
    );

    const upload = await base()
      .post(`/${prefix}/account/avatar`)
      .set('Authorization', `Bearer ${accessA}`)
      .attach('avatar', png, { filename: 'foto.png', contentType: 'image/png' });

    expect(upload.status).toBe(201);
    expect(upload.body.avatarUrl).toMatch(/\/account\/avatar\/[0-9a-f-]{36}\.png$/);

    const path = new URL(upload.body.avatarUrl).pathname;
    const served = await base().get(path);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toContain('image/png');
  });

  it('devolve 404 para um nome de arquivo forjado', async () => {
    const res = await base().get(`/${prefix}/account/avatar/nao-existe.png`);
    expect(res.status).toBe(404);
  });

  it('recusa upload de tipo não suportado', async () => {
    const res = await base()
      .post(`/${prefix}/account/avatar`)
      .set('Authorization', `Bearer ${accessA}`)
      .attach('avatar', Buffer.from('não é imagem'), {
        filename: 'arquivo.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBe(400);
  });
});
