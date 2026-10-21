/**
 * `ProtocolRegenerationWorker` — botão "Gerar protocolo novamente" da fila do profissional.
 *
 * Refaz o CONTEÚDO de um protocolo que ainda espera revisão (`PENDING_SIGNATURE`/
 * `PENDING_REVIEW`), a partir da anamnese ORIGINAL do titular, rodando o mesmo pipeline
 * gera-e-valida da geração inicial (`planProtocol`): metodologia vigente da base de
 * conhecimento, artigos científicos recuperados (RAG) e o contexto individual do aluno.
 * Nunca cria linha nova — substitui o conteúdo da MESMA linha, como `editProtocol` já faz
 * (o snapshot da versão emitida continua em `protocol_versions`, que é append-only).
 *
 * **Só grava se a regeração prestar.** Se o pipeline cair no template de fallback de novo,
 * o protocolo atual permanece exatamente como estava: trocar um conteúdo por outro igualmente
 * genérico só reiniciaria o relógio da revisão sem melhorar nada.
 *
 * **Fila de destino (correção do fundador, 2026-10-21):** a urgência é recalculada pela MESMA
 * política da geração (`reviewUrgencyForPlan`). Protocolo que nasceu do template de fallback
 * (`MANDATORY`) e é regerado com sucesso, de aluno sem PAR-Q bloqueante, passa a
 * `OPTIONAL` — "Revisão Humana Opcional" — e ganha a janela de cortesia de 24h. PAR-Q
 * bloqueante continua `MANDATORY` e nunca agenda auto-liberação.
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import type { ProtocolStructure } from '@movivo/shared';

import { HealthCipherService } from '../../core/database/health-cipher.service';
import { HealthConsentService } from '../../core/database/health-consent.service';
import { protocols } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkerFactory } from '../jobs/worker.factory';
import { constraintsFromAnamnesis, loadGenerationContext } from './generation-context';
import {
  PROTOCOL_OPTIONAL_REVIEW_WINDOW_MS,
  reviewUrgencyForPlan,
} from './protocol-generation.worker';
import { ProtocolGeneratorService } from './protocol-generator.service';
import { isProfessionalAuthored } from './protocol-origin';
import { planProtocol } from './protocol-planner';
import { mesocycleName, signatureHash } from './protocol.repository';
import { ValidationService } from './validation/validation.service';

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/** Payload do job — só UUIDs e flags, nunca PII (o dado de saúde é carregado sob RLS aqui). */
export interface ProtocolRegenerationJob {
  userId: string;
  protocolId: string;
  /** Quem pediu (staff). Só para o log; a autorização já foi feita no endpoint. */
  requestedBy: string;
  /** O profissional confirmou que a regeração descarta a edição manual dele. */
  overrideProfessionalEdit?: boolean;
}

/**
 * Desfecho do job, lido pelo painel (`DashboardService.queue`) para mostrar se a regeração
 * mudou o protocolo. Só `REGENERATED` troca o conteúdo; os demais deixam a linha intacta.
 */
export type ProtocolRegenerationStatus =
  | 'REGENERATED'
  | 'FALLBACK_AGAIN'
  | 'NOT_PENDING'
  | 'NOT_FOUND'
  | 'EDITED_MEANWHILE'
  | 'CONSENT_REVOKED';

/** Id estável por protocolo: o endpoint o usa para barrar pedido duplicado enquanto roda. */
export function regenerationJobId(protocolId: string): string {
  return `regenerate-${protocolId}`;
}

@Injectable()
export class ProtocolRegenerationWorker implements OnModuleInit {
  constructor(
    private readonly workers: WorkerFactory,
    private readonly queues: QueueManager,
    private readonly db: TenantDatabase,
    private readonly healthConsent: HealthConsentService,
    private readonly cipher: HealthCipherService,
    private readonly generator: ProtocolGeneratorService,
    private readonly validation: ValidationService,
    private readonly queueEvents: DashboardQueueEventsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ProtocolRegenerationWorker.name);
  }

  onModuleInit(): void {
    this.workers.create<ProtocolRegenerationJob>(QUEUE.protocolRegeneration, (job) =>
      this.process(job),
    );
  }

  async process(
    job: Job<ProtocolRegenerationJob>,
  ): Promise<{ status: ProtocolRegenerationStatus }> {
    const status = await this.regenerate(job.data);
    // Qualquer desfecho invalida a fila: o card sai do "gerando…" mesmo sem troca de conteúdo.
    this.queueEvents.emit('protocol');
    return { status };
  }

  private async regenerate(data: ProtocolRegenerationJob): Promise<ProtocolRegenerationStatus> {
    const { userId, protocolId, requestedBy, overrideProfessionalEdit = false } = data;

    if (!(await this.healthConsent.hasActiveForUser(userId))) {
      this.logger.info(
        { event: 'protocol_regeneration_discarded_no_consent', userId, protocolId },
        'regeração encerrada após revogação de consentimento',
      );
      return 'CONSENT_REVOKED';
    }

    const current = await this.readPending(userId, protocolId);
    if (!current) return 'NOT_FOUND';
    if (!current.pending || !current.anamnesisSessionId) {
      this.logger.info(
        { userId, protocolId, status: current.statusLabel },
        'regeração ignorada — protocolo não está mais pendente de revisão (ou não nasceu de anamnese)',
      );
      return 'NOT_PENDING';
    }
    if (isProfessionalAuthored(current.generatedBy) && !overrideProfessionalEdit) {
      return 'EDITED_MEANWHILE';
    }

    const loaded = await loadGenerationContext(
      this.db,
      this.cipher,
      userId,
      current.anamnesisSessionId,
    );
    if (!loaded) {
      this.logger.warn(
        { userId, protocolId },
        'usuário/anamnese não encontrados — regeração encerrada',
      );
      return 'NOT_FOUND';
    }

    const constraints = constraintsFromAnamnesis(loaded);
    const plan = await planProtocol(
      this.generator,
      this.validation,
      {
        userId,
        user: { name: loaded.name, phoneNumber: loaded.phoneNumber, email: loaded.email },
        constraints,
      },
      this.logger,
    );

    if (plan.usedFallbackTemplate) {
      this.logger.warn(
        {
          event: 'protocol_regeneration_fell_back',
          userId,
          protocolId,
          validationAction: plan.validationAction,
          violations: plan.violations,
        },
        'regeração caiu no template de fallback — protocolo atual mantido',
      );
      return 'FALLBACK_AGAIN';
    }

    // Decisão `MANDATORY` × `OPTIONAL` pela mesma política da geração: PAR-Q bloqueante ou
    // template → obrigatória; o resto → opcional (com a janela de 24h para o RT revisar).
    const reviewUrgency = reviewUrgencyForPlan(plan, constraints.requiresProfessionalReview);
    const totalWeeks = plan.content.phaseDurationWeeks;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + totalWeeks * MS_PER_WEEK);

    const written = await this.db.runAsUser(userId, 'USER', async (tx) => {
      const [row] = await tx
        .select({
          status: protocols.status,
          approvalStatus: protocols.approvalStatus,
          generatedBy: protocols.generatedBy,
          mesocycleNumber: protocols.mesocycleNumber,
          content: protocols.content,
        })
        .from(protocols)
        .where(eq(protocols.id, protocolId))
        .for('update')
        .limit(1);
      // A geração leva minutos: reconfere o estado AGORA, sob lock. Assinado, auto-liberado
      // ou editado pelo RT nesse intervalo → não pisa em cima.
      if (!row || row.status !== 'PENDING_SIGNATURE' || row.approvalStatus !== 'PENDING_REVIEW') {
        return 'NOT_PENDING' as const;
      }
      if (isProfessionalAuthored(row.generatedBy) && !overrideProfessionalEdit) {
        return 'EDITED_MEANWHILE' as const;
      }
      await tx
        .update(protocols)
        .set({
          content: plan.content,
          // Constraints COMPLETAS: é o que a assinatura revalida (no caminho de DLQ elas
          // ficaram na forma mínima do fallback).
          constraints: { ...constraints, contextualQuality: plan.contextualQuality },
          parQFlags: constraints.parqTags,
          totalWeeks,
          mesocycleName: mesocycleName(row.mesocycleNumber, plan.content.phase),
          startDate,
          endDate,
          generatedBy: plan.generatedBy,
          modelVersion: plan.modelVersion,
          promptVersion: plan.promptVersion,
          knowledgeSources: plan.knowledgeSources,
          methodologyVersionId: plan.methodologyVersionId,
          methodologySha256: plan.methodologySha256,
          reviewUrgency,
          // Conteúdo novo: a janela de revisão (e o relógio exibido no painel) recomeça agora.
          createdAt: startDate,
          status: 'PENDING_SIGNATURE',
          approvalStatus: 'PENDING_REVIEW',
          humanReviewRequired: true,
          professionalId: null,
          signedAt: null,
          signatureHash: null,
          pdfContent: null,
        })
        .where(eq(protocols.id, protocolId));
      this.logger.info(
        {
          event: 'protocol_regenerated',
          userId,
          protocolId,
          requestedBy,
          previousOrigin: row.generatedBy,
          beforeHash: signatureHash(row.content as ProtocolStructure),
          afterHash: signatureHash(plan.content),
        },
        'conteúdo do protocolo regerado',
      );
      return 'REGENERATED' as const;
    });
    if (written !== 'REGENERATED') return written;

    await this.rescheduleAutoRelease(userId, protocolId, reviewUrgency);
    this.logger.info(
      {
        userId,
        protocolId,
        reviewUrgency,
        validationAction: plan.validationAction,
        deterministicRepairs: plan.repairs,
        parqTriggered: constraints.parqTriggered,
      },
      reviewUrgency === 'OPTIONAL'
        ? 'protocolo regerado — Revisão Humana Opcional, auto-liberação em 24h'
        : 'protocolo regerado — segue Revisão Humana Obrigatória (só sai por assinatura CREF)',
    );
    return 'REGENERATED';
  }

  /** Estado atual da linha, para decidir se vale gastar uma geração. `null` se não existe. */
  private async readPending(userId: string, protocolId: string) {
    return this.db.runAsUser(userId, 'USER', async (tx) => {
      const [row] = await tx
        .select({
          status: protocols.status,
          approvalStatus: protocols.approvalStatus,
          anamnesisSessionId: protocols.anamnesisSessionId,
          generatedBy: protocols.generatedBy,
        })
        .from(protocols)
        .where(eq(protocols.id, protocolId))
        .limit(1);
      if (!row) return null;
      return {
        pending: row.status === 'PENDING_SIGNATURE' && row.approvalStatus === 'PENDING_REVIEW',
        statusLabel: `${row.status}/${row.approvalStatus}`,
        anamnesisSessionId: row.anamnesisSessionId,
        generatedBy: row.generatedBy,
      };
    });
  }

  /**
   * A janela de 24h recomeça com o conteúdo novo: tira o job da geração anterior (se ainda
   * estiver agendado — senão ele liberaria o conteúdo novo antes do prazo exibido) e, quando
   * a revisão é opcional, agenda um novo. `MANDATORY` nunca agenda.
   */
  private async rescheduleAutoRelease(
    userId: string,
    protocolId: string,
    reviewUrgency: 'MANDATORY' | 'OPTIONAL',
  ): Promise<void> {
    try {
      // Varre os agendados do protocolo (o id original, os de regerações anteriores e os de
      // scripts operacionais) — o delay de uma geração velha não pode liberar o conteúdo novo.
      const scheduled = await this.queues.get(QUEUE.protocolAutoRelease).getJobs(['delayed']);
      await Promise.all(
        scheduled
          .filter(
            (candidate) => (candidate.data as { protocolId?: string }).protocolId === protocolId,
          )
          .map((candidate) => candidate.remove()),
      );
    } catch (err) {
      // Job que começou a rodar não se remove; o `autoRelease` do repositório é idempotente por estado.
      this.logger.warn(
        { protocolId, err: err instanceof Error ? err.message : String(err) },
        'não foi possível remover a auto-liberação anterior do protocolo',
      );
    }
    if (reviewUrgency !== 'OPTIONAL') return;
    await this.queues.enqueue(
      QUEUE.protocolAutoRelease,
      'auto-release',
      { userId, protocolId },
      {
        delay: PROTOCOL_OPTIONAL_REVIEW_WINDOW_MS,
        // Id único: o `auto-release-<id>` original pode ainda existir (concluído/ativo).
        jobId: `auto-release-${protocolId}-regen-${Date.now()}`,
      },
    );
  }
}
