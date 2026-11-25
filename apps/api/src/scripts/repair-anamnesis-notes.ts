/**
 * Conserta as notas de texto livre da anamnese gravadas no formato antigo.
 *
 * Antes, motivação, preferências de treino, exercícios a evitar, suplemento, alimentos que gosta
 * e alimentos que evita iam para UMA nota cortada em 500 caracteres. Para quem escreveu bastante,
 * o fim sumia, e o fim era "Alimentos que evita": o plano alimentar saía com o que o aluno não
 * come. As respostas originais continuam na sessão da anamnese; este script regrava as notas,
 * uma por assunto, a partir delas.
 *
 *   docker compose exec api node --enable-source-maps dist/scripts/repair-anamnesis-notes.js \
 *     [--user <userId>] [--dry-run]
 *
 * Idempotente: quem já está certo não é tocado. Não imprime conteúdo (é dado de saúde), só
 * quantos alunos foram consertados e os ids. O plano alimentar vigente NÃO é refeito aqui: depois
 * do conserto, regere o protocolo de quem foi afetado.
 *
 * Roda do `dist/` compilado: só núcleo (banco e cifra), nunca o `AppModule`, que liga os workers.
 */
import 'reflect-metadata';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { and, desc, eq } from 'drizzle-orm';
import { parseArgs } from 'node:util';

import { CoreModule } from '../core/core.module';
import { HealthCipherService } from '../core/database/health-cipher.service';
import { anamnesisSessions, studentHealthRecords } from '../core/database/schema';
import { TenantDatabase } from '../core/database/tenant-database.service';
import {
  healthNotes,
  repairedNotes,
  type OnboardingAnswers,
} from '../modules/student-state/onboarding-projection';

@Module({ imports: [CoreModule] })
class RepairNotesCliModule {}

const print = (line: string) => process.stdout.write(`${line}\n`);

type Block = Record<string, unknown> | undefined;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { user: { type: 'string' }, 'dry-run': { type: 'boolean' } },
  });
  const dryRun = values['dry-run'] === true;
  const app = await NestFactory.createApplicationContext(RepairNotesCliModule, {
    logger: ['error', 'warn'],
  });
  try {
    const db = app.get(TenantDatabase);
    const cipher = app.get(HealthCipherService);
    const sessions = await db.runAsSystem((tx) =>
      tx
        .select({
          userId: anamnesisSessions.userId,
          blocks: anamnesisSessions.blocks,
          sensitive: anamnesisSessions.sensitive,
        })
        .from(anamnesisSessions)
        .where(
          and(
            eq(anamnesisSessions.status, 'SUBMITTED'),
            ...(values.user ? [eq(anamnesisSessions.userId, values.user)] : []),
          ),
        )
        .orderBy(desc(anamnesisSessions.submittedAt)),
    );
    const seen = new Set<string>();
    let checked = 0;
    const repaired: string[] = [];
    for (const session of sessions) {
      // A sessão enviada mais recente de cada aluno é a que vale.
      if (!session.userId || seen.has(session.userId)) continue;
      seen.add(session.userId);
      checked += 1;
      const userId = session.userId;
      const secret = session.sensitive
        ? (JSON.parse(await cipher.decryptHealth(session.sensitive)) as Record<string, Block>)
        : {};
      const merged = (key: string) => ({
        ...((session.blocks as Record<string, Block>)[key] ?? {}),
        ...(secret[key] ?? {}),
      });
      const fromAnswers = healthNotes({
        goals: merged('goals'),
        preferences: merged('preferences'),
        nutrition: merged('nutrition'),
      } as unknown as Pick<OnboardingAnswers, 'goals' | 'preferences' | 'nutrition'>);

      const changed = await db.runAsSystem(async (tx) => {
        const rows = await tx
          .select({ id: studentHealthRecords.id, payload: studentHealthRecords.payload })
          .from(studentHealthRecords)
          .where(
            and(
              eq(studentHealthRecords.userId, userId),
              eq(studentHealthRecords.kind, 'NOTES'),
              eq(studentHealthRecords.status, 'ACTIVE'),
              eq(studentHealthRecords.origin, 'DECLARED'),
            ),
          );
        const existing: string[] = [];
        for (const row of rows) {
          const payload = JSON.parse(await cipher.decryptHealth(row.payload)) as {
            summary?: string;
          };
          if (payload.summary) existing.push(payload.summary);
        }
        const notes = repairedNotes(existing, fromAnswers);
        if (!notes) return false;
        if (dryRun) return true;
        for (const row of rows) {
          await tx
            .update(studentHealthRecords)
            .set({ status: 'RESOLVED', resolvedAt: new Date() })
            .where(eq(studentHealthRecords.id, row.id));
        }
        for (const summary of notes) {
          await tx.insert(studentHealthRecords).values({
            userId,
            kind: 'NOTES',
            payload: await cipher.encryptHealth(JSON.stringify({ summary })),
            origin: 'DECLARED',
          });
        }
        return true;
      });
      if (changed) repaired.push(userId);
    }
    print(
      `${dryRun ? '[dry-run] ' : ''}alunos conferidos: ${checked}; notas ${dryRun ? 'a consertar' : 'consertadas'}: ${repaired.length}`,
    );
    for (const userId of repaired) print(`  ${userId}`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
