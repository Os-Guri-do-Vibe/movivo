/**
 * Global setup da suíte de INTEGRAÇÃO.
 *
 * O MVP tem UM único profissional CREF (Leonardo/RT — decisão do fundador, Sprint 5).
 * Toda submissão de anamnese vincula o titular a esse profissional via
 * `assign_unique_active_professional`, que FALHA se não houver exatamente um RT ativo.
 * Em produção esse profissional vem do `db:seed`; os testes de integração rodam só
 * `db:migrate`, então garantimos aqui o singleton — uma vez, para toda a suíte.
 *
 * Idempotente: só insere se ainda não houver profissional ativo. Telefone/CREF fixos e
 * distintos do prefixo `RUN` dos specs, para não colidir nem ser apagado pelos teardowns
 * (que deletam por `phone LIKE '+55..RUN%'`).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import postgres from 'postgres';

import { loadEnv } from '../src/core/config/load-env';

export async function setup() {
  const { env } = loadEnv();
  const apiRoot = process.cwd();
  const admin = postgres({
    host: env.MIGRATION_DATABASE_HOST ?? 'localhost',
    port: Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT ?? 15432),
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
  try {
    // Id FIXO: vários specs asseram `professionalId === '0000...0001'` (o RT que assina
    // o protocolo). O upsert por id o garante ativo em toda re-execução da suíte.
    await admin`
      INSERT INTO users (id, phone_number, name, role, cref_number, cref_region, cref_active)
      VALUES ('00000000-0000-4000-8000-000000000001', '+5599000000010',
              'RT CREF (suite integração)', 'PROFESSIONAL', '999000', 'SP', true)
      ON CONFLICT (id) DO UPDATE SET role = 'PROFESSIONAL', cref_active = true
    `;
    // `assign_unique_active_professional` exige EXATAMENTE um profissional ativo. Desativa
    // quaisquer outros (seed de dev ou resíduo de run anterior) para deixar o singleton só.
    await admin`
      UPDATE users SET cref_active = false
      WHERE role = 'PROFESSIONAL' AND cref_active = true
        AND id <> '00000000-0000-4000-8000-000000000001'
    `;
  } finally {
    await admin.end({ timeout: 5 });
  }
}
