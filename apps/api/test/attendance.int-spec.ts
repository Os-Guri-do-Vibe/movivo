/**
 * Integração — pausa do atendimento automático (aba "Conversas"), com RLS real.
 * Pré-requisito: `pnpm run infra:up`.
 *
 * Prova: a pausa grava `users.attendance_paused_at` (UPDATE em `users` pelo contexto SYSTEM), é
 * lida sob a RLS do próprio titular, é idempotente, não vaza para outro titular e a
 * reativação limpa o estado.
 */
import 'reflect-metadata';

import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { AttendanceService } from '../src/core/database/attendance.service';
import { users } from '../src/core/database/schema';
import { TenantDatabase } from '../src/core/database/tenant-database.service';

let app: INestApplication;
let db: TenantDatabase;
let attendance: AttendanceService;
const createdUserIds: string[] = [];

async function createUser(): Promise<string> {
  const phone = `+55119${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const rows = await db.runAsSystem((tx) =>
    tx
      .insert(users)
      .values({ phoneNumber: phone, email: `${phone.replace(/\D/g, '')}@example.invalid` })
      .returning({ id: users.id }),
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('falha ao criar usuário de teste');
  createdUserIds.push(id);
  return id;
}

const pausedAt = (userId: string) =>
  db.runAsSystem(async (tx) => {
    const [row] = await tx
      .select({ at: users.attendancePausedAt })
      .from(users)
      .where(eq(users.id, userId));
    return row?.at ?? null;
  });

beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  db = app.get(TenantDatabase);
  attendance = app.get(AttendanceService);
});

afterAll(async () => {
  if (db && createdUserIds.length > 0) {
    await db.runAsSystem(async (tx) => {
      await tx.delete(users).where(inArray(users.id, createdUserIds));
      return undefined;
    });
  }
  await app?.close();
});

describe('AttendanceService sob RLS', () => {
  it('nasce ativo (o Coach responde) para um titular novo', async () => {
    const id = await createUser();
    expect(await attendance.isPaused(id)).toBe(false);
  });

  it('pausa, lê sob a RLS do titular e reativa', async () => {
    const id = await createUser();

    expect(await attendance.setPaused(id, true)).toBe(true);
    expect(await attendance.isPaused(id)).toBe(true);
    expect(await pausedAt(id)).toBeInstanceOf(Date);

    expect(await attendance.setPaused(id, false)).toBe(true);
    expect(await attendance.isPaused(id)).toBe(false);
    expect(await pausedAt(id)).toBeNull();
  });

  it('é idempotente: pausar de novo não muda o estado nem renova a data', async () => {
    const id = await createUser();
    await attendance.setPaused(id, true);
    const first = await pausedAt(id);

    expect(await attendance.setPaused(id, true)).toBe(false);
    expect(await pausedAt(id)).toEqual(first);
    expect(await attendance.setPaused(id, false)).toBe(true);
    expect(await attendance.setPaused(id, false)).toBe(false);
  });

  it('não vaza entre titulares: pausar A não pausa B', async () => {
    const a = await createUser();
    const b = await createUser();
    await attendance.setPaused(a, true);

    expect(await attendance.isPaused(a)).toBe(true);
    expect(await attendance.isPaused(b)).toBe(false);
  });
});
