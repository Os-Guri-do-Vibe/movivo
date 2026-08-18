/**
 * ProtocolGenerationWorker (US-2.4) — orquestra o pipeline "gera-e-valida".
 *
 * submit (US-1.3) enfileira → aqui: carrega usuário+anamnese sob RLS, decifra o bloco de
 * saúde, aplica o **gate PAR-Q** (trava: sessão de risco NÃO gera), gera+valida (planner),
 * persiste `protocols`/`protocol_versions` como `PENDING_REVIEW`/`OPTIONAL` e agenda a
 * janela de cortesia de 1h (`ProtocolAutoReleaseWorker` entrega se o CREF não agir antes —
 * decisão do fundador, 2026-08-18: nenhum protocolo entrega sozinho na hora, PASS incluso).
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
  type Weekday,
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

/** Atraso da mensagem de espera (fallback de DLQ) — dá tempo do CREF aprovar primeiro. */
const PROTOCOL_WAITING_DELAY_MS = 30 * 60 * 1000;

/**
 * Janela de cortesia da fila "Disponível para Revisão" (fila do profissional). Exportada
 * (não só local) porque o `DashboardService.queue()` precisa do mesmo valor para exibir
 * `autoReleaseAt` — uma só fonte de verdade evita o contador da UI dessincronizar do
 * `delay` real do job.
 */
export const PROTOCOL_OPTIONAL_REVIEW_WINDOW_MS = 60 * 60 * 1000;

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

    // Achado 2026-08-18: sem isso, um protocolo que cai no fallback (MANDATORY, sem
    // auto-liberação) não deixava rastro nenhum de POR QUE — nem em log. `detail` das
    // violações é estrutural (ex.: id de exercício, nível, split) — nunca eco de texto
    // livre/saúde do titular, seguro de logar em claro.
    if (plan.violations.length > 0) {
      this.logger.warn(
        {
          userId,
          usedFallbackTemplate: plan.usedFallbackTemplate,
          validationAction: plan.validationAction,
          violations: plan.violations,
        },
        'geração de protocolo não passou limpa na validação',
      );
    }

    // Decisão do fundador (2026-08-18): todo protocolo gerado entra na fila como
    // PENDING_REVIEW/OPTIONAL — nunca entrega sozinho na hora, PASS incluso. O único
    // motivo pra travar sem prazo (MANDATORY) é PAR-Q, já filtrado pelo gate acima. Ver
    // `protocol-planner.ts` para o raciocínio completo.
    const persisted = await this.repository.persist({
      userId,
      content: plan.content,
      constraints,
      parqFlags: constraints.injuryTags,
      approvalStatus: 'PENDING_REVIEW',
      status: 'PENDING_SIGNATURE',
      humanReviewRequired: true,
      reviewUrgency: 'OPTIONAL',
      totalWeeks: DEFAULT_TOTAL_WEEKS,
      generatedBy: plan.generatedBy,
      modelVersion: plan.modelVersion,
      promptVersion: plan.promptVersion,
      signed: false,
    });

    if (persisted.alreadyExisted) {
      this.logger.info({ userId }, 'corrida de persistência — protocolo já existia');
      return { status: 'ALREADY_EXISTS' };
    }

    await this.queues.enqueue(
      QUEUE.protocolAutoRelease,
      'auto-release',
      { userId, protocolId: persisted.protocolId },
      {
        delay: PROTOCOL_OPTIONAL_REVIEW_WINDOW_MS,
        jobId: `auto-release-${persisted.protocolId}`,
      },
    );

    this.logger.info(
      { userId, protocolId: persisted.protocolId, validationAction: plan.validationAction },
      'protocolo PENDING_REVIEW — aguarda painel CREF ou auto-liberação em 1h',
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
      preferredDays: structured.preferredDays,
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

  /** TASK-2.4.4 — fallback de DLQ: mensagem de espera + template pendente de revisão. */
  private async handleTerminalFailure(job: Job<ProtocolGenerationJob>, err: Error): Promise<void> {
    const { userId, anamnesisSessionId } = job.data;
    this.logger.error(
      { userId, jobId: job.id, err: err.message, event: 'protocol_generation_dlq' },
      'geração de protocolo esgotou os retries — acionando fallback',
    );

    // Mensagem de espera ao usuário (copy nos guardrails — nada de diagnóstico/garantia).
    // Atraso de 30min: o fallback conservador já foi persistido como PENDING_REVIEW logo
    // abaixo, e o profissional CREF pode aprovar antes disso — nesse caso a entrega real
    // (PROTOCOL_DELIVERY) já resolve tudo, e um "ainda estou preparando" chegando depois
    // seria só ruído. O worker de outbound reconfirma o status na hora do envio (não só
    // no enqueue), então mesmo com o atraso o guard continua valendo.
    await this.queues.enqueue(
      QUEUE.whatsappOutbound,
      'protocol-waiting',
      { userId, type: 'PROTOCOL_WAITING' },
      { jobId: `protocol-waiting_${userId}`, delay: PROTOCOL_WAITING_DELAY_MS },
    );

    // Task manual consultável: template conservador pré-aprovado, PENDING_REVIEW +
    // human_review_required — aparece na fila de revisão do painel (Sprint 5). Se já
    // existir protocolo (corrida), o UNIQUE(user_id, version) devolve `alreadyExisted`.
    //
    // `OPTIONAL`, não `MANDATORY` (achado 2026-08-18, mesma decisão do planner): quem
    // chega no DLQ já passou pelo gate de PAR-Q lá em `process()` — esgotar os retries é
    // indisponibilidade de infraestrutura (LLM fora do ar), não risco clínico. Por isso
    // agenda a MESMA janela de cortesia de 1h que `process()` agenda no caminho normal.
    try {
      const { goal, preferredDays } = await this.constraintsForFallback(userId, anamnesisSessionId);
      const content = buildFallbackProtocol(goal, preferredDays);
      const persisted = await this.repository.persist({
        userId,
        content,
        constraints: { goal, preferredDays, fallback: true },
        parqFlags: [],
        approvalStatus: 'PENDING_REVIEW',
        status: 'PENDING_SIGNATURE',
        humanReviewRequired: true,
        reviewUrgency: 'OPTIONAL',
        totalWeeks: DEFAULT_TOTAL_WEEKS,
        generatedBy: 'FALLBACK_TEMPLATE',
        modelVersion: null,
        promptVersion: FALLBACK_TEMPLATE_VERSION,
        signed: false,
      });
      if (!persisted.alreadyExisted) {
        this.queueEvents.emit('protocol');
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
    } catch (persistErr) {
      this.logger.error(
        { userId, err: persistErr },
        'fallback: falha ao persistir template pendente',
      );
    }
  }

  private async constraintsForFallback(
    userId: string,
    sessionId: string,
  ): Promise<{ goal: GenerationGoal; preferredDays: Weekday[] }> {
    try {
      const [session] = await this.db.runAsUser(userId, 'USER', (tx) =>
        tx
          .select({ dataBlock3: anamnesisSessions.dataBlock3 })
          .from(anamnesisSessions)
          .where(eq(anamnesisSessions.id, sessionId))
          .limit(1),
      );
      const parsed = anamnesisStructuredSchema.safeParse(session?.dataBlock3);
      return parsed.success
        ? {
            goal: toGenerationGoal(parsed.data.primaryGoal),
            preferredDays: parsed.data.preferredDays,
          }
        : { goal: 'CONDITIONING', preferredDays: [] };
    } catch {
      return { goal: 'CONDITIONING', preferredDays: [] };
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
