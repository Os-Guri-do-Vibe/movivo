/**
 * Reprocessamento ad-hoc (2026-10-15: também regera protocolos PENDENTES de revisão que a IA
 * gerou sob regras antigas — ver as flags abaixo): corrige um protocolo que nasceu
 * `FALLBACK_TEMPLATE` porque a
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
 * Só escreve se: (a) o protocolo é `generatedBy = FALLBACK_TEMPLATE` — ou, com
 * `--incluir-protocolos-da-ia`, qualquer protocolo ainda não assinado; um protocolo que o
 * profissional já editou (`PROFESSIONAL_EDIT`) exige também
 * `--sobrescrever-edicao-profissional`, porque a regeração descarta a edição dele —,
 * (b) nunca foi assinado (`status = PENDING_SIGNATURE` / `approvalStatus = PENDING_REVIEW`),
 * e (c) a regeração real NÃO caiu no fallback de novo. Qualquer outra condição aborta sem
 * tocar o banco. As `constraints` gravadas passam a ser as COMPLETAS (com `daysPerWeek`),
 * para a assinatura validar contra a disponibilidade do aluno. Segue `PENDING_REVIEW` depois — precisa de assinatura CREF no painel como
 * qualquer outro protocolo, nunca entrega sozinho.
 *
 * Uso (NÃO rodar com `tsx` — mesmo motivo de `diagnose-protocol-fallback.ts`):
 *   cd apps/api
 *   pnpm run build
 *   node --enable-source-maps dist/scripts/reprocess-protocol-fallback.js <phoneNumberE164> \
 *     [--incluir-protocolos-da-ia] [--sobrescrever-edicao-profissional] [--manter-revisao-atual]
 *
 * Script descartável — investigação/correção pontual, não é feature permanente.
 */
import 'reflect-metadata';
import { createHash } from 'node:crypto';
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
import { QUEUE } from '../modules/jobs/jobs.config';
import { QueueManager } from '../modules/jobs/queue-manager.service';
import { ExerciseCatalogProvider } from '../modules/protocol/exercise-catalog-provider.service';
import {
  PROTOCOL_OPTIONAL_REVIEW_WINDOW_MS,
  reviewUrgencyForPlan,
} from '../modules/protocol/protocol-generation.worker';
import { MethodologyProvider } from '../modules/protocol/methodology-provider.service';
import { isProfessionalAuthored } from '../modules/protocol/protocol-origin';
import { planProtocol } from '../modules/protocol/protocol-planner';
import { ProtocolGeneratorService } from '../modules/protocol/protocol-generator.service';
import {
  emphasisToMuscleGroups,
  importantEventForPrompt,
  levelFromExperience,
  mapInjuriesToTags,
  painToConstraints,
  routineContextForPrompt,
  parqToConstraints,
  type UserConstraints,
} from '../modules/protocol/user-constraints';
import { ValidationService } from '../modules/protocol/validation/validation.service';

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
const INITIAL_MESOCYCLE_NUMBER = 1;

@Module({
  imports: [CoreModule, AiCoachModule],
  // `QueueManager` só PRODUZ jobs (nenhum Worker é registrado): o `ProtocolAutoReleaseWorker`
  // do `movivo-api` em execução é quem consome. Mesmo racional de `enqueue-protocol-auto-release.ts`.
  providers: [
    ProtocolGeneratorService,
    MethodologyProvider,
    ExerciseCatalogProvider,
    ValidationService,
    QueueManager,
  ],
})
class ReprocessModule {}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const phone = args.find((arg) => !arg.startsWith('--'));
  const includeAiProtocols = args.includes('--incluir-protocolos-da-ia');
  const overrideProfessionalEdit = args.includes('--sobrescrever-edicao-profissional');
  const keepCurrentReview = args.includes('--manter-revisao-atual');
  if (!phone) {
    console.error(
      'Uso: node dist/scripts/reprocess-protocol-fallback.js <phoneNumberE164> ' +
        '[--incluir-protocolos-da-ia] [--sobrescrever-edicao-profissional] [--manter-revisao-atual]',
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(ReprocessModule, { logger: false });
  try {
    const db = app.get(TenantDatabase);
    const cipher = app.get(HealthCipherService);
    const generator = app.get(ProtocolGeneratorService);
    const validation = app.get(ValidationService);
    const queues = app.get(QueueManager);

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
    if (protocolRow.generatedBy !== 'FALLBACK_TEMPLATE' && !includeAiProtocols) {
      console.error(
        `Protocolo ${protocolRow.id} não é FALLBACK_TEMPLATE (generatedBy=${protocolRow.generatedBy}) — nada a corrigir, abortando sem tocar o banco. ` +
          'Para regerar um protocolo da IA ainda pendente, use --incluir-protocolos-da-ia.',
      );
      process.exitCode = 1;
      return;
    }
    if (isProfessionalAuthored(protocolRow.generatedBy) && !overrideProfessionalEdit) {
      console.error(
        `Protocolo ${protocolRow.id} foi editado pelo profissional (${protocolRow.generatedBy}): a regeração descartaria a edição dele — abortando sem tocar o banco. ` +
          'Se for isso mesmo que se quer, use --sobrescrever-edicao-profissional.',
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
        `mesociclo=${protocolRow.mesocycleNumber} versao=${protocolRow.version} ` +
        `origem=${protocolRow.generatedBy} sha256-do-conteudo-atual=${createHash('sha256')
          .update(JSON.stringify(protocolRow.content))
          .digest('hex')}`,
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
    // Por padrão segue a regra da geração normal (PAR-Q ou fallback → obrigatória; reparo →
    // conforme `REPAIRED_PROTOCOL_REVIEW_URGENCY`). A flag operacional preserva a revisão que
    // já estava em curso: troca somente o conteúdo, não reinicia o relógio nem cria liberação.
    const reviewUrgency = keepCurrentReview
      ? protocolRow.reviewUrgency
      : reviewUrgencyForPlan(plan, constraints.requiresProfessionalReview);
    const reviewCreatedAt = keepCurrentReview ? protocolRow.createdAt : startDate;
    const mesocycleName = `Mesociclo ${protocolRow.mesocycleNumber}: ${
      TRAINING_PHASE_LABELS[plan.content.phase] ?? plan.content.phase
    }`;

    await db.runAsUser(userRow.id, 'USER', (tx) =>
      tx
        .update(protocols)
        .set({
          content: plan.content,
          // Constraints COMPLETAS (com `daysPerWeek`): é o que a assinatura revalida. No caminho
          // de DLQ elas ficaram na forma mínima do fallback.
          constraints: { ...constraints, contextualQuality: plan.contextualQuality },
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
          reviewUrgency,
          // `--manter-revisao-atual` conserva o marco que o painel já exibe. Sem a flag, o
          // conteúdo acabou de ser (re)gerado e a janela começa agora.
          createdAt: reviewCreatedAt,
          status: 'PENDING_SIGNATURE',
          approvalStatus: 'PENDING_REVIEW',
          humanReviewRequired: true,
        })
        .where(eq(protocols.id, protocolRow.id)),
    );

    // O worker de geração agenda este job em `persist()`; este script não passa por lá, e sem
    // ele o painel contaria 1h e nada dispararia (achado 2026-10-11). `MANDATORY` nunca agenda.
    if (!keepCurrentReview && reviewUrgency === 'OPTIONAL') {
      await queues.enqueue(
        QUEUE.protocolAutoRelease,
        'auto-release',
        { userId: userRow.id, protocolId: protocolRow.id },
        {
          delay: PROTOCOL_OPTIONAL_REVIEW_WINDOW_MS,
          // Id único: uma rodada anterior (ou o script avulso) pode ter deixado `auto-release-<id>`.
          jobId: `auto-release-${protocolRow.id}-reprocess-${Date.now()}`,
        },
      );
    }

    console.warn(
      `\nProtocolo ${protocolRow.id} atualizado com conteúdo individualizado real ` +
        `(${plan.generatedBy}/${plan.modelVersion}). ` +
        (keepCurrentReview
          ? `Mantém a revisão existente (${reviewUrgency}) e o prazo iniciado em ${reviewCreatedAt.toISOString()}; nenhuma auto-liberação foi agendada.`
          : reviewUrgency === 'OPTIONAL'
            ? 'Segue PENDING_REVIEW e dispara sozinho para o WhatsApp em 24h se ninguém agir no painel.'
            : 'Segue PENDING_REVIEW/OBRIGATÓRIA — precisa de assinatura CREF no painel (nunca sai sozinha).'),
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
    goal: toGenerationGoal(structured.primaryGoal),
    level,
    trainingStatus: structured.trainingStatus,
    ...(structured.stoppedFor ? { stoppedFor: structured.stoppedFor } : {}),
    daysPerWeek: structured.daysPerWeek,
    preferredDays: structured.preferredDays,
    sessionMinutes: SESSION_DURATION_MINUTES[structured.sessionDuration],
    location: structured.location,
    equipment: [],
    emphasis: emphasisToMuscleGroups(structured.emphasis),
    avoid: health.freeText?.avoidedExercise ? [health.freeText.avoidedExercise] : [],
    routineContext: routineContextForPrompt(structured, health.freeText),
    injuryTags: [...new Set([...pain.tags, ...mapInjuriesToTags(injuriesRaw), ...parq.tags])],
    // Mesma política de `constraintsFromAnamnesis`: dor sem veto é cautela; PAR-Q sempre veta.
    cautionTags: pain.cautionTags.filter((tag) => !parq.tags.includes(tag)),
    injuriesRaw,
    importantEvent: importantEventForPrompt(structured, health.freeText?.importantEventDescription),
  };
}

main().catch((error: unknown) => {
  console.error('[reprocess-protocol-fallback] falhou:', error);
  process.exitCode = 1;
});
