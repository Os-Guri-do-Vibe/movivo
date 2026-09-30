/**
 * Reprocessamento ad-hoc: corrige um protocolo que nasceu `FALLBACK_TEMPLATE` porque a
 * geração esgotou os retries do BullMQ (DLQ, `ProtocolGenerationWorker.handleTerminalFailure`)
 * enquanto os três provedores de LLM estavam bloqueados para dado `HEALTH` (ADR-005-R2,
 * flags fechadas de 2026-09-24 até 2026-09-25) — chama a geração real e SUBSTITUI o
 * `content` da MESMA linha (mesmo mesociclo/versão). Nunca cria mesociclo novo.
 *
 * Não confia em `protocols.constraints`: no caminho de DLQ ela é persistida como forma
 * MÍNIMA (`{goal, preferredDays, requiresProfessionalReview, parqTags, fallback:true}`,
 * ver `handleTerminalFailure`) — sem `level`/`location`/`injuryTags`/etc., regerar a
 * partir dela produziria outro protocolo genérico, não individualizado de verdade.
 * `loadFullConstraints()` reconstrói o `UserConstraints` completo a partir da anamnese
 * ORIGINAL, duplicando de propósito a lógica de `ProtocolGenerationWorker.load()` +
 * `toConstraints()` — não instancia o worker (evitaria registrar um segundo consumer
 * BullMQ na mesma fila, mesmo racional de `diagnose-protocol-fallback.ts`).
 *
 * Só escreve se: (a) o protocolo é `generatedBy = FALLBACK_TEMPLATE`, (b) nunca foi
 * assinado (`status = PENDING_SIGNATURE` / `approvalStatus = PENDING_REVIEW`), e (c) a
 * regeração real NÃO caiu no fallback de novo. Qualquer outra condição aborta sem tocar
 * o banco. Segue `PENDING_REVIEW` depois — precisa de assinatura CREF no painel como
 * qualquer outro protocolo, nunca entrega sozinho.
 *
 * Uso (NÃO rodar com `tsx` — mesmo motivo de `diagnose-protocol-fallback.ts`):
 *   cd apps/api
 *   pnpm run build
 *   node --enable-source-maps dist/scripts/reprocess-protocol-fallback.js <phoneNumberE164>
 *
 * Script descartável — investigação/correção pontual, não é feature permanente.
 */
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { eq, desc, and } from 'drizzle-orm';
import {
  anamnesisStructuredSchema,
  ParqState,
  SESSION_DURATION_MINUTES,
  TRAINING_PHASE_LABELS,
  toGenerationGoal,
} from '@movivo/shared';

import { CoreModule } from '../core/core.module';
import { HealthCipherService } from '../core/database/health-cipher.service';
import { TenantDatabase } from '../core/database/tenant-database.service';
import { anamnesisSessions, protocols, users } from '../core/database/schema';
import { AiCoachModule } from '../modules/ai-coach/ai-coach.module';
import { healthBlockSchema } from '../modules/anamnesis/health-block';
import { evaluateParq, type ParqEvaluation } from '../modules/anamnesis/parq';
import { ExerciseCatalogProvider } from '../modules/protocol/exercise-catalog-provider.service';
import { MethodologyProvider } from '../modules/protocol/methodology-provider.service';
import { planProtocol } from '../modules/protocol/protocol-planner';
import { ProtocolGeneratorService } from '../modules/protocol/protocol-generator.service';
import {
  demoteLevel,
  emphasisToMuscleGroups,
  importantEventForPrompt,
  levelFromExperience,
  mapInjuriesToTags,
  painToConstraints,
  parqToConstraints,
  type UserConstraints,
} from '../modules/protocol/user-constraints';
import { ValidationService } from '../modules/protocol/validation/validation.service';

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
const INITIAL_MESOCYCLE_NUMBER = 1;

@Module({
  imports: [CoreModule, AiCoachModule],
  providers: [
    ProtocolGeneratorService,
    MethodologyProvider,
    ExerciseCatalogProvider,
    ValidationService,
  ],
})
class ReprocessModule {}

async function main(): Promise<void> {
  const phone = process.argv[2];
  if (!phone) {
    console.error('Uso: node dist/scripts/reprocess-protocol-fallback.js <phoneNumberE164>');
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(ReprocessModule, { logger: false });
  try {
    const db = app.get(TenantDatabase);
    const cipher = app.get(HealthCipherService);
    const generator = app.get(ProtocolGeneratorService);
    const validation = app.get(ValidationService);

    const { userRow, protocolRow } = await db.runAsSystem(async (tx) => {
      const [userRow] = await tx.select().from(users).where(eq(users.phoneNumber, phone)).limit(1);
      if (!userRow) return { userRow: null, protocolRow: null };
      const [protocolRow] = await tx
        .select()
        .from(protocols)
        .where(
          and(
            eq(protocols.userId, userRow.id),
            eq(protocols.mesocycleNumber, INITIAL_MESOCYCLE_NUMBER),
          ),
        )
        .orderBy(desc(protocols.version))
        .limit(1);
      return { userRow, protocolRow };
    });

    if (!userRow) {
      console.error(`Nenhum usuário com telefone ${phone}.`);
      process.exitCode = 1;
      return;
    }
    if (!protocolRow) {
      console.error(`Usuário ${userRow.id} não tem protocolo (mesociclo 1) persistido.`);
      process.exitCode = 1;
      return;
    }
    if (protocolRow.generatedBy !== 'FALLBACK_TEMPLATE') {
      console.error(
        `Protocolo ${protocolRow.id} não é FALLBACK_TEMPLATE (generatedBy=${protocolRow.generatedBy}) — nada a corrigir, abortando sem tocar o banco.`,
      );
      process.exitCode = 1;
      return;
    }
    if (
      protocolRow.status !== 'PENDING_SIGNATURE' ||
      protocolRow.approvalStatus !== 'PENDING_REVIEW'
    ) {
      console.error(
        `Protocolo ${protocolRow.id} já saiu de PENDING_SIGNATURE/PENDING_REVIEW ` +
          `(status=${protocolRow.status}, approvalStatus=${protocolRow.approvalStatus}) — abortando sem tocar o banco.`,
      );
      process.exitCode = 1;
      return;
    }
    if (!protocolRow.anamnesisSessionId) {
      console.error(
        `Protocolo ${protocolRow.id} sem anamnesisSessionId — não dá pra reconstruir constraints completas.`,
      );
      process.exitCode = 1;
      return;
    }

    console.warn(
      `[reprocess] titular=${userRow.name ?? userRow.id} protocolo=${protocolRow.id} ` +
        `mesociclo=${protocolRow.mesocycleNumber} versao=${protocolRow.version}`,
    );

    const constraints = await loadFullConstraints(
      db,
      cipher,
      userRow.id,
      protocolRow.anamnesisSessionId,
    );
    const scrubUser = {
      name: userRow.name,
      phoneNumber: userRow.phoneNumber,
      email: userRow.email,
    };

    const plan = await planProtocol(generator, validation, {
      userId: userRow.id,
      user: scrubUser,
      constraints,
    });

    console.warn('\n=== RESULTADO DA REGERAÇÃO ===');
    console.warn('generatedBy:', plan.generatedBy);
    console.warn('model:', plan.modelVersion);
    console.warn('usedFallbackTemplate:', plan.usedFallbackTemplate);
    console.warn('validationAction:', plan.validationAction);
    console.warn('violations:', JSON.stringify(plan.violations, null, 2));

    if (plan.usedFallbackTemplate) {
      console.error(
        '\nRegeração caiu no fallback de novo — NÃO gravando nada, protocolo permanece como estava.',
      );
      process.exitCode = 1;
      return;
    }

    const totalWeeks = plan.content.phaseDurationWeeks;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + totalWeeks * MS_PER_WEEK);
    const mandatory = constraints.requiresProfessionalReview;
    const mesocycleName = `Mesociclo ${protocolRow.mesocycleNumber}: ${
      TRAINING_PHASE_LABELS[plan.content.phase] ?? plan.content.phase
    }`;

    await db.runAsUser(userRow.id, 'USER', (tx) =>
      tx
        .update(protocols)
        .set({
          content: plan.content,
          totalWeeks,
          mesocycleName,
          startDate,
          endDate,
          generatedBy: plan.generatedBy,
          modelVersion: plan.modelVersion,
          promptVersion: plan.promptVersion,
          knowledgeSources: plan.knowledgeSources,
          methodologyVersionId: plan.methodologyVersionId,
          methodologySha256: plan.methodologySha256,
          reviewUrgency: mandatory ? 'MANDATORY' : 'OPTIONAL',
          status: 'PENDING_SIGNATURE',
          approvalStatus: 'PENDING_REVIEW',
          humanReviewRequired: true,
        })
        .where(eq(protocols.id, protocolRow.id)),
    );

    console.warn(
      `\nProtocolo ${protocolRow.id} atualizado com conteúdo individualizado real ` +
        `(${plan.generatedBy}/${plan.modelVersion}). Segue PENDING_REVIEW — precisa de assinatura CREF no painel.`,
    );
  } finally {
    await app.close();
  }
}

/**
 * Mesma lógica de `ProtocolGenerationWorker.load()` + `toConstraints()` — duplicada aqui
 * de propósito (script descartável) para não instanciar o worker real.
 */
async function loadFullConstraints(
  db: TenantDatabase,
  cipher: HealthCipherService,
  userId: string,
  anamnesisSessionId: string,
): Promise<UserConstraints> {
  const ctx = await db.runAsUser(userId, 'USER', async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new Error(`Usuário ${userId} sumiu entre a leitura e a reconstrução.`);
    const [session] = await tx
      .select()
      .from(anamnesisSessions)
      .where(eq(anamnesisSessions.id, anamnesisSessionId))
      .limit(1);
    if (!session?.dataBlock2 || !session.dataBlock3) {
      throw new Error(
        `Sessão de anamnese ${anamnesisSessionId} sem dataBlock2/3 — não dá pra reconstruir.`,
      );
    }
    const health = healthBlockSchema.parse(
      JSON.parse(await cipher.decryptHealth(session.dataBlock2)),
    );
    const structured = anamnesisStructuredSchema.parse(session.dataBlock3);
    return { requiresProfessionalReview: user.requiresProfessionalReview, health, structured };
  });

  const { structured, health } = ctx;
  const pain = painToConstraints(health.pain);
  const injuriesRaw = pain.raw;
  const parqAnswers = health.parq?.answers ?? [];
  const evaluation: ParqEvaluation = health.parq
    ? evaluateParq({ parq: health.parq })
    : { parqState: ParqState.LIBERADO, requiresProfessionalReview: false, triggeredQuestions: [] };
  const parq = parqToConstraints(evaluation, parqAnswers);
  const requiresProfessionalReview = ctx.requiresProfessionalReview;
  const level = levelFromExperience(structured.experience);

  return {
    requiresProfessionalReview,
    parqTags: parq.tags,
    parqTriggered: evaluation.triggeredQuestions,
    ...(requiresProfessionalReview ? { maxPhase: 'ADAPTACAO' as const } : {}),
    goal: toGenerationGoal(structured.primaryGoal),
    level: requiresProfessionalReview ? demoteLevel(level) : level,
    trainingStatus: structured.trainingStatus,
    ...(structured.stoppedFor ? { stoppedFor: structured.stoppedFor } : {}),
    daysPerWeek: structured.daysPerWeek,
    preferredDays: structured.preferredDays,
    sessionMinutes: SESSION_DURATION_MINUTES[structured.sessionDuration],
    location: structured.location,
    equipment: [],
    emphasis: emphasisToMuscleGroups(structured.emphasis),
    avoid: health.freeText?.avoidedExercise ? [health.freeText.avoidedExercise] : [],
    injuryTags: [...new Set([...pain.tags, ...mapInjuriesToTags(injuriesRaw), ...parq.tags])],
    injuriesRaw,
    importantEvent: importantEventForPrompt(structured, health.freeText?.importantEventDescription),
  };
}

main().catch((error: unknown) => {
  console.error('[reprocess-protocol-fallback] falhou:', error);
  process.exitCode = 1;
});
