import { migrationPostgresTls } from '../src/core/database/postgres-tls';
/**
 * Integração — selo de "não lidas" da aba Conversas, contra o Postgres real.
 *
 * O que só o banco prova: o `count(*) filter (...)` do `list()` conta apenas mensagem do
 * ALUNO (INBOUND) que não seja SYSTEM (👍/👎) e que chegou depois do ponteiro de leitura; e o
 * `GREATEST(...)` do `markRead()` só avança o ponteiro, nunca o devolve para trás nem o
 * leva para o futuro. Um `tx` mockado jamais pegaria erro nesse SQL.
 */
import 'reflect-metadata';

import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { loadEnv } from '../src/core/config/load-env';
import { ConversationsService } from '../src/modules/admin/conversations.service';
import type { AuthenticatedUser } from '../src/modules/auth/jwt.strategy';

const { env } = loadEnv();
const RUN = Date.now().toString().slice(-8);
const migrator = postgres({
  host: env.MIGRATION_DATABASE_HOST ?? 'localhost',
  ssl: migrationPostgresTls(env, env.MIGRATION_DATABASE_HOST ?? 'localhost'),
  port: Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT ?? 15432),
  user: env.MIGRATION_DATABASE_USER ?? 'movivo_migrator',
  password: env.MIGRATION_DATABASE_PASSWORD,
  database: env.DATABASE_NAME ?? 'movivo',
  max: 1,
  prepare: false,
  idle_timeout: 5,
  onnotice: () => undefined,
});

let app: INestApplication;
let service: ConversationsService;
let actor: AuthenticatedUser;
let studentId: string;
/** `created_at` das mensagens semeadas, em ordem: m1..m5. */
const at: string[] = [];

const unreadInList = async () => {
  const { data } = await service.list(actor);
  return data.conversations.find((item) => item.studentId === studentId)?.unreadCount;
};

beforeAll(async () => {
  const [admin] = await migrator<{ id: string }[]>`
    INSERT INTO staff (phone_number, email, name, role, status, password_hash)
    VALUES (${`+5562${RUN}00`}, ${`admin_unread_${RUN}@movivo.test`}, ${`Admin ${RUN}`}, 'ADMIN', 'ACTIVE', 'x')
    RETURNING id
  `;
  if (!admin) throw new Error('Falha ao criar ADMIN de teste.');
  actor = { userId: admin.id, role: 'ADMIN', jti: randomUUID() };

  // `conversation_read_at` fica NULL: aluno que nunca teve a conversa lida.
  const [student] = await migrator<{ id: string }[]>`
    INSERT INTO users (phone_number, name, role, status, email, conversation_read_at)
    VALUES (${`+5562${RUN}01`}, ${`Aluno ${RUN}`}, 'USER', 'ONBOARDING', ${`aluno_unread_${RUN}@example.invalid`}, NULL)
    RETURNING id
  `;
  if (!student) throw new Error('Falha ao criar aluno de teste.');
  studentId = student.id;

  // m1 aluno · m2 MOVIVO · m3 feedback (SYSTEM) · m4 aluno · m5 aluno — a cada 5 min, no passado.
  const rows: Array<[number, 'INBOUND' | 'OUTBOUND', 'TEXT' | 'SYSTEM']> = [
    [50, 'INBOUND', 'TEXT'],
    [45, 'OUTBOUND', 'TEXT'],
    [40, 'INBOUND', 'SYSTEM'],
    [35, 'INBOUND', 'TEXT'],
    [30, 'INBOUND', 'TEXT'],
  ];
  for (const [minutesAgo, direction, type] of rows) {
    const [row] = await migrator<{ created_at: Date }[]>`
      INSERT INTO conversations (user_id, direction, message_type, content, created_at)
      VALUES (${studentId}::uuid, ${direction}::message_direction, ${type}::message_type, 'x',
              now() - make_interval(mins => ${minutesAgo}))
      RETURNING created_at
    `;
    if (!row) throw new Error('Falha ao semear mensagem.');
    at.push(row.created_at.toISOString());
  }

  app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  service = app.get(ConversationsService);
}, 30_000);

afterAll(async () => {
  await app?.close();
  await migrator`DELETE FROM conversations WHERE user_id = ${studentId}::uuid`;
  // list() audita a leitura; audit_logs é append-only — destrava só para limpar o teste.
  await migrator`ALTER TABLE audit_logs DISABLE TRIGGER trg_audit_logs_immutable`;
  await migrator`DELETE FROM audit_logs WHERE actor_id = ${actor.userId}::uuid OR user_id = ${studentId}::uuid`;
  await migrator`ALTER TABLE audit_logs ENABLE TRIGGER trg_audit_logs_immutable`;
  await migrator`DELETE FROM users WHERE id = ${studentId}::uuid`;
  await migrator`DELETE FROM staff WHERE id = ${actor.userId}::uuid`;
  await migrator.end({ timeout: 5 });
});

describe('selo de não lidas (aba Conversas)', () => {
  it('nunca lida: conta só as mensagens do aluno, sem a do MOVIVO nem o feedback SYSTEM', async () => {
    expect(await unreadInList()).toBe(3); // m1, m4, m5
  });

  it('a mensagem lida não volta como "não lida" por diferença de precisão (µs no banco, ms no `upTo`)', async () => {
    // `at[]` vem do driver em milissegundos; `created_at` no banco tem microssegundos.
    const [exact] = await migrator<{ micros: boolean }[]>`
      SELECT bool_or(extract(microseconds FROM created_at)::bigint % 1000 <> 0) AS micros
      FROM conversations WHERE user_id = ${studentId}::uuid
    `;
    expect(exact?.micros).toBe(true); // o cenário do defeito realmente existe nos dados semeados
  });

  it('markRead(upTo) avança o ponteiro e devolve o que ficou depois dele', async () => {
    const res = await service.markRead(actor, studentId, { upTo: at[3] }); // até m4
    expect(res.data.unreadCount).toBe(1); // só m5 (m4 == ponteiro não conta)
    expect(await unreadInList()).toBe(1);
  });

  it('o ponteiro só avança: um `upTo` mais antigo não desfaz a leitura', async () => {
    const res = await service.markRead(actor, studentId, { upTo: at[0] }); // m1, já superado
    expect(res.data.unreadCount).toBe(1);
    expect(await unreadInList()).toBe(1);
  });

  it('um `upTo` no futuro é limitado a agora: não "lê" mensagens que ainda vão chegar', async () => {
    await migrator`UPDATE users SET conversation_read_at = ${at[1]}::timestamptz WHERE id = ${studentId}::uuid`;
    const res = await service.markRead(actor, studentId, { upTo: '2999-01-01T00:00:00.000Z' });
    expect(res.data.unreadCount).toBe(0);

    // Mensagem que chega DEPOIS da marca volta a contar — prova que o ponteiro não foi para 2999.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await migrator`
      INSERT INTO conversations (user_id, direction, message_type, content)
      VALUES (${studentId}::uuid, 'INBOUND', 'TEXT', 'depois')
    `;
    expect(await unreadInList()).toBe(1);
  });

  it('markRead sem corpo marca tudo até agora', async () => {
    const res = await service.markRead(actor, studentId, {});
    expect(res.data.unreadCount).toBe(0);
    expect(await unreadInList()).toBe(0);
  });
});
