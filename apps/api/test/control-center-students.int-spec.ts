/**
 * Regressão do achado 2026-08-25: `${users.id}` interpolado dentro de um `sql` template,
 * em correlação de subquery, NÃO qualifica com a tabela — vira `"id"` cru no SQL gerado.
 * Como toda tabela correlacionada (`subscriptions`, `anamnesis_sessions`, `protocols`, …)
 * tem sua própria coluna `id`, o Postgres resolvia pro escopo mais interno (`s.id`), nunca
 * pro `users.id` externo: `s.user_id = s.id`, sempre falso, sempre `null`, sem erro nenhum.
 * `ControlCenterService.students()`/`.student()` mostravam "Plano" e "Data de inscrição"
 * como "Não informado" para TODO aluno, mesmo com assinatura e anamnese reais no banco.
 *
 * Unit tests com `tx` mockado nunca pegariam isso — o bug é do SQL gerado contra Postgres
 * de verdade, não da lógica em volta dele. Só um teste de integração prova a correlação.
 */
import 'reflect-metadata';

import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { loadEnv } from '../src/core/config/load-env';
import type { AuthenticatedUser } from '../src/modules/auth/jwt.strategy';
import { ControlCenterService } from '../src/modules/admin/control-center.service';

const { env } = loadEnv();
const RUN = Date.now().toString().slice(-8);
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

let app: INestApplication;
let actor: AuthenticatedUser;
let studentId: string;
const SUBMITTED_AT = '2026-08-01T12:00:00Z';

beforeAll(async () => {
  const [admin] = await migrator<{ id: string }[]>`
    INSERT INTO users (phone_number, name, role, status)
    VALUES (${`+5561${RUN}00`}, ${`Admin ${RUN}`}, 'ADMIN', 'ACTIVE')
    RETURNING id
  `;
  if (!admin) throw new Error('Falha ao criar ADMIN de teste.');
  actor = { userId: admin.id, role: 'ADMIN', jti: randomUUID() };

  const [student] = await migrator<{ id: string }[]>`
    INSERT INTO users (phone_number, name, role, status)
    VALUES (${`+5561${RUN}01`}, ${`Aluno ${RUN}`}, 'USER', 'ONBOARDING')
    RETURNING id
  `;
  if (!student) throw new Error('Falha ao criar aluno de teste.');
  studentId = student.id;

  await migrator`
    INSERT INTO anamnesis_sessions (user_id, token, status, expires_at, submitted_at, created_at, updated_at)
    VALUES (${studentId}::uuid, ${randomUUID().replaceAll('-', '')}, 'SUBMITTED', '2026-12-31T00:00:00Z',
            ${SUBMITTED_AT}, ${SUBMITTED_AT}, ${SUBMITTED_AT})
  `;
  await migrator`
    INSERT INTO subscriptions (user_id, plan, price_cents, status, trial_ends_at, created_at, updated_at)
    VALUES (${studentId}::uuid, 'MONTHLY', 3900, 'TRIALING', '2026-09-01T00:00:00Z', ${SUBMITTED_AT}, ${SUBMITTED_AT})
  `;

  app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
}, 30_000);

afterAll(async () => {
  await app?.close();
  await migrator`DELETE FROM subscriptions WHERE user_id = ${studentId}::uuid`;
  await migrator`DELETE FROM anamnesis_sessions WHERE user_id = ${studentId}::uuid`;
  // students()/student() auditam a leitura (STUDENTS_LIST_VIEWED/HEALTH_DATA_VIEWED) —
  // audit_logs é append-only (trigger de imutabilidade), precisa ser destravada pra
  // limpar o titular de teste, mesmo padrão de campaign-economics.int-spec.ts.
  await migrator`ALTER TABLE audit_logs DISABLE TRIGGER trg_audit_logs_immutable`;
  await migrator`DELETE FROM audit_logs WHERE actor_id = ${actor.userId}::uuid OR user_id = ${studentId}::uuid`;
  await migrator`ALTER TABLE audit_logs ENABLE TRIGGER trg_audit_logs_immutable`;
  await migrator`DELETE FROM users WHERE id IN (${studentId}::uuid, ${actor.userId}::uuid)`;
  await migrator.end({ timeout: 5 });
});

describe('base de alunos — plano e data de inscrição (achado 2026-08-25)', () => {
  it('students(): plano e data de inscrição vêm preenchidos, não "Não informado"', async () => {
    const response = await app.get(ControlCenterService).students(actor);
    const row = response.data.students.find((item) => item.id === studentId);
    expect(row).toBeDefined();
    expect(row?.enrolledAt).toBe(new Date(SUBMITTED_AT).toISOString());
    expect(row?.subscriptionStatus).toBe('TRIALING');
    expect(row?.subscriptionPlan).toBe('MONTHLY');
  });

  it('student(): mesma correlação corrigida na ficha individual', async () => {
    const response = await app.get(ControlCenterService).student(actor, studentId);
    expect(response.data.student.enrolledAt).toBe(new Date(SUBMITTED_AT).toISOString());
    expect(response.data.student.subscriptionStatus).toBe('TRIALING');
    expect(response.data.student.subscriptionPlan).toBe('MONTHLY');
  });
});
