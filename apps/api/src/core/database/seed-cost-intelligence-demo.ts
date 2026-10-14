/**
 * Massa sintética local para demonstrar a Inteligência de Custos.
 *
 * Cria uma distribuição deliberadamente assimétrica: a maior parte dos titulares usa pouco,
 * enquanto quatro simulam uso intenso. É idempotente por marcadores técnicos e nunca executa
 * em produção. Não contém conteúdo, telefone ou e-mail de pessoa real.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadEnv } from '../config/load-env';
import { SECRET_KEYS } from '../config/resolve-file-secrets';
import { aiJobs, conversations, subscriptions, users } from './schema';
import { migrationPostgresTls } from './postgres-tls';

// O seed só abre uma conexão de migração; não deve exigir chaves de provedores de IA
// que pertencem ao runtime da aplicação. As credenciais do banco continuam usando K_FILE.
const databaseSecretKeys = new Set([
  'DATABASE_PASSWORD',
  'MIGRATION_DATABASE_PASSWORD',
  'DATABASE_SSL_CA',
  'MIGRATION_DATABASE_SSL_CA',
]);
const seedProcessEnv = { ...process.env };
for (const key of SECRET_KEYS) {
  if (!databaseSecretKeys.has(key)) seedProcessEnv[`${key}_FILE`] = '';
}
// O Compose seguro local monta este cofre; o `.env` genérico pode apontar para
// um cofre anterior. Preferir o material de desenvolvimento, sem nunca ler ou expor seu valor.
const localSecretDirectory = resolve(process.cwd(), '../../secrets/desenvolvimento');
const localMigrationPassword = resolve(localSecretDirectory, 'postgres_migrator_password');
const localCertificateAuthority = resolve(localSecretDirectory, 'internal_tls/ca.crt');
if (existsSync(localMigrationPassword) && existsSync(localCertificateAuthority)) {
  seedProcessEnv.MIGRATION_DATABASE_PASSWORD_FILE = localMigrationPassword;
  seedProcessEnv.MIGRATION_DATABASE_SSL = 'true';
  seedProcessEnv.MIGRATION_DATABASE_SSL_CA_FILE = localCertificateAuthority;
}
const { env } = loadEnv(seedProcessEnv);
if (env.NODE_ENV === 'production' || env.APP_ENV === 'production') {
  throw new Error('[db:seed:cost-intelligence] Recusado em produção.');
}

const host = env.MIGRATION_DATABASE_HOST ?? env.DATABASE_HOST;
const port = Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT);
const user = env.MIGRATION_DATABASE_USER ?? 'movivo_migrator';
const password = env.MIGRATION_DATABASE_PASSWORD;
const database = env.DATABASE_NAME;
if (!host || !Number.isFinite(port) || !password || !database) {
  throw new Error('[db:seed:cost-intelligence] Configuração de banco incompleta.');
}

const DEMO_MARKER = 'cost-intelligence-demo-v1';
const DEMO_USERS = 60;
const DAY_MS = 86_400_000;
const INSERT_BATCH_SIZE = 100;

function occurredAt(daysAgo: number, hour: number): Date {
  const date = new Date(Date.now() - daysAgo * DAY_MS);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

async function main(): Promise<void> {
  const client = postgres({
    host,
    port,
    user,
    password,
    database,
    ssl: migrationPostgresTls(env, host),
    max: 1,
    idle_timeout: 5,
    onnotice: () => undefined,
  });

  try {
    const db = drizzle(client);
    // Só remove linhas marcadas por este seed; nenhum outro dado local é tocado.
    await client`delete from ai_jobs where input_snapshot = ${DEMO_MARKER}`;
    await client`delete from conversations where whatsapp_msg_id like ${`${DEMO_MARKER}-%`}`;

    const jobRows: Array<typeof aiJobs.$inferInsert> = [];
    const messageRows: Array<typeof conversations.$inferInsert> = [];

    for (let index = 0; index < DEMO_USERS; index += 1) {
      const sequence = String(index + 1).padStart(2, '0');
      const phoneNumber = `+5555800000${sequence}`;
      const [student] = await db
        .insert(users)
        .values({
          phoneNumber,
          name: `Custo Demo ${sequence} (sintético)`,
          email: `cost-intelligence-demo-${sequence}@example.invalid`,
          status: 'ACTIVE',
        })
        .onConflictDoUpdate({ target: users.phoneNumber, set: { status: 'ACTIVE' } })
        .returning({ id: users.id });
      if (!student) throw new Error(`Não foi possível criar o aluno sintético ${sequence}.`);

      await db
        .insert(subscriptions)
        .values({
          userId: student.id,
          plan: 'MONTHLY',
          priceCents: 3900,
          monthlyPriceCents: 3900,
          totalPriceCents: 3900,
          commitmentMonths: 1,
          status: 'ACTIVE',
          currentPeriodStart: occurredAt(29, 12),
          currentPeriodEnd: occurredAt(-1, 12),
        })
        .onConflictDoUpdate({
          target: subscriptions.userId,
          set: { status: 'ACTIVE', currentPeriodEnd: occurredAt(-1, 12) },
        });

      const highUsage = index >= DEMO_USERS - 4;
      const activeDays = highUsage ? 16 + (index % 3) : 3 + (index % 8);
      const extraMessages = highUsage ? 4 : index % 3 === 0 ? 1 : 0;
      for (let dayIndex = 0; dayIndex < activeDays; dayIndex += 1) {
        const daysAgo = (index * 3 + dayIndex * 2) % 30;
        const createdAt = occurredAt(daysAgo, 12 + (dayIndex % 5));
        const suffix = `${sequence}-${daysAgo}-${dayIndex}`;
        messageRows.push({
          userId: student.id,
          direction: 'INBOUND',
          content: 'Mensagem sintética para métrica agregada.',
          whatsappMsgId: `${DEMO_MARKER}-${suffix}-in`,
          createdAt,
          updatedAt: createdAt,
        });
        messageRows.push({
          userId: student.id,
          direction: 'OUTBOUND',
          content: 'Resposta sintética do AI Coach para métrica agregada.',
          whatsappMsgId: `${DEMO_MARKER}-${suffix}-out-0`,
          createdAt,
          updatedAt: createdAt,
        });
        for (let message = 1; message <= extraMessages; message += 1) {
          messageRows.push({
            userId: student.id,
            direction: 'OUTBOUND',
            content: 'Mensagem automática sintética para métrica agregada.',
            whatsappMsgId: `${DEMO_MARKER}-${suffix}-out-${message}`,
            createdAt,
            updatedAt: createdAt,
          });
        }
        const jobs = highUsage ? 5 : 1 + (index % 2);
        for (let job = 0; job < jobs; job += 1) {
          jobRows.push({
            userId: student.id,
            jobType: 'AI_RESPONSE',
            status: 'COMPLETED',
            modelUsed: 'gpt-4.1-mini',
            provider: 'openai',
            tokensInput: 800 + index * 23 + job * 120,
            tokensOutput: 240 + (index % 5) * 30 + job * 25,
            latencyMs: 700 + (index % 9) * 80,
            intent: 'COST_DEMO',
            inputSnapshot: DEMO_MARKER,
            startedAt: createdAt,
            completedAt: createdAt,
            createdAt,
            updatedAt: createdAt,
          });
        }
      }
    }

    for (let start = 0; start < messageRows.length; start += INSERT_BATCH_SIZE) {
      await db.insert(conversations).values(messageRows.slice(start, start + INSERT_BATCH_SIZE));
    }
    for (let start = 0; start < jobRows.length; start += INSERT_BATCH_SIZE) {
      await db.insert(aiJobs).values(jobRows.slice(start, start + INSERT_BATCH_SIZE));
    }
    process.stdout.write(
      `[db:seed:cost-intelligence] ${DEMO_USERS} titulares, ${jobRows.length} jobs e ${messageRows.length} mensagens sintéticas prontos.\n`,
    );
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  const cause = error instanceof Error ? error.cause : undefined;
  console.error(
    cause instanceof Error ? cause.message : error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
