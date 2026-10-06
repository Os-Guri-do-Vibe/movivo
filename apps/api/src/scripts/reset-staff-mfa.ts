/**
 * Zera o 2º fator (TOTP) de uma conta interna — para quem perdeu o aparelho E os códigos de
 * recuperação. É o único caminho de recuperação: não existe endpoint de reset (um endpoint
 * assim seria o elo fraco que o MFA existe para fechar).
 *
 * O que faz, numa transação: limpa segredo/códigos, **revoga todas as sessões** da conta (quem
 * tiver um refresh roubado cai junto) e grava `AUTH_MFA_RESET` na trilha imutável. No próximo
 * login a conta passa pela inscrição de novo (se `AUTH_MFA_REQUIRED=true`).
 *
 * Quem pode rodar: quem já tem acesso à VPS (`deploy`) e à senha da role de migração. Confirme a
 * identidade da pessoa FORA do sistema (ligação/vídeo) antes — este script não verifica nada.
 *
 * Uso (dev):
 *   cd apps/api && pnpm exec tsx src/scripts/reset-staff-mfa.ts <email>
 * Uso (produção, na VPS):
 *   cd /opt/movivo && docker compose run --rm migrate node dist/scripts/reset-staff-mfa.js <email>
 */
import { userInfo } from 'node:os';

import { and, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { loadEnv } from '../core/config/load-env';
import { auditLogs, authSessions, staff } from '../core/database/schema';

async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error('Uso: reset-staff-mfa <email-da-conta>');
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
    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ id: staff.id, role: staff.role, mfaEnabledAt: staff.mfaEnabledAt })
        .from(staff)
        .where(eq(staff.email, email))
        .limit(1);
      if (!row) return null;

      await tx
        .update(staff)
        .set({
          mfaSecretCipher: null,
          mfaEnabledAt: null,
          mfaLastStep: null,
          mfaRecoveryHashes: null,
        })
        .where(eq(staff.id, row.id));
      const revoked = await tx
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(authSessions.userId, row.id), isNull(authSessions.revokedAt)))
        .returning({ id: authSessions.id });
      await tx.insert(auditLogs).values({
        actorId: row.id,
        userId: row.id,
        action: 'AUTH_MFA_RESET',
        entityType: 'staff',
        entityId: row.id,
        changes: {
          via: 'reset-staff-mfa',
          operator: userInfo().username,
          hadMfa: row.mfaEnabledAt !== null,
          sessionsRevoked: revoked.length,
        },
        rowHash: '0'.repeat(64),
      });
      return {
        id: row.id,
        role: row.role,
        hadMfa: row.mfaEnabledAt !== null,
        sessions: revoked.length,
      };
    });

    if (!result) {
      console.error('Nenhuma conta interna com esse e-mail.');
      process.exitCode = 1;
      return;
    }
    console.warn(
      `[mfa] ${email} (${result.role}): MFA ${result.hadMfa ? 'removido' : 'já estava inativo'}; ` +
        `${result.sessions} sessão(ões) revogada(s). Próximo login passa pela inscrição.`,
    );
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
