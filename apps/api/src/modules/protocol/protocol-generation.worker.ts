/**
 * ProtocolGenerationWorker (US-2.4) — orquestra o pipeline "gera-e-valida".
 *
 * submit (US-1.3) enfileira → aqui: carrega usuário+anamnese sob RLS, decifra o bloco de
 * saúde, converte o PAR-Q em constraints, gera+valida (planner), persiste
 * `protocols`/`protocol_versions` como `PENDING_REVIEW` e agenda a janela de cortesia de 1h
 * (`ProtocolAutoReleaseWorker` entrega se o CREF não agir antes — decisão do fundador,
 * 2026-08-18: nenhum protocolo entrega sozinho na hora, PASS incluso).
 *
 * **Mudança de 2026-08-24 (decisão do fundador):** PAR-Q bloqueado deixou de ser TRAVA de
 * geração. Antes, `requires_professional_review = true` fazia o job encerrar sem gerar nada,
 * e o titular ficava numa fila "PAR-Q para Revisão" separada até um RT liberar à mão — só
 * então o protocolo era gerado. Agora o protocolo é SEMPRE gerado, em modo conservador
 * (nível rebaixado, teto de fase, tags de PAR-Q com a mesma força de tag de lesão), nasce
 * `reviewUrgency: MANDATORY`, cai na MESMA fila de revisão de protocolo e **nunca** agenda
 * auto-liberação: só sai por assinatura humana (`DashboardService.signProtocol`), que é
 * também onde a liberação do PAR-Q passou a acontecer.
 *
 * Concorrência/lock/retries/backoff vêm do `WorkerFactory` (US-1.7). Falha terminal (após os
 * retries) → fallback: template conservador pendente de revisão (task manual consultável no
 * painel — Sprint 5). A mensagem "estou analisando" NÃO é agendada aqui: ela é agendada no
 * submit do formulário (`AnamnesisService.submit`), sempre, e independe deste caminho.
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import {
  anamnesisStructuredSchema,
  ParqState,
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
import { evaluateParq, type ParqEvaluation } from '../anamnesis/parq';
import {
  demoteLevel,
  emphasisToMuscleGroups,
  levelFromExperience,
  mapInjuriesToTags,
  painToConstraints,
  parqToConstraints,
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

  /** Processa um job. Consentimento revogado e idempotência encerram com sucesso (não são erro). */
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
    // PENDING_REVIEW — nunca entrega sozinho na hora, PASS incluso. `OPTIONAL` ganha a
    // janela de cortesia de 1h; `MANDATORY` (PAR-Q bloqueado, 2026-08-24) nunca sai sem
    // assinatura humana. Ver `protocol-planner.ts` para o raciocínio completo.
    const mandatory = constraints.requiresProfessionalReview;
    const persisted = await this.repository.persist({
      userId,
      content: plan.content,
      constraints,
      // Achado 2026-08-24: aqui gravava `injuryTags` — as tags de DOR/LESÃO — numa coluna
      // que o resto do sistema (validador, painel) lê como "flags de PAR-Q". Agora grava
      // o que a coluna promete: só o que veio do PAR-Q.
      parqFlags: constraints.parqTags,
      approvalStatus: 'PENDING_REVIEW',
      status: 'PENDING_SIGNATURE',
      humanReviewRequired: true,
      reviewUrgency: mandatory ? 'MANDATORY' : 'OPTIONAL',
      anamnesisSessionId,
      totalWeeks: DEFAULT_TOTAL_WEEKS,
      generatedBy: plan.generatedBy,
      modelVersion: plan.modelVersion,
      promptVersion: plan.promptVersion,
      knowledgeSources: plan.knowledgeSources,
      methodologyVersionId: plan.methodologyVersionId,
      methodologySha256: plan.methodologySha256,
      signed: false,
    });

    if (persisted.alreadyExisted) {
      this.logger.info({ userId }, 'corrida de persistência — protocolo já existia');
      return { status: 'ALREADY_EXISTS' };
    }

    // `MANDATORY` NUNCA agenda auto-liberação: PAR-Q bloqueado só sai da fila por
    // assinatura humana. `ProtocolRepository.autoRelease` já rejeitaria o job pelo estado
    // (defesa em profundidade), mas não agendar é a barreira mais barata e mais óbvia.
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
        protocolId: persisted.protocolId,
        validationAction: plan.validationAction,
        reviewUrgency: mandatory ? 'MANDATORY' : 'OPTIONAL',
        parqTriggered: constraints.parqTriggered,
      },
      mandatory
        ? 'protocolo PENDING_REVIEW/MANDATORY — só sai por assinatura humana CREF'
        : 'protocolo PENDING_REVIEW — aguarda painel CREF ou auto-liberação em 1h',
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
   *
   * 2026-08-24: o PAR-Q entra aqui como restrição de verdade (`parqToConstraints`) — tag
   * de PAR-Q é mesclada em `injuryTags` para que gerador E validador a tratem com a mesma
   * força de uma lesão, e continua visível separada em `parqTags` (o que vai pra coluna
   * `par_q_flags`). Quando o PAR-Q bloqueia, o nível cai um degrau (`demoteLevel`): quem
   * tem alerta clínico aberto não começa por onde o histórico de treino permitiria.
   */
  private toConstraints(ctx: LoadedContext): UserConstraints {
    const { structured, health } = ctx;
    const pain = painToConstraints(health.pain);
    // Texto livre que é restrição de fato: orientação profissional de evitar movimento.
    // O "exercício que não gosto" NÃO entra aqui — vai para `avoid`, que é preferência.
    const injuriesRaw = pain.raw;

    const parqAnswers = health.parq?.answers ?? [];
    const evaluation: ParqEvaluation = health.parq
      ? evaluateParq({ parq: health.parq })
      : { parqState: ParqState.LIBERADO, requiresProfessionalReview: false, triggeredQuestions: [] };
    const parq = parqToConstraints(evaluation, parqAnswers);
    // O booleano autoritativo é o do titular (`users.requires_professional_review`, escrito
    // no submit e zerado na liberação humana); a avaliação local só deriva as TAGS.
    const requiresProfessionalReview = ctx.requiresProfessionalReview;
    const level = levelFromExperience(structured.experience);

    return {
      requiresProfessionalReview,
      parqTags: parq.tags,
      parqTriggered: evaluation.triggeredQuestions,
      ...(parq.maxPhase ? { maxPhase: parq.maxPhase } : {}),
      // "Outro" nunca chega ao gerador: `toGenerationGoal` o traduz para o objetivo
      // genérico seguro; o texto bruto do usuário fica na anamnese, para o painel CREF.
      goal: toGenerationGoal(structured.primaryGoal),
      // Fim do default hardcoded (D6 / TASK-6.9.2). PAR-Q bloqueado rebaixa um degrau.
      level: requiresProfessionalReview ? demoteLevel(level) : level,
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
      // Tag de PAR-Q entra em `injuryTags` de propósito: é assim que o gerador (prompt) e
      // o validador (`checkStructure`) já excluem exercício contraindicado. Sem a mescla,
      // "CARDIAC vindo do PAR-Q" só existiria como etiqueta, sem vetar exercício nenhum.
      injuryTags: [...new Set([...pain.tags, ...mapInjuriesToTags(injuriesRaw), ...parq.tags])],
      injuriesRaw,
    };
  }

  /** TASK-2.4.4 — fallback de DLQ: template conservador persistido como pendente de revisão. */
  private async handleTerminalFailure(job: Job<ProtocolGenerationJob>, err: Error): Promise<void> {
    const { userId, anamnesisSessionId } = job.data;
    this.logger.error(
      { userId, jobId: job.id, err: err.message, event: 'protocol_generation_dlq' },
      'geração de protocolo esgotou os retries — acionando fallback',
    );

    // NÃO enfileira mais `protocol-waiting` aqui. A mensagem "estou analisando" passou a
    // ser agendada no SUBMIT (`AnamnesisService.submit`), 30min depois do formulário,
    // sempre — independente do desfecho da geração. Agendar de novo daqui só produziria
    // duplicidade (mesmo `jobId`, mas com o relógio partindo da falha, não do submit) e
    // atrasaria a apresentação da agente por todo o tempo dos retries.

    // Task manual consultável: template conservador pré-aprovado, PENDING_REVIEW +
    // human_review_required — aparece na fila de revisão do painel (Sprint 5). Se já
    // existir protocolo (corrida), o UNIQUE(user_id, version) devolve `alreadyExisted`.
    //
    // Esgotar os retries é indisponibilidade de infraestrutura (LLM fora do ar), não risco
    // clínico: por si só, o DLQ é `OPTIONAL` e agenda a MESMA janela de cortesia de 1h do
    // caminho normal (achado 2026-08-18). O que decide `MANDATORY` aqui é a MESMA regra do
    // caminho normal — PAR-Q do titular. Antes de 2026-08-24 este caminho fixava `OPTIONAL`
    // e `parqFlags: []` no braço, o que era correto só porque o gate de PAR-Q travava a
    // geração lá atrás; sem o gate, fixar seria auto-liberar um titular bloqueado.
    try {
      const { goal, preferredDays, requiresProfessionalReview, parqTags } =
        await this.constraintsForFallback(userId, anamnesisSessionId);
      const content = buildFallbackProtocol(goal, preferredDays);
      const persisted = await this.repository.persist({
        userId,
        content,
        constraints: { goal, preferredDays, requiresProfessionalReview, parqTags, fallback: true },
        parqFlags: parqTags,
        approvalStatus: 'PENDING_REVIEW',
        status: 'PENDING_SIGNATURE',
        humanReviewRequired: true,
        reviewUrgency: requiresProfessionalReview ? 'MANDATORY' : 'OPTIONAL',
        anamnesisSessionId,
        totalWeeks: DEFAULT_TOTAL_WEEKS,
        generatedBy: 'FALLBACK_TEMPLATE',
        modelVersion: null,
        promptVersion: FALLBACK_TEMPLATE_VERSION,
        signed: false,
      });
      if (!persisted.alreadyExisted) {
        this.queueEvents.emit('protocol');
        if (!requiresProfessionalReview) {
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
      }
    } catch (persistErr) {
      this.logger.error(
        { userId, err: persistErr },
        'fallback: falha ao persistir template pendente',
      );
    }
  }

  /**
   * Constraints mínimas do caminho de fallback. Além de objetivo/dias (para o template),
   * lê o estado de PAR-Q do titular — sem ele o DLQ não teria como distinguir "LLM caiu"
   * de "LLM caiu para alguém com alerta clínico aberto", e auto-liberaria o segundo.
   *
   * Fail-safe assimétrico de propósito: qualquer falha de leitura devolve
   * `requiresProfessionalReview: true` (trava na revisão humana). Errar aqui para o lado
   * do `OPTIONAL` entregaria treino sozinho a quem talvez não pudesse recebê-lo; errar
   * para o lado do `MANDATORY` só custa uma revisão humana a mais.
   */
  private async constraintsForFallback(
    userId: string,
    sessionId: string,
  ): Promise<{
    goal: GenerationGoal;
    preferredDays: Weekday[];
    requiresProfessionalReview: boolean;
    parqTags: ReturnType<typeof parqToConstraints>['tags'];
  }> {
    try {
      return await this.db.runAsUser(userId, 'USER', async (tx) => {
        const [user] = await tx
          .select({ requiresProfessionalReview: users.requiresProfessionalReview })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        const [session] = await tx
          .select({
            dataBlock2: anamnesisSessions.dataBlock2,
            dataBlock3: anamnesisSessions.dataBlock3,
          })
          .from(anamnesisSessions)
          .where(eq(anamnesisSessions.id, sessionId))
          .limit(1);
        const parsed = anamnesisStructuredSchema.safeParse(session?.dataBlock3);
        const parqTags = await this.fallbackParqTags(session?.dataBlock2 ?? null);
        return {
          goal: parsed.success ? toGenerationGoal(parsed.data.primaryGoal) : 'CONDITIONING',
          preferredDays: parsed.success ? parsed.data.preferredDays : [],
          requiresProfessionalReview: user?.requiresProfessionalReview ?? true,
          parqTags,
        };
      });
    } catch {
      return {
        goal: 'CONDITIONING',
        preferredDays: [],
        requiresProfessionalReview: true,
        parqTags: [],
      };
    }
  }

  /**
   * Tags de PAR-Q para o caminho de fallback. Melhor esforço: se o bloco cifrado não abrir
   * ou não bater no schema, devolve vazio — o `reviewUrgency` (que é o que de fato trava a
   * entrega) já foi decidido pelo booleano do titular, que não depende desta leitura.
   */
  private async fallbackParqTags(
    dataBlock2: Buffer | null,
  ): Promise<ReturnType<typeof parqToConstraints>['tags']> {
    if (!dataBlock2) return [];
    try {
      const health = healthBlockSchema.parse(
        JSON.parse(await this.cipher.decryptHealth(dataBlock2)),
      );
      if (!health.parq) return [];
      return parqToConstraints(evaluateParq({ parq: health.parq }), health.parq.answers).tags;
    } catch {
      return [];
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
