/**
 * Seed de desenvolvimento (TASK-0.4.4).
 *
 * Popula o mínimo para desenvolver e para os testes de integração da Mariana
 * (US-0.8) sem depender de um fluxo de onboarding que ainda não existe.
 *
 * ## Dados sintéticos — regra, não recomendação
 * Nenhum dado real de pessoa entra aqui, **nunca**. Os telefones usam o prefixo
 * `+5555` (código de país inexistente) e o domínio `@example.invalid`
 * (reservado pela RFC 2606 e garantidamente não-resolvível). Isso é deliberado:
 * um seed com telefone plausível é um acidente esperando para acontecer quando
 * alguém apontar o ambiente para uma API real de WhatsApp. Ver `ARQUITETURA.md` §8.
 *
 * ## Idempotência
 * `ON CONFLICT DO NOTHING` sobre a chave natural (`phone_number`, que é UNIQUE).
 * Rodar N vezes converge para o mesmo estado — o script é seguro em `make reset`,
 * em CI e na máquina de qualquer dev.
 *
 * Roda pela conexão de **migração** (direta, `movivo_migrator`), e não pela 5433,
 * porque é uma tarefa de manutenção de schema/dados de dev — o mesmo caminho do
 * `db:migrate`, não o caminho de runtime da aplicação.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { loadEnv } from '../config/load-env';
import { users } from './schema';

const { env } = loadEnv();

const host = env.MIGRATION_DATABASE_HOST ?? env.DATABASE_HOST;
const port = Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT);
const user = env.MIGRATION_DATABASE_USER ?? 'movivo_migrator';
const password = env.MIGRATION_DATABASE_PASSWORD;
const database = env.DATABASE_NAME;

if (!host || !Number.isFinite(port) || !user || !password || !database) {
  throw new Error(
    '[db:seed] Configuração incompleta. Defina MIGRATION_DATABASE_* em apps/api/.env (ver .env.example).',
  );
}

/**
 * Usuários sintéticos cobrindo os dois estados que os testes precisam distinguir:
 * um em trial (caminho feliz da conversão) e um que exige revisão do profissional
 * CREF por PAR-Q positivo (o caminho em que a IA **não** decide sozinha).
 */
const SEED_USERS = [
  {
    phoneNumber: '+5555000000001',
    name: 'Dev Um (sintético)',
    email: 'dev-um@example.invalid',
    whatsappName: 'Dev Um',
    status: 'TRIAL' as const,
    requiresProfessionalReview: false,
  },
  {
    phoneNumber: '+5555000000002',
    name: 'Dev Dois (sintético)',
    email: 'dev-dois@example.invalid',
    whatsappName: 'Dev Dois',
    status: 'ONBOARDING' as const,
    // PAR-Q positivo: gate que obriga revisão humana (Clóvis/Alexandre).
    requiresProfessionalReview: true,
  },
];

async function main(): Promise<void> {
  const client = postgres({
    host,
    port,
    user,
    password,
    database,
    ssl: false,
    max: 1,
    idle_timeout: 5,
    onnotice: () => {
      /* notices do Postgres não vão para o log: podem conter valores. */
    },
  });

  try {
    const db = drizzle(client);

    const inserted = await db
      .insert(users)
      .values(
        SEED_USERS.map((seedUser) => ({
          ...seedUser,
          trialStartedAt: seedUser.status === 'TRIAL' ? new Date() : null,
          // Trial de 7 dias sem cartão (Eduardo, 07-relatorio-eduardo.md).
          trialEndsAt:
            seedUser.status === 'TRIAL' ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : null,
        })),
      )
      .onConflictDoNothing({ target: users.phoneNumber })
      .returning({ id: users.id });

    const rows = await client<{ total: number }[]>`
      SELECT count(*)::int AS total FROM users
    `;
    const total = rows[0]?.total ?? 0;

    console.log(
      `[db:seed] ${inserted.length} usuário(s) inserido(s) nesta execução; ` +
        `${total} no total (idempotente: reexecutar não duplica).`,
    );

    if (total !== SEED_USERS.length) {
      console.warn(
        `[db:seed] Aviso: total (${total}) difere do seed (${SEED_USERS.length}). ` +
          'Provavelmente há dados de desenvolvimento além do seed — ok em dev.',
      );
    }
  } finally {
    await client.end({ timeout: 5 });
  }
}

// Trava de segurança: seed jamais roda contra produção.
if (env.NODE_ENV === 'production' || env.APP_ENV === 'production') {
  throw new Error('[db:seed] Recusado: seed não roda em produção.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
