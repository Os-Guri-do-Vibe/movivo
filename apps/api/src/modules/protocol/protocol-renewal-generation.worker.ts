/**
 * `ProtocolRenewalGenerationWorker` — gera o PRÓXIMO mesociclo a partir do formulário de
 * troca de protocolo por fim de mesociclo.
 *
 * Fila própria (`QUEUE.protocolRenewalGeneration`, não um branch de
 * `ProtocolGenerationWorker`) porque a origem é uma sessão de renovação
 * (`renewalSessionId`), não uma sessão de anamnese completa — o `load()` é diferente.
 * Reaproveita, sem alterar contratos, o mesmo pipeline gera-e-valida da geração inicial:
 * `planProtocol()` (`protocol-planner.ts`), `ProtocolGeneratorService`, `ValidationService`
 * e `ProtocolRepository.persist()`.
 *
 * Decisão do fundador (não é máquina de estados): a fase do novo mesociclo continua
 * sendo decidida pela IA, agora informada pelo histórico do mesociclo anterior + pelo
 * relato do aluno nos Blocos 1/2/4 do formulário (`UserConstraints.continuation`, ver
 * `protocol-generator.service.ts::buildUserMessage`). O único teto determinístico é
 * `maxPhase`/`requiresProfessionalReview`, reaproveitado sem mudança — reacionado pela
 * pergunta 10 (repescagem do PAR-Q), exatamente como o PAR-Q inicial trava a geração.
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import {
  PROTOCOL_RENEWAL_STEP_SCHEMAS,
  SESSION_DURATION_MINUTES,
  toGenerationGoal,
  type PainAssessment,
  type ProtocolRenewalBlock1,
  type ProtocolRenewalBlock2,
  type ProtocolRenewalBlock3,
  type ProtocolRenewalBlock4,
  type ProtocolRenewalBlock5,
  type ProtocolStructure,
} from '@movivo/shared';

import { HealthCipherService } from '../../core/database/health-cipher.service';
import { HealthConsentService } from '../../core/database/health-consent.service';
import { protocolRenewalSessions, protocols, users } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
import { isFinalFailure } from '../jobs/dlq.handler';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkerFactory } from '../jobs/worker.factory';
import { evaluateRenewalSafety } from '../protocol-renewal/protocol-renewal-safety';
import { ProtocolGeneratorService } from './protocol-generator.service';
import { PROTOCOL_OPTIONAL_REVIEW_WINDOW_MS } from './protocol-generation.worker';
import { planProtocol } from './protocol-planner';
import { ProtocolRepository } from './protocol.repository';
import {
  demoteLevel,
  importantEventForPrompt,
  mapInjuriesToTags,
  painToConstraints,
  type UserConstraints,
} from './user-constraints';
import { buildFallbackProtocol, FALLBACK_TEMPLATE_VERSION } from './validation/fallback-template';
import { ValidationService } from './validation/validation.service';

/** Payload do job — só UUIDs, o dado sensível é carregado sob RLS aqui (mesmo racional de `ProtocolGenerationJob`). */
export interface ProtocolRenewalGenerationJob {
  userId: string;
  renewalSessionId: string;
  submittedAt?: string;
}

@Injectable()
export class ProtocolRenewalGenerationWorker implements OnModuleInit {
  constructor(
    private readonly workers: WorkerFactory,
    private readonly queues: QueueManager,
    private readonly db: TenantDatabase,
    private readonly healthConsent: HealthConsentService,
    private readonly cipher: HealthCipherService,
    private readonly generator: ProtocolGeneratorService,
    private readonly validation: ValidationService,
    private readonly repository: ProtocolRepository,
    private readonly queueEvents: DashboardQueueEventsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ProtocolRenewalGenerationWorker.name);
  }

  onModuleInit(): void {
    const worker = this.workers.create<ProtocolRenewalGenerationJob>(
      QUEUE.protocolRenewalGeneration,
      (job) => this.process(job),
    );
    worker.on('failed', (job, err) => {
      if (job && isFinalFailure(job)) {
        void this.handleTerminalFailure(job as Job<ProtocolRenewalGenerationJob>, err).catch(
          (fallbackErr: unknown) => {
            this.logger.error(
              { jobId: job.id, err: fallbackErr },
              'fallback de DLQ da renovação de mesociclo falhou',
            );
          },
        );
      }
    });
  }

  async process(job: Job<ProtocolRenewalGenerationJob>): Promise<{ status: string }> {
    const { userId, renewalSessionId } = job.data;

    if (!(await this.healthConsent.hasActiveForUser(userId))) {
      this.logger.info(
        { event: 'protocol_renewal_generation_discarded_no_consent', userId },
        'renovação encerrada após revogação de consentimento',
      );
      return { status: 'CONSENT_REVOKED' };
    }

    // Idempotência: um job retentado depois de já ter persistido não gera/chama o LLM de
    // novo. Escopado por `renewalSessionId` (não por `existsForUser`, que é exclusiva da
    // geração INICIAL — ver `ProtocolRepository.existsForUser`).
    if (await this.alreadyGenerated(userId, renewalSessionId)) {
      this.logger.info({ userId, renewalSessionId }, 'renovação já gerada — job idempotente');
      return { status: 'ALREADY_EXISTS' };
    }

    const loaded = await this.load(userId, renewalSessionId);
    if (!loaded) {
      this.logger.warn({ userId, renewalSessionId }, 'usuário/sessão de renovação não encontrados');
      return { status: 'NOT_FOUND' };
    }

    const constraints = this.toConstraints(loaded);
    const scrubUser = { name: loaded.name, phoneNumber: loaded.phoneNumber, email: loaded.email };

    const plan = await planProtocol(this.generator, this.validation, {
      userId,
      user: scrubUser,
      constraints,
    });
    const totalWeeks = plan.content.phaseDurationWeeks;

    if (plan.violations.length > 0) {
      this.logger.warn(
        {
          userId,
          renewalSessionId,
          usedFallbackTemplate: plan.usedFallbackTemplate,
          validationAction: plan.validationAction,
          violations: plan.violations,
        },
        'geração de renovação de mesociclo não passou limpa na validação',
      );
    }

    // Mesmo critério da geração inicial (`ProtocolGenerationWorker`): PAR-Q bloqueado
    // (aqui, a pergunta 10) OU conteúdo caiu no fallback → `MANDATORY`, nunca auto-libera.
    const mandatory = constraints.requiresProfessionalReview || plan.usedFallbackTemplate;
    const persisted = await this.repository.persist({
      userId,
      content: plan.content,
      constraints,
      parqFlags: constraints.parqTags,
      approvalStatus: 'PENDING_REVIEW',
      status: 'PENDING_SIGNATURE',
      humanReviewRequired: true,
      reviewUrgency: mandatory ? 'MANDATORY' : 'OPTIONAL',
      anamnesisSessionId: null,
      renewalSessionId,
      totalWeeks,
      generatedBy: plan.generatedBy,
      modelVersion: plan.modelVersion,
      promptVersion: plan.promptVersion,
      knowledgeSources: plan.knowledgeSources,
      methodologyVersionId: plan.methodologyVersionId,
      methodologySha256: plan.methodologySha256,
      signed: false,
    });

    if (persisted.alreadyExisted) {
      this.logger.info({ userId, renewalSessionId }, 'corrida de persistência — renovação já existia');
      return { status: 'ALREADY_EXISTS' };
    }

    if (!mandatory) {
      await this.queues.enqueue(
        QUEUE.protocolAutoRelease,
        'auto-release',
        { userId, protocolId: persisted.protocolId },
        {
          delay: PROTOCOL_OPTIONAL_REVIEW_WINDOW_MS,
          jobId: `auto-release-${persisted.protocolId}`,
        },
      );
    }

    this.logger.info(
      {
        userId,
        renewalSessionId,
        protocolId: persisted.protocolId,
        reviewUrgency: mandatory ? 'MANDATORY' : 'OPTIONAL',
      },
      mandatory
        ? 'renovação PENDING_REVIEW/MANDATORY — só sai por assinatura humana CREF'
        : 'renovação PENDING_REVIEW — aguarda painel CREF ou auto-liberação em 1h',
    );
    this.queueEvents.emit('protocol');
    return { status: 'PENDING_REVIEW' };
  }

  private async alreadyGenerated(userId: string, renewalSessionId: string): Promise<boolean> {
    const rows = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({ id: protocols.id })
        .from(protocols)
        .where(eq(protocols.renewalSessionId, renewalSessionId))
        .limit(1),
    );
    return rows.length > 0;
  }

  // --- carregamento sob RLS -------------------------------------------------

  private async load(userId: string, renewalSessionId: string): Promise<LoadedRenewalContext | null> {
    return this.db.runAsUser(userId, 'USER', async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) return null;

      const [session] = await tx
        .select()
        .from(protocolRenewalSessions)
        .where(eq(protocolRenewalSessions.id, renewalSessionId))
        .limit(1);
      if (
        !session ||
        !session.dataBlock1 ||
        !session.dataBlock2 ||
        !session.dataBlock3 ||
        !session.dataBlock4 ||
        !session.dataBlock5
      ) {
        return null;
      }

      const [previous] = await tx
        .select({
          content: protocols.content,
          constraints: protocols.constraints,
          totalWeeks: protocols.totalWeeks,
          mesocycleNumber: protocols.mesocycleNumber,
        })
        .from(protocols)
        .where(eq(protocols.id, session.previousProtocolId))
        .limit(1);
      if (!previous) return null;

      const block1 = PROTOCOL_RENEWAL_STEP_SCHEMAS[1].parse(session.dataBlock1);
      const block2 = PROTOCOL_RENEWAL_STEP_SCHEMAS[2].parse(session.dataBlock2);
      const block3 = PROTOCOL_RENEWAL_STEP_SCHEMAS[3].parse(
        JSON.parse(await this.cipher.decryptHealth(session.dataBlock3)),
      );
      const block4 = PROTOCOL_RENEWAL_STEP_SCHEMAS[4].parse(session.dataBlock4);
      const block5 = PROTOCOL_RENEWAL_STEP_SCHEMAS[5].parse(session.dataBlock5);

      return {
        name: user.name,
        phoneNumber: user.phoneNumber,
        email: user.email,
        previousContent: previous.content as ProtocolStructure,
        previousConstraints: previous.constraints as UserConstraints,
        previousTotalWeeks: previous.totalWeeks,
        previousMesocycleNumber: previous.mesocycleNumber,
        block1,
        block2,
        block3,
        block4,
        block5,
      };
    });
  }

  /**
   * Formulário de renovação → constraints do gerador. Ponto de partida é o snapshot de
   * `UserConstraints` do mesociclo ANTERIOR (todo protocolo persiste sua própria
   * `constraints` completa — ver `ProtocolRepository.persist()`), sobrescrito só pelo que
   * o Bloco 5 declarou como mudança. Preferência (`avoid`) nunca reabilita algo que
   * segurança (`injuryTags`) tirou — mesmo princípio inegociável de `ProtocolGenerationWorker`.
   */
  private toConstraints(ctx: LoadedRenewalContext): UserConstraints {
    const base = this.sanitizeBaseConstraints(ctx.previousConstraints);
    const { block1, block2, block3, block4, block5 } = ctx;
    const safety = evaluateRenewalSafety(block3);

    const newPainAssessment: PainAssessment = block3.newPain.hasNewPain
      ? {
          hasPain: true,
          points: [
            {
              region: block3.newPain.region!,
              intensity: block3.newPain.intensity!,
              ...(block3.newPain.regionOther ? { regionOther: block3.newPain.regionOther } : {}),
            },
          ],
          trend: block3.newPain.trend,
          hasProfessionalExplanation: false,
          underMedicalFollowUp: false,
          hasAvoidanceRecommendation: false,
        }
      : {
          hasPain: false,
          points: [],
          hasProfessionalExplanation: false,
          underMedicalFollowUp: false,
          hasAvoidanceRecommendation: false,
        };
    const newPain = painToConstraints(newPainAssessment);
    const parqRecheckTags = block3.parqRecheck.detail
      ? mapInjuriesToTags([block3.parqRecheck.detail])
      : [];

    const level = safety.requiresProfessionalReview ? demoteLevel(base.level) : base.level;
    const location = block5.changes.includes('TRAINING_LOCATION') && block5.location
      ? block5.location
      : base.location;
    const daysPerWeek = block5.changes.includes('DAYS_PER_WEEK') && block5.daysPerWeek
      ? block5.daysPerWeek
      : base.daysPerWeek;
    const preferredDays = block5.preferredDays.length ? block5.preferredDays : base.preferredDays;
    const sessionMinutes =
      block5.changes.includes('SESSION_DURATION') && block5.sessionDuration
        ? SESSION_DURATION_MINUTES[block5.sessionDuration]
        : base.sessionMinutes;
    const goal = block5.goalChange.changed && block5.goalChange.newGoal
      ? toGenerationGoal(block5.goalChange.newGoal)
      : base.goal;
    const avoid = block5.dislikedExercise.has && block5.dislikedExercise.description
      ? [...base.avoid, block5.dislikedExercise.description]
      : base.avoid;

    const importantEvent = this.resolveImportantEvent(base, block5);

    return {
      ...base,
      goal,
      level,
      // O aluno acabou de concluir um mesociclo ativo — nunca "nunca treinou"/"parado"; a
      // única leitura que o Bloco 1 permite é regular vs. irregular na prática.
      trainingStatus: this.renewalTrainingStatus(block1),
      stoppedFor: undefined,
      daysPerWeek,
      preferredDays,
      sessionMinutes,
      location,
      avoid,
      injuryTags: [...new Set([...base.injuryTags, ...newPain.tags, ...parqRecheckTags])],
      injuriesRaw: [...base.injuriesRaw, ...newPain.raw],
      requiresProfessionalReview: safety.requiresProfessionalReview,
      parqTags: safety.requiresProfessionalReview ? [...new Set([...base.parqTags, ...parqRecheckTags])] : [],
      parqTriggered: base.parqTriggered,
      ...(safety.requiresProfessionalReview ? { maxPhase: 'ADAPTACAO' as const } : {}),
      importantEvent,
      continuation: {
        previousMesocycleNumber: ctx.previousMesocycleNumber,
        previousPhase: ctx.previousContent.phase,
        previousPhaseDurationWeeks: ctx.previousTotalWeeks,
        summary: this.buildContinuationSummary(block1, block2, block4, block5),
      },
    };
  }

  /**
   * O protocolo ANTERIOR pode ter nascido do template de fallback (`buildFallbackProtocol`,
   * `handleTerminalFailure`/`protocol-planner.ts`), cuja `constraints` persistida é uma
   * forma MÍNIMA (`{ goal, preferredDays, requiresProfessionalReview, parqTags, fallback }`)
   * — não o `UserConstraints` completo. Sem este saneamento, espalhar `base.injuryTags`/
   * `base.avoid` (undefined nesse caso) quebraria em runtime. Todo campo que a forma
   * mínima não garante recebe aqui um default seguro.
   */
  private sanitizeBaseConstraints(base: UserConstraints): UserConstraints {
    return {
      ...base,
      level: base.level ?? 'INICIANTE',
      trainingStatus: base.trainingStatus ?? 'REGULAR',
      daysPerWeek: base.daysPerWeek ?? base.preferredDays?.length ?? 3,
      preferredDays: base.preferredDays ?? [],
      location: base.location ?? 'HOME',
      equipment: base.equipment ?? [],
      emphasis: base.emphasis ?? [],
      avoid: base.avoid ?? [],
      injuryTags: base.injuryTags ?? [],
      injuriesRaw: base.injuriesRaw ?? [],
      parqTags: base.parqTags ?? [],
      parqTriggered: base.parqTriggered ?? [],
    };
  }

  private resolveImportantEvent(
    base: UserConstraints,
    block5: ProtocolRenewalBlock5,
  ): UserConstraints['importantEvent'] {
    if (!block5.targetEvent) return base.importantEvent;
    if (block5.targetEvent.status === 'NO_LONGER_APPLIES') return undefined;
    const date =
      block5.targetEvent.status === 'DATE_CHANGED' && block5.targetEvent.newDate
        ? block5.targetEvent.newDate
        : base.importantEvent?.date;
    if (!date) return undefined;
    return importantEventForPrompt(
      { hasImportantEvent: true, importantEventDate: date },
      base.importantEvent?.description,
    );
  }

  private renewalTrainingStatus(block1: ProtocolRenewalBlock1): UserConstraints['trainingStatus'] {
    const lowAdherence =
      block1.completionRate === 'RARAMENTE' ||
      block1.actualFrequency === 'TREINEI_BEM_MENOS' ||
      block1.actualFrequency === 'FALTARAM_2_OU_MAIS_NA_MAIORIA';
    return lowAdherence ? 'OCCASIONAL' : 'REGULAR';
  }

  /** Narrativa em PT-BR das respostas de desempenho/fadiga/resultado — DADO, nunca instrução. */
  private buildContinuationSummary(
    block1: ProtocolRenewalBlock1,
    block2: ProtocolRenewalBlock2,
    block4: ProtocolRenewalBlock4,
    block5: ProtocolRenewalBlock5,
  ): string {
    const lines = [
      `Conseguiu completar séries/repetições planejadas: ${block1.completionRate}.`,
      `Frequência real de treino: ${block1.actualFrequency}.`,
      `Evolução de carga/repetições nos exercícios principais: ${block1.loadProgression}.`,
      `Esforço percebido ao fim das séries de trabalho: ${block1.perceivedEffort}.`,
      `Fadiga acumulada: ${block2.fatigueLevel}. Sono: ${block2.sleepQuality}. Estresse fora do treino: ${block2.stressLevel}.`,
      `Dor muscular pós-treino comparada ao habitual: ${block2.muscleSoreness}.`,
      `Evolução percebida em relação ao objetivo: ${block4.goalProgress}. Satisfação (0-10): ${block4.satisfaction}.`,
    ];
    if (block4.currentWeightKg) lines.push(`Peso atual informado: ${block4.currentWeightKg}kg.`);
    if (block5.barriers.length) {
      lines.push(`Dificuldades relatadas para este novo ciclo: ${block5.barriers.join(', ')}.`);
    }
    return lines.join('\n');
  }

  /** TASK equivalente ao fallback de DLQ da geração inicial — template conservador, sempre MANDATORY. */
  private async handleTerminalFailure(
    job: Job<ProtocolRenewalGenerationJob>,
    err: Error,
  ): Promise<void> {
    const { userId, renewalSessionId } = job.data;
    this.logger.error(
      { userId, renewalSessionId, jobId: job.id, err: err.message, event: 'protocol_renewal_generation_dlq' },
      'renovação de mesociclo esgotou os retries — acionando fallback',
    );
    try {
      const loaded = await this.load(userId, renewalSessionId);
      const constraints = loaded ? this.toConstraints(loaded) : null;
      const goal = constraints?.goal ?? 'CONDITIONING';
      const preferredDays = constraints?.preferredDays ?? [];
      const requiresProfessionalReview = constraints?.requiresProfessionalReview ?? true;
      const parqTags = constraints?.parqTags ?? [];
      const content = buildFallbackProtocol(goal, preferredDays);
      const persisted = await this.repository.persist({
        userId,
        content,
        constraints: { goal, preferredDays, requiresProfessionalReview, parqTags, fallback: true },
        parqFlags: parqTags,
        approvalStatus: 'PENDING_REVIEW',
        status: 'PENDING_SIGNATURE',
        humanReviewRequired: true,
        reviewUrgency: 'MANDATORY',
        anamnesisSessionId: null,
        renewalSessionId,
        totalWeeks: content.phaseDurationWeeks,
        generatedBy: 'FALLBACK_TEMPLATE',
        modelVersion: null,
        promptVersion: FALLBACK_TEMPLATE_VERSION,
        signed: false,
      });
      if (!persisted.alreadyExisted) this.queueEvents.emit('protocol');
    } catch (persistErr) {
      this.logger.error(
        { userId, renewalSessionId, err: persistErr },
        'fallback de renovação: falha ao persistir template pendente',
      );
    }
  }
}

interface LoadedRenewalContext {
  name: string | null;
  phoneNumber: string;
  email: string | null;
  previousContent: ProtocolStructure;
  previousConstraints: UserConstraints;
  previousTotalWeeks: number;
  previousMesocycleNumber: number;
  block1: ProtocolRenewalBlock1;
  block2: ProtocolRenewalBlock2;
  block3: ProtocolRenewalBlock3;
  block4: ProtocolRenewalBlock4;
  block5: ProtocolRenewalBlock5;
}
