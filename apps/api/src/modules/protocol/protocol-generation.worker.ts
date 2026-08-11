/**
 * ProtocolGenerationWorker (US-2.4) — orquestra o pipeline "gera-e-valida".
 *
 * submit (US-1.3) enfileira → aqui: carrega usuário+anamnese sob RLS, decifra o bloco de
 * saúde, aplica o **gate PAR-Q** (trava: sessão de risco NÃO gera), gera+valida (planner),
 * persiste `protocols`/`protocol_versions` com `approval_status` e origem, auto-aprova/assina
 * a metodologia do RT no caminho limpo e **enfileira a entrega** (worker real é a US-2.5).
 *
 * Concorrência/lock/retries/backoff vêm do `WorkerFactory` (US-1.7). Falha terminal (após os
 * retries) → fallback: mensagem de espera enfileirada + template pendente de revisão (task
 * manual consultável no painel — Sprint 5).
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import {
  anamnesisStructuredSchema,
  SESSION_DURATION_MINUTES,
  toGenerationGoal,
  type AnamnesisStructured,
  type GenerationGoal,
} from '@movivo/shared';

import { HealthCipherService } from '../../core/database/health-cipher.service';
import { HealthConsentService } from '../../core/database/health-consent.service';
import { anamnesisSessions, users } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
import { isFinalFailure } from '../jobs/dlq.handler';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkerFactory } from '../jobs/worker.factory';
import { ProtocolGeneratorService } from './protocol-generator.service';
import { planProtocol } from './protocol-planner';
import { ProtocolRepository } from './protocol.repository';
import { healthBlockSchema, type HealthBlock } from '../anamnesis/health-block';
import {
  emphasisToMuscleGroups,
  levelFromExperience,
  mapInjuriesToTags,
  painToConstraints,
  type UserConstraints,
} from './user-constraints';
import { buildFallbackProtocol, FALLBACK_TEMPLATE_VERSION } from './validation/fallback-template';
import { ValidationService } from './validation/validation.service';

/** Payload do job — só UUIDs, nunca PII (o dado de saúde é carregado sob RLS aqui). */
export interface ProtocolGenerationJob {
  userId: string;
  anamnesisSessionId: string;
  /** ISO do submit — origem do SLA submit→entrega. */
  submittedAt?: string;
  correlationId?: string;
}

/** ponytail: horizonte fixo do protocolo no MVP; o check-in (Sprint 5) reperiodiza. */
const DEFAULT_TOTAL_WEEKS = 12;

@Injectable()
export class ProtocolGenerationWorker implements OnModuleInit {
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
    this.logger.setContext(ProtocolGenerationWorker.name);
  }

  onModuleInit(): void {
    const worker = this.workers.create<ProtocolGenerationJob>(QUEUE.protocolGeneration, (job) =>
      this.process(job),
    );
    // Falha terminal (esgotou os retries) → fallback específico da geração (TASK-2.4.4).
    // O `WorkerFactory` já roteia para a DLQ genérica; aqui adicionamos o efeito de negócio.
    worker.on('failed', (job, err) => {
      if (job && isFinalFailure(job)) {
        void this.handleTerminalFailure(job as Job<ProtocolGenerationJob>, err).catch(
          (fallbackErr: unknown) => {
            this.logger.error(
              { jobId: job.id, err: fallbackErr },
              'fallback de DLQ da geração de protocolo falhou',
            );
          },
        );
      }
    });
  }

  /** Processa um job. Gate PAR-Q e idempotência encerram com sucesso (não são erro). */
  async process(job: Job<ProtocolGenerationJob>): Promise<{ status: string }> {
    const { userId, anamnesisSessionId } = job.data;

    if (!(await this.healthConsent.hasActiveForUser(userId))) {
      this.logger.info(
        { event: 'protocol_generation_discarded_no_consent', userId },
        'geracao encerrada apos revogacao de consentimento',
      );
      return { status: 'CONSENT_REVOKED' };
    }

    const loaded = await this.load(userId, anamnesisSessionId);
    if (!loaded) {
      this.logger.warn({ userId }, 'usuário/anamnese não encontrados — encerrando job');
      return { status: 'NOT_FOUND' };
    }

    // TASK-2.4.2 — gate PAR-Q é TRAVA, não flag: sessão de risco não gera nada.
    if (loaded.requiresProfessionalReview) {
      this.queueEvents.emit('parq');
      this.logger.info(
        { userId, event: 'protocol_generation_blocked_parq' },
        'sessão com PAR-Q de risco — aguardando liberação profissional (Sprint 5)',
      );
      return { status: 'BLOCKED_PENDING_CLEARANCE' };
    }

    // TASK-2.4.1 — idempotência: não regenera nem chama o LLM se o protocolo já existe.
    if (await this.repository.existsForUser(userId)) {
      this.logger.info({ userId }, 'protocolo já existe — job idempotente, nada a fazer');
      return { status: 'ALREADY_EXISTS' };
    }

    const constraints = this.toConstraints(loaded);
    const scrubUser = { name: loaded.name, phoneNumber: loaded.phoneNumber, email: loaded.email };

    // TASK-2.4.3 — gera+valida (planner) → persiste → auto-aprova/assina → entrega.
    const plan = await planProtocol(this.generator, this.validation, {
      userId,
      user: scrubUser,
      constraints,
    });

    const persisted = await this.repository.persist({
      userId,
      content: plan.content,
      constraints,
      parqFlags: constraints.injuryTags,
      approvalStatus: plan.approvalStatus,
      status: plan.autoApproved ? 'ACTIVE' : 'PENDING_SIGNATURE',
      humanReviewRequired: plan.humanReviewRequired,
      totalWeeks: DEFAULT_TOTAL_WEEKS,
      generatedBy: plan.generatedBy,
      modelVersion: plan.modelVersion,
      promptVersion: plan.promptVersion,
      signed: plan.autoApproved,
    });

    if (persisted.alreadyExisted) {
      this.logger.info({ userId }, 'corrida de persistência — protocolo já existia');
      return { status: 'ALREADY_EXISTS' };
    }

    if (plan.autoApproved) {
      await this.enqueueDelivery(
        userId,
        persisted.protocolId,
        persisted.version,
        loaded.submittedAt,
      );
      this.logger.info(
        { userId, protocolId: persisted.protocolId, professionalId: persisted.professionalId },
        'protocolo AUTO_APPROVED/ACTIVE assinado (metodologia RT) — entrega enfileirada',
      );
      return { status: 'AUTO_APPROVED' };
    }

    this.logger.info(
      { userId, protocolId: persisted.protocolId, validationAction: plan.validationAction },
      'protocolo PENDING_REVIEW — não entrega, aguarda painel CREF (Sprint 5)',
    );
    this.queueEvents.emit('protocol');
    return { status: 'PENDING_REVIEW' };
  }

  // --- carregamento sob RLS -------------------------------------------------

  private async load(userId: string, sessionId: string): Promise<LoadedContext | null> {
    return this.db.runAsUser(userId, 'USER', async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) return null;
      const [session] = await tx
        .select()
        .from(anamnesisSessions)
        .where(eq(anamnesisSessions.id, sessionId))
        .limit(1);
      if (!session || !session.dataBlock2 || !session.dataBlock3) return null;

      const health = healthBlockSchema.parse(
        JSON.parse(await this.cipher.decryptHealth(session.dataBlock2)),
      );
      const structured = anamnesisStructuredSchema.parse(session.dataBlock3);

      return {
        requiresProfessionalReview: user.requiresProfessionalReview,
        name: user.name,
        phoneNumber: user.phoneNumber,
        email: user.email,
        submittedAt: session.submittedAt,
        structured,
        health,
      };
    });
  }

  /**
   * Anamnese v2 → constraints do gerador (US-6.9).
   *
   * É aqui que a Sprint 6 paga o que prometeu: `level` deixa de ser `INICIANTE`
   * hardcoded e passa a vir da experiência declarada; ênfase e preferências passam a
   * existir; a dor localizada vira contraindicação estruturada, não texto solto.
   *
   * **Precedência inegociável:** `avoid` é PREFERÊNCIA e só remove exercício; nada nele
   * reabilita algo que `injuryTags` (segurança) tirou. O veto final continua sendo do
   * `ValidationService`, que não lê `avoid`.
   */
  private toConstraints(ctx: LoadedContext): UserConstraints {
    const { structured, health } = ctx;
    const pain = painToConstraints(health.pain);
    // Texto livre que é restrição de fato: orientação profissional de evitar movimento.
    // O "exercício que não gosto" NÃO entra aqui — vai para `avoid`, que é preferência.
    const injuriesRaw = pain.raw;

    return {
      // "Outro" nunca chega ao gerador: `toGenerationGoal` o traduz para o objetivo
      // genérico seguro; o texto bruto do usuário fica na anamnese, para o painel CREF.
      goal: toGenerationGoal(structured.primaryGoal),
      // Fim do default hardcoded (D6 / TASK-6.9.2).
      level: levelFromExperience(structured.experience),
      daysPerWeek: structured.daysPerWeek,
      sessionMinutes: SESSION_DURATION_MINUTES[structured.sessionDuration],
      location: structured.location,
      // A anamnese v2 não pergunta equipamento item a item — o LOCAL já determina o que
      // existe, e o catálogo filtra por local. Perguntar de novo seria pedir ao usuário
      // uma informação que ele frequentemente não sabe responder.
      equipment: [],
      emphasis: emphasisToMuscleGroups(structured.emphasis),
      avoid: health.freeText?.avoidedExercise ? [health.freeText.avoidedExercise] : [],
      injuryTags: [...new Set([...pain.tags, ...mapInjuriesToTags(injuriesRaw)])],
      injuriesRaw,
    };
  }

  // --- entrega + SLA --------------------------------------------------------

  private async enqueueDelivery(
    userId: string,
    protocolId: string,
    version: number,
    submittedAt: Date | null,
  ): Promise<void> {
    // Idempotência do enqueue: jobId de negócio evita duplicar a entrega em reprocesso.
    // BullMQ proíbe `:` em jobId (é o separador de chave do Redis) — usamos `_`.
    await this.queues.enqueue(
      QUEUE.whatsappOutbound,
      'protocol-delivery',
      { userId, protocolId, protocolVersion: version, type: 'PROTOCOL_DELIVERY' },
      { jobId: `protocol-delivery_${userId}_${version}` },
    );

    // TASK-2.4.4 — SLA submit→entrega. ponytail: log estruturado (sem SDK server do
    // PostHog nesta sprint, mesmo padrão de `form_submitted`); a US-2.5 emite o
    // `protocol_sent` final no envio real. Aqui medimos o tempo até enfileirar a entrega.
    const slaMs = submittedAt ? Date.now() - submittedAt.getTime() : null;
    this.logger.info(
      { event: 'protocol_sent', userId, protocolId, slaMs },
      'protocol_sent (SLA submit→entrega enfileirada)',
    );
  }

  /** TASK-2.4.4 — fallback de DLQ: mensagem de espera + template pendente de revisão. */
  private async handleTerminalFailure(job: Job<ProtocolGenerationJob>, err: Error): Promise<void> {
    const { userId, anamnesisSessionId } = job.data;
    this.logger.error(
      { userId, jobId: job.id, err: err.message, event: 'protocol_generation_dlq' },
      'geração de protocolo esgotou os retries — acionando fallback',
    );

    // Mensagem de espera ao usuário (copy nos guardrails — nada de diagnóstico/garantia).
    await this.queues.enqueue(
      QUEUE.whatsappOutbound,
      'protocol-waiting',
      { userId, type: 'PROTOCOL_WAITING' },
      { jobId: `protocol-waiting_${userId}` },
    );

    // Task manual consultável: template conservador pré-aprovado, PENDING_REVIEW +
    // human_review_required — aparece na fila de revisão do painel (Sprint 5). Se já
    // existir protocolo (corrida), o UNIQUE(user_id, version) devolve `alreadyExisted`.
    try {
      const goal = await this.goalForFallback(userId, anamnesisSessionId);
      const content = buildFallbackProtocol(goal);
      const persisted = await this.repository.persist({
        userId,
        content,
        constraints: { goal, fallback: true },
        parqFlags: [],
        approvalStatus: 'PENDING_REVIEW',
        status: 'PENDING_SIGNATURE',
        humanReviewRequired: true,
        totalWeeks: DEFAULT_TOTAL_WEEKS,
        generatedBy: 'FALLBACK_TEMPLATE',
        modelVersion: null,
        promptVersion: FALLBACK_TEMPLATE_VERSION,
        signed: false,
      });
      if (!persisted.alreadyExisted) this.queueEvents.emit('protocol');
    } catch (persistErr) {
      this.logger.error(
        { userId, err: persistErr },
        'fallback: falha ao persistir template pendente',
      );
    }
  }

  private async goalForFallback(userId: string, sessionId: string): Promise<GenerationGoal> {
    try {
      const [session] = await this.db.runAsUser(userId, 'USER', (tx) =>
        tx
          .select({ dataBlock3: anamnesisSessions.dataBlock3 })
          .from(anamnesisSessions)
          .where(eq(anamnesisSessions.id, sessionId))
          .limit(1),
      );
      const parsed = anamnesisStructuredSchema.safeParse(session?.dataBlock3);
      return parsed.success ? toGenerationGoal(parsed.data.primaryGoal) : 'CONDITIONING';
    } catch {
      return 'CONDITIONING';
    }
  }
}

interface LoadedContext {
  requiresProfessionalReview: boolean;
  name: string | null;
  phoneNumber: string;
  email: string | null;
  submittedAt: Date | null;
  /** Etapa 2, seções 1/2/3/5 (jsonb em claro). */
  structured: AnamnesisStructured;
  /** Bloco cifrado: seção 4, textos livres, PAR-Q e declarações. */
  health: HealthBlock;
}
