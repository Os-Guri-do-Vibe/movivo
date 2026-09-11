/**
 * Diagnóstico ad-hoc: reroda `planProtocol` (gera-e-valida) para um titular específico, com
 * os MESMOS `constraints` já persistidos no protocolo dele, para reproduzir e imprimir o
 * motivo exato de uma queda em FALLBACK_TEMPLATE — sem tocar a instância já rodando.
 *
 * Não sobe HTTP nem workers de fila (só os services puros de geração/validação), então não
 * compete com o processo real nem duplica efeito colateral nenhum (WhatsApp, check-ins etc).
 *
 * Uso (NÃO rodar com `tsx` — esbuild não emite `design:paramtypes` de forma confiável
 * pra alguns providers do grafo de DI aqui, o boot falha com `UndefinedDependencyException`
 * mesmo pra módulos que funcionam normalmente na app real; buildar com `tsc`/Nest resolve):
 *   cd apps/api
 *   pnpm run build
 *   node --enable-source-maps dist/scripts/diagnose-protocol-fallback.js <phoneNumberE164>
 *
 * Script descartável — não faz parte do pipeline de nenhuma sprint, é só investigação.
 */
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { eq } from 'drizzle-orm';

import { CoreModule } from '../core/core.module';
import { TenantDatabase } from '../core/database/tenant-database.service';
import { protocols, users } from '../core/database/schema';
import { AiCoachModule } from '../modules/ai-coach/ai-coach.module';
import { ExerciseCatalogProvider } from '../modules/protocol/exercise-catalog-provider.service';
import { MethodologyProvider } from '../modules/protocol/methodology-provider.service';
import { planProtocol } from '../modules/protocol/protocol-planner';
import { ProtocolGeneratorService } from '../modules/protocol/protocol-generator.service';
import type { UserConstraints } from '../modules/protocol/user-constraints';
import { ValidationService } from '../modules/protocol/validation/validation.service';

@Module({
  imports: [CoreModule, AiCoachModule],
  providers: [
    ProtocolGeneratorService,
    MethodologyProvider,
    ExerciseCatalogProvider,
    ValidationService,
  ],
})
class DiagnosticModule {}

async function main(): Promise<void> {
  const phone = process.argv[2];
  if (!phone) {
    console.error('Uso: tsx src/scripts/diagnose-protocol-fallback.ts <phoneNumberE164>');
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(DiagnosticModule, { logger: false });
  try {
    const db = app.get(TenantDatabase);
    const generator = app.get(ProtocolGeneratorService);
    const validation = app.get(ValidationService);

    const { userRow, protocolRow } = await db.runAsSystem(async (tx) => {
      const [userRow] = await tx.select().from(users).where(eq(users.phoneNumber, phone)).limit(1);
      if (!userRow) return { userRow: null, protocolRow: null };
      const [protocolRow] = await tx
        .select()
        .from(protocols)
        .where(eq(protocols.userId, userRow.id))
        .orderBy(protocols.version)
        .limit(1);
      return { userRow, protocolRow };
    });

    if (!userRow) {
      console.error(`Nenhum usuário com telefone ${phone}.`);
      process.exitCode = 1;
      return;
    }
    if (!protocolRow) {
      console.error(`Usuário ${userRow.id} não tem protocolo persistido — nada para reproduzir.`);
      process.exitCode = 1;
      return;
    }

    const constraints = protocolRow.constraints as UserConstraints;
    console.warn(`[diagnose] titular=${userRow.name ?? userRow.id} constraints=`, constraints);

    const plan = await planProtocol(generator, validation, {
      userId: userRow.id,
      user: { name: userRow.name, phoneNumber: userRow.phoneNumber, email: userRow.email },
      constraints,
    });

    console.warn('\n=== RESULTADO ===');
    console.warn('generatedBy:', plan.generatedBy);
    console.warn('usedFallbackTemplate:', plan.usedFallbackTemplate);
    console.warn('validationAction:', plan.validationAction);
    console.warn('violations:', JSON.stringify(plan.violations, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('[diagnose-protocol-fallback] falhou:', error);
  process.exitCode = 1;
});
