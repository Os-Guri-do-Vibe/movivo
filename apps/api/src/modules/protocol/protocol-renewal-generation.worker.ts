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
import { and, desc, eq, isNotNull, lt } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import {
  anamnesisStructuredSchema,
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
import {
  anamnesisSessions,
  protocolRenewalSessions,
  protocols,
  users,
} from '../../core/database/schema';
import {
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database/tenant-database.service';
import { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
import { isFinalFailure } from '../jobs/dlq.handler';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkerFactory } from '../jobs/worker.factory';
import { healthBlockSchema } from '../anamnesis/health-block';
import { evaluateRenewalSafety } from '../protocol-renewal/protocol-renewal-safety';
import type { ContraindicationTag } from './exercise-catalog';
import {
  buildCareerDigestLine,
  computeMesocycleSummary,
  formatExecutionDigest,
  formatPeriodizationLedger,
  persistMesocycleSummary,
  readMesocycleNotes,
  PERIODIZATION_LEDGER_WINDOW,
  type MesocycleSummary,
} from './mesocycle-summary';
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
      this.logger.info(
        { userId, renewalSessionId },
        'corrida de persistência — renovação já existia',
      );
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

  private async load(
    userId: string,
    renewalSessionId: string,
  ): Promise<LoadedRenewalContext | null> {
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
          id: protocols.id,
          content: protocols.content,
          constraints: protocols.constraints,
          totalWeeks: protocols.totalWeeks,
          mesocycleNumber: protocols.mesocycleNumber,
          mesocycleSummary: protocols.mesocycleSummary,
          mesocycleNotesCipher: protocols.mesocycleNotesCipher,
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

      const { periodizationLedger, executionDigest } = await this.loadLongitudinalContext(
        tx,
        userId,
        previous,
      );
      const anamnesis = await this.loadAnamnesisInvariants(tx, userId);

      return {
        name: user.name,
        phoneNumber: user.phoneNumber,
        email: user.email,
        previousContent: previous.content as ProtocolStructure,
        previousConstraints: previous.constraints as UserConstraints,
        previousTotalWeeks: previous.totalWeeks,
        previousMesocycleNumber: previous.mesocycleNumber,
        periodizationLedger,
        executionDigest,
        anamnesisInvariants: anamnesis?.text,
        anamnesisInjuryTags: anamnesis?.injuryTags ?? [],
        block1,
        block2,
        block3,
        block4,
        block5,
      };
    });
  }

  /**
   * ADR-008 Camadas 1+2 — ficha de periodização (todos os mesociclos, tamanho fixo) e
   * digest de execução do mesociclo que acabou de fechar. Se o resumo do mesociclo
   * anterior ainda for `NULL` (rollup do fechamento falhou, ou protocolo anterior a esta
   * feature), computa sob demanda — best-effort, nunca bloqueia a renovação (ADR-008 §Riscos).
   */
  private async loadLongitudinalContext(
    tx: TenantTransaction,
    userId: string,
    previous: {
      id: string;
      mesocycleNumber: number;
      mesocycleSummary: unknown;
      mesocycleNotesCipher: Buffer | null;
    },
  ): Promise<{ periodizationLedger?: string; executionDigest?: string }> {
    let currentSummary = previous.mesocycleSummary as MesocycleSummary | null;
    let currentNotesCipher = previous.mesocycleNotesCipher;

    if (!currentSummary) {
      try {
        const computed = await computeMesocycleSummary(tx, this.cipher, userId, previous.id);
        if (computed) {
          await persistMesocycleSummary(tx, previous.id, computed);
          currentSummary = computed.summary;
          currentNotesCipher = computed.notesCipher;
        }
      } catch (err) {
        this.logger.warn(
          { err, userId, protocolId: previous.id },
          'ADR-008: cálculo sob demanda do mesocycle_summary falhou — renovação segue sem periodização/digest',
        );
      }
    }
    if (!currentSummary) return {};

    const notes = await readMesocycleNotes(this.cipher, currentNotesCipher);
    const executionDigest = formatExecutionDigest(currentSummary, notes);

    const olderRows = await tx
      .select({ mesocycleSummary: protocols.mesocycleSummary })
      .from(protocols)
      .where(
        and(
          eq(protocols.userId, userId),
          isNotNull(protocols.mesocycleSummary),
          lt(protocols.mesocycleNumber, previous.mesocycleNumber),
        ),
      )
      .orderBy(desc(protocols.mesocycleNumber));
    const olderSummaries = olderRows.map((r) => r.mesocycleSummary as MesocycleSummary);

    // Janela = o ciclo que acabou de fechar + até (WINDOW-1) anteriores a ele, do mais
    // antigo pro mais recente ("mais recente por último", texto do prompt).
    const windowOlderDesc = olderSummaries.slice(0, PERIODIZATION_LEDGER_WINDOW - 1);
    const beyondWindow = olderSummaries.slice(PERIODIZATION_LEDGER_WINDOW - 1);
    const recentLedgerLines = [
      ...[...windowOlderDesc].reverse().map((s) => s.ledgerLine),
      currentSummary.ledgerLine,
    ];
    const periodizationLedger = formatPeriodizationLedger(
      recentLedgerLines,
      buildCareerDigestLine(beyondWindow),
    );

    return { periodizationLedger, executionDigest };
  }

  /**
   * ADR-008 Camada 3 — invariantes da anamnese de cadastro original, lidos de novo a cada
   * renovação (nunca cacheados — leitura de 1x a cada ~6 semanas, ver ADR-008 §3.1).
   * Também devolve as `injuryTags` originais para a RECONCILIAÇÃO em `toConstraints()`:
   * segurança nunca é rebaixada por uma cascata de `constraints` que perdeu uma tag num
   * fallback no meio do caminho — a união com a raiz é sempre conservadora.
   */
  private async loadAnamnesisInvariants(
    tx: TenantTransaction,
    userId: string,
  ): Promise<{ text?: string; injuryTags: ContraindicationTag[] } | null> {
    const [row] = await tx
      .select({
        dataBlock2: anamnesisSessions.dataBlock2,
        dataBlock3: anamnesisSessions.dataBlock3,
      })
      .from(anamnesisSessions)
      .where(and(eq(anamnesisSessions.userId, userId), eq(anamnesisSessions.status, 'SUBMITTED')))
      .orderBy(desc(anamnesisSessions.submittedAt))
      .limit(1);
    if (!row?.dataBlock2 || !row.dataBlock3) return null;

    const health = healthBlockSchema.parse(
      JSON.parse(await this.cipher.decryptHealth(row.dataBlock2)),
    );
    const structured = anamnesisStructuredSchema.parse(row.dataBlock3);
    const pain = painToConstraints(health.pain);

    const lines: string[] = [
      `Experiência declarada no cadastro original: ${structured.experience}.`,
    ];
    if (pain.raw.length) {
      lines.push(`Histórico de lesão/dor relatado no cadastro original: ${pain.raw.join('; ')}.`);
    }
    const freeText = health.freeText;
    if (freeText?.primaryGoalOther) {
      lines.push(`Objetivo original descrito como "Outro": ${freeText.primaryGoalOther}.`);
    }
    if (freeText?.consistencyBarrierOther) {
      lines.push(
        `Dificuldade original descrita como "Outra": ${freeText.consistencyBarrierOther}.`,
      );
    }
    if (freeText?.pastActivityOther) {
      lines.push(`Atividade prévia descrita como "Outra": ${freeText.pastActivityOther}.`);
    }
    if (freeText?.avoidedExercise) {
      lines.push(`Exercício que pediu para evitar desde o cadastro: ${freeText.avoidedExercise}.`);
    }
    return { text: lines.join('\n'), injuryTags: pain.tags };
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

    let newPainAssessment: PainAssessment;
    if (block3.newPain.hasNewPain) {
      const { region, intensity } = block3.newPain;
      // O schema (`protocolRenewalNewPainSchema.superRefine`) já exige region/intensity
      // quando hasNewPain=true, mas essa validação não é visível pro TypeScript — chegar
      // aqui sem os dois é uma violação de invariante upstream, não um caminho esperado.
      if (!region || intensity === undefined) {
        throw new Error(
          'Renovação com hasNewPain=true sem region/intensity — invariante do schema violada.',
        );
      }
      newPainAssessment = {
        hasPain: true,
        points: [
          {
            region,
            intensity,
            ...(block3.newPain.regionOther ? { regionOther: block3.newPain.regionOther } : {}),
          },
        ],
        trend: block3.newPain.trend,
        hasProfessionalExplanation: false,
        underMedicalFollowUp: false,
        hasAvoidanceRecommendation: false,
      };
    } else {
      newPainAssessment = {
        hasPain: false,
        points: [],
        hasProfessionalExplanation: false,
        underMedicalFollowUp: false,
        hasAvoidanceRecommendation: false,
      };
    }
    const newPain = painToConstraints(newPainAssessment);
    const parqRecheckTags = block3.parqRecheck.detail
      ? mapInjuriesToTags([block3.parqRecheck.detail])
      : [];

    const level = safety.requiresProfessionalReview ? demoteLevel(base.level) : base.level;
    const location =
      block5.changes.includes('TRAINING_LOCATION') && block5.location
        ? block5.location
        : base.location;
    const daysPerWeek =
      block5.changes.includes('DAYS_PER_WEEK') && block5.daysPerWeek
        ? block5.daysPerWeek
        : base.daysPerWeek;
    const preferredDays = block5.preferredDays.length ? block5.preferredDays : base.preferredDays;
    const sessionMinutes =
      block5.changes.includes('SESSION_DURATION') && block5.sessionDuration
        ? SESSION_DURATION_MINUTES[block5.sessionDuration]
        : base.sessionMinutes;
    const goal =
      block5.goalChange.changed && block5.goalChange.newGoal
        ? toGenerationGoal(block5.goalChange.newGoal)
        : base.goal;
    const avoid =
      block5.dislikedExercise.has && block5.dislikedExercise.description
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
      // ADR-008 §3.1 (Rafael) — reconciliação: a `constraints` em cascata pode ter perdido
      // uma tag num fallback no meio do caminho; a união com `anamnesisInjuryTags` (a raiz
      // de verdade) é sempre conservadora — segurança nunca é rebaixada por preferência
      // nem por uma cascata incompleta.
      injuryTags: [
        ...new Set([
          ...base.injuryTags,
          ...newPain.tags,
          ...parqRecheckTags,
          ...ctx.anamnesisInjuryTags,
        ]),
      ],
      injuriesRaw: [...base.injuriesRaw, ...newPain.raw],
      requiresProfessionalReview: safety.requiresProfessionalReview,
      parqTags: safety.requiresProfessionalReview
        ? [...new Set([...base.parqTags, ...parqRecheckTags])]
        : [],
      parqTriggered: base.parqTriggered,
      ...(safety.requiresProfessionalReview ? { maxPhase: 'ADAPTACAO' as const } : {}),
      importantEvent,
      ...(ctx.anamnesisInvariants ? { anamnesisInvariants: ctx.anamnesisInvariants } : {}),
      continuation: {
        previousMesocycleNumber: ctx.previousMesocycleNumber,
        previousPhase: ctx.previousContent.phase,
        previousPhaseDurationWeeks: ctx.previousTotalWeeks,
        summary: this.buildContinuationSummary(block1, block2, block3, block4, block5),
        ...(ctx.periodizationLedger ? { periodizationLedger: ctx.periodizationLedger } : {}),
        ...(ctx.executionDigest ? { executionDigest: ctx.executionDigest } : {}),
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

  /**
   * Narrativa em PT-BR das respostas de desempenho/fadiga/resultado — DADO, nunca
   * instrução. ADR-008 (campos órfãos, Victor): `barrierOther` e `goalChange.newGoalOther`
   * passam a entrar aqui — antes desta ADR eram salvos e nunca chegavam ao gerador.
   */
  private buildContinuationSummary(
    block1: ProtocolRenewalBlock1,
    block2: ProtocolRenewalBlock2,
    block3: ProtocolRenewalBlock3,
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
      `Peso atual informado: ${block4.currentWeightKg}kg.`,
    ];
    // Dor nova já sob avaliação profissional: sinal curto pro modelo calibrar a
    // progressão na região SEM nomear diagnóstico (`evaluateRenewalSafety` já usa o mesmo
    // campo para o gate de handoff — aqui é só contexto, nunca instrução clínica).
    if (block3.newPain.hasNewPain && block3.newPain.soughtCare !== undefined) {
      lines.push(
        block3.newPain.soughtCare
          ? 'A dor nova relatada já está sendo avaliada por um profissional de saúde.'
          : 'A dor nova relatada ainda NÃO foi avaliada por nenhum profissional de saúde.',
      );
    }
    if (block5.barriers.length) {
      const other =
        block5.barriers.includes('OTHER') && block5.barrierOther
          ? ` (detalhe do "Outra": ${block5.barrierOther})`
          : '';
      lines.push(
        `Dificuldades relatadas para este novo ciclo: ${block5.barriers.join(', ')}${other}.`,
      );
    }
    if (
      block5.goalChange.changed &&
      block5.goalChange.newGoal === 'OTHER' &&
      block5.goalChange.newGoalOther
    ) {
      lines.push(
        `Novo objetivo descrito em texto livre pelo aluno: ${block5.goalChange.newGoalOther}.`,
      );
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
      {
        userId,
        renewalSessionId,
        jobId: job.id,
        err: err.message,
        event: 'protocol_renewal_generation_dlq',
      },
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
  /** ADR-008 Camada 1 — ausente quando o resumo do mesociclo anterior não pôde ser lido/computado. */
  periodizationLedger?: string;
  /** ADR-008 Camada 2 — idem. */
  executionDigest?: string;
  /** ADR-008 Camada 3 — ausente só se não houver anamnese SUBMITTED (não deveria ocorrer). */
  anamnesisInvariants?: string;
  /** Tags de lesão da anamnese ORIGINAL, para a reconciliação em `toConstraints()`. */
  anamnesisInjuryTags: ContraindicationTag[];
  block1: ProtocolRenewalBlock1;
  block2: ProtocolRenewalBlock2;
  block3: ProtocolRenewalBlock3;
  block4: ProtocolRenewalBlock4;
  block5: ProtocolRenewalBlock5;
}
