/**
 * Gera um magic link de check-in diário pra um titular, sem esperar o scheduler das 4h —
 * uso: teste manual local do fluxo `/treino/acessar` (achado 2026-09-10).
 *
 * Não sobe Nest/DI (mesmo motivo de `resend-protocol-delivery.ts`): replica exatamente a
 * lógica de `WorkoutAccessService.createMagicLink` (token opaco de 32 bytes, hash SHA-256
 * guardado, TTL de 48h) falando direto com Postgres.
 *
 * Uso:
 *   cd apps/api
 *   pnpm exec tsx src/scripts/generate-workout-magic-link.ts <phoneNumberE164>
 *
 * Script descartável — não faz parte do pipeline de nenhuma sprint, é só operação manual.
 */
import { createHash, randomBytes } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';

import { loadEnv } from '../core/config/load-env';
import { users, workoutAccessTokens } from '../core/database/schema';

const MAGIC_TTL_MS = 48 * 60 * 60 * 1000;

function opaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function main(): Promise<void> {
  const phone = process.argv[2];
  if (!phone) {
    console.error('Uso: tsx src/scripts/generate-workout-magic-link.ts <phoneNumberE164>');
    process.exitCode = 1;
    return;
  }

  const { env } = loadEnv();
  const host = env.MIGRATION_DATABASE_HOST ?? env.DATABASE_HOST;
  const port = Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT);
  const user = env.MIGRATION_DATABASE_USER ?? 'movivo_migrator';
  const password = env.MIGRATION_DATABASE_PASSWORD;
  const database = env.DATABASE_NAME;
  if (!host || !Number.isFinite(port) || !user || !password || !database) {
    throw new Error('Configuração incompleta. Defina MIGRATION_DATABASE_* em apps/api/.env.');
  }

  const client = postgres({ host, port, user, password, database, ssl: false, max: 1 });
  try {
    const db = drizzle(client);
    const [row] = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.phoneNumber, phone))
      .limit(1);
    if (!row) {
      console.error(`Nenhum usuário com telefone ${phone}.`);
      process.exitCode = 1;
      return;
    }

    const token = opaqueToken();
    await db.insert(workoutAccessTokens).values({
      userId: row.id,
      kind: 'MAGIC',
      tokenHash: tokenHash(token),
      expiresAt: new Date(Date.now() + MAGIC_TTL_MS),
    });

    console.warn(`[link] titular: ${row.name} (${row.id})`);
    console.warn(`[link] ${env.PUBLIC_SITE_URL}/treino/acessar#token=${token}`);
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error('[generate-workout-magic-link] falhou:', error);
  process.exitCode = 1;
});
