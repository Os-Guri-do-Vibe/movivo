/**
 * `ProtocolRenewalService` — formulário de troca de protocolo por fim de mesociclo.
 *
 * Mesmo padrão de salvamento de progresso do `AnamnesisService`, com duas diferenças
 * estruturais (ver `docs/.../renovacao-de-mesociclo` e o cabeçalho do schema):
 *  - o titular **já existe** — a sessão nasce com `userId` preenchido (o
 *    `ProtocolRenewalScheduler` cria a linha, não este serviço), então todo acesso aqui
 *    roda `runAsUser(session.userId, 'USER', ...)` depois do lookup inicial por token, e
 *    NUNCA a fase anônima/escopada por sessão que a anamnese precisa;
 *  - o token não é "consumido": TTL de 14 dias, reaberto de qualquer dispositivo até o
 *    submit ou a expiração (decisão do fundador — ver plano da feature).
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { and, desc, eq } from 'drizzle-orm';
import {
  anamnesisStructuredSchema,
  PROTOCOL_RENEWAL_STEP_SCHEMAS,
  type ProtocolRenewalBlock3,
} from '@movivo/shared';
import type { ZodType } from 'zod';

import { HealthCipherService } from '../../core/database/health-cipher.service';
import { HealthConsentService } from '../../core/database/health-consent.service';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { anamnesisSessions, handoffAlerts, protocolRenewalSessions, users } from '../../core/database/schema';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { evaluateRenewalSafety } from './protocol-renewal-safety';

export type RenewalStepNumber = 1 | 2 | 3 | 4 | 5;

export interface RenewalSessionView {
  status: string;
  currentStep: number;
  firstName: string | null;
  /** Controla a exibição da pergunta 18 (data-alvo) no Bloco 5. */
  hasTargetEvent: boolean;
  block1: unknown;
  block2: unknown;
  /** Nunca o conteúdo (dado de saúde) — só se o bloco já foi preenchido. */
  block3Completed: boolean;
  block4: unknown;
  block5: unknown;
  expiresAt: Date;
}

export interface RenewalSubmitResult {
  status: 'SUBMITTED';
}

function parseStepPayload<T>(schema: ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.issues.map((issue) => issue.message));
  }
  return parsed.data;
}

type SessionRow = typeof protocolRenewalSessions.$inferSelect;

@Injectable()
export class ProtocolRenewalService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly db: TenantDatabase,
    private readonly cipher: HealthCipherService,
    private readonly healthConsent: HealthConsentService,
    private readonly queues: QueueManager,
  ) {
    this.logger.setContext(ProtocolRenewalService.name);
  }

  /** `GET /protocol-renewal/session/{token}`. */
  async getByToken(token: string): Promise<RenewalSessionView> {
    const row = await this.selectByTokenAsSystem(token);
    if (!row) throw new NotFoundException('Sessão de renovação não encontrada.');

    if (this.isExpired(row.status, row.expiresAt)) {
      await this.expire(row.userId, row.id);
      return this.toView({ ...row, status: 'EXPIRED', dataBlock3: null }, row.userId);
    }
    return this.toView(row, row.userId);
  }

  /** `PATCH /protocol-renewal/session/{token}/step/{n}`. */
  async patchStep(
    token: string,
    step: RenewalStepNumber,
    data: unknown,
  ): Promise<{ currentStep: number }> {
    const row = await this.requireActiveSession(token);
    if (!(await this.healthConsent.hasActiveForUser(row.userId))) {
      throw new ForbiddenException('Consentimento de dados de saúde revogado.');
    }

    switch (step) {
      case 1: {
        const parsed = parseStepPayload(PROTOCOL_RENEWAL_STEP_SCHEMAS[1], data);
        await this.writeJsonb(row.userId, row.id, 'dataBlock1', parsed);
        break;
      }
      case 2: {
        const parsed = parseStepPayload(PROTOCOL_RENEWAL_STEP_SCHEMAS[2], data);
        await this.writeJsonb(row.userId, row.id, 'dataBlock2', parsed);
        break;
      }
      case 3: {
        const parsed = parseStepPayload(PROTOCOL_RENEWAL_STEP_SCHEMAS[3], data);
        await this.writeHealthBlock(row.userId, row.id, parsed);
        break;
      }
      case 4: {
        const parsed = parseStepPayload(PROTOCOL_RENEWAL_STEP_SCHEMAS[4], data);
        await this.writeJsonb(row.userId, row.id, 'dataBlock4', parsed);
        break;
      }
      case 5: {
        const parsed = parseStepPayload(PROTOCOL_RENEWAL_STEP_SCHEMAS[5], data);
        await this.writeJsonb(row.userId, row.id, 'dataBlock5', parsed);
        break;
      }
    }

    const currentStep = Math.min(Math.max(row.lastStep, step + 1), 5);
    await this.db.runAsUser(row.userId, 'USER', (tx) =>
      tx
        .update(protocolRenewalSessions)
        .set({ lastStep: currentStep })
        .where(eq(protocolRenewalSessions.id, row.id)),
    );
    return { currentStep };
  }

  /** `POST /protocol-renewal/session/{token}/submit`. */
  async submit(token: string): Promise<RenewalSubmitResult> {
    const row = await this.requireActiveSession(token);
    if (!row.dataBlock1 || !row.dataBlock2 || !row.dataBlock3 || !row.dataBlock4 || !row.dataBlock5) {
      throw new BadRequestException('Complete os 5 blocos antes de enviar.');
    }
    if (!(await this.healthConsent.hasActiveForUser(row.userId))) {
      throw new ForbiddenException('Consentimento de dados de saúde revogado.');
    }

    const block3 = await this.readHealthBlock(row.dataBlock3);
    const safety = evaluateRenewalSafety(block3);
    const submittedAt = new Date();

    await this.db.runAsUser(row.userId, 'USER', async (tx) => {
      await tx
        .update(protocolRenewalSessions)
        .set({ status: 'SUBMITTED', submittedAt })
        .where(eq(protocolRenewalSessions.id, row.id));

      if (safety.newPainNeedsHandoff) {
        await tx
          .insert(handoffAlerts)
          .values({
            userId: row.userId,
            level: 'ALERT',
            reason: 'RENOVACAO_DOR_NOVA',
            sourceType: 'PROTOCOL_RENEWAL',
            sourceId: row.id,
          })
          .onConflictDoNothing();
      }
    });

    // Gatilho do pipeline de geração do próximo mesociclo — enfileira SEMPRE. O gate de
    // segurança (pergunta 10) é aplicado no Worker, exatamente como o PAR-Q inicial é
    // aplicado em `ProtocolGenerationWorker`, não aqui.
    await this.queues.enqueue(QUEUE.protocolRenewalGeneration, 'generate-renewal-protocol', {
      userId: row.userId,
      renewalSessionId: row.id,
      submittedAt: submittedAt.toISOString(),
    });

    await this.queues.enqueue(
      QUEUE.whatsappOutbound,
      'renewal-confirmation',
      {
        userId: row.userId,
        type: safety.requiresProfessionalReview ? 'CONFIRMATION_CARE' : 'CONFIRMATION',
      },
      { jobId: `renewal-confirmation_${row.id}` },
    );

    this.logger.info(
      { event: 'protocol_renewal_submitted', renewalSessionId: row.id },
      'formulário de renovação de mesociclo enviado',
    );
    return { status: 'SUBMITTED' };
  }

  // --- helpers -------------------------------------------------------------

  private async requireActiveSession(token: string): Promise<SessionRow> {
    const row = await this.selectByTokenAsSystem(token);
    if (!row) throw new NotFoundException('Sessão de renovação não encontrada.');
    this.assertActive(row.userId, row.id, row.status, row.expiresAt);
    return row;
  }

  private async selectByTokenAsSystem(token: string): Promise<SessionRow | undefined> {
    // Lookup inicial por token: ainda não sabemos o `userId` para escopar por titular —
    // mesmo motivo estrutural do `runAsToken` da anamnese, só que aqui o titular já
    // existe desde a criação da linha (nunca é órfã), então basta `runAsSystem` para este
    // único SELECT; toda leitura/escrita seguinte já roda sob `runAsUser`.
    const [row] = await this.db.runAsSystem((tx) =>
      tx.select().from(protocolRenewalSessions).where(eq(protocolRenewalSessions.token, token)).limit(1),
    );
    return row;
  }

  private async writeJsonb(
    userId: string,
    sessionId: string,
    column: 'dataBlock1' | 'dataBlock2' | 'dataBlock4' | 'dataBlock5',
    value: unknown,
  ): Promise<void> {
    await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .update(protocolRenewalSessions)
        .set({ [column]: value })
        .where(eq(protocolRenewalSessions.id, sessionId)),
    );
  }

  private async readHealthBlock(ciphertext: Buffer | null): Promise<ProtocolRenewalBlock3> {
    if (!ciphertext) throw new BadRequestException('Bloco de segurança não preenchido.');
    const json = await this.cipher.decryptHealth(ciphertext);
    return PROTOCOL_RENEWAL_STEP_SCHEMAS[3].parse(JSON.parse(json));
  }

  private async writeHealthBlock(
    userId: string,
    sessionId: string,
    value: ProtocolRenewalBlock3,
  ): Promise<void> {
    const encrypted = await this.cipher.encryptHealth(JSON.stringify(value));
    await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .update(protocolRenewalSessions)
        .set({ dataBlock3: encrypted })
        .where(eq(protocolRenewalSessions.id, sessionId)),
    );
  }

  private isExpired(status: string, expiresAt: Date): boolean {
    return status === 'IN_PROGRESS' && expiresAt.getTime() < Date.now();
  }

  private assertActive(userId: string, id: string, status: string, expiresAt: Date): void {
    if (this.isExpired(status, expiresAt)) {
      this.expire(userId, id).catch((err: unknown) => {
        this.logger.warn({ err, renewalSessionId: id }, 'expire best-effort falhou');
      });
      throw new GoneException('Sessão de renovação expirada.');
    }
    if (status !== 'IN_PROGRESS') {
      throw new ConflictException('Este formulário de renovação já foi enviado.');
    }
  }

  private async expire(userId: string, id: string): Promise<void> {
    await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .update(protocolRenewalSessions)
        .set({ status: 'EXPIRED', dataBlock3: null })
        .where(and(eq(protocolRenewalSessions.id, id), eq(protocolRenewalSessions.status, 'IN_PROGRESS'))),
    );
  }

  private async toView(row: SessionRow, userId: string): Promise<RenewalSessionView> {
    const [self] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1),
    );
    const hasTargetEvent = await this.hasTargetEvent(userId);
    return {
      status: row.status,
      currentStep: row.lastStep,
      firstName: self?.name?.trim().split(/\s+/)[0] ?? null,
      hasTargetEvent,
      block1: row.dataBlock1 ?? null,
      block2: row.dataBlock2 ?? null,
      block3Completed: row.dataBlock3 != null,
      block4: row.dataBlock4 ?? null,
      block5: row.dataBlock5 ?? null,
      expiresAt: row.expiresAt,
    };
  }

  /**
   * A pergunta 18 só aparece se havia data-alvo declarada — sinal vem da anamnese
   * original (única por titular, independente de quantos mesociclos já se passaram; ver
   * `ProtocolRepository.findLatestPersonalInfo` para o mesmo racional de "sempre existe
   * exatamente uma anamnese SUBMITTED por titular").
   */
  private async hasTargetEvent(userId: string): Promise<boolean> {
    const [row] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({ dataBlock3: anamnesisSessions.dataBlock3 })
        .from(anamnesisSessions)
        .where(and(eq(anamnesisSessions.userId, userId), eq(anamnesisSessions.status, 'SUBMITTED')))
        .orderBy(desc(anamnesisSessions.submittedAt))
        .limit(1),
    );
    const parsed = anamnesisStructuredSchema.safeParse(row?.dataBlock3);
    return parsed.success && parsed.data.hasImportantEvent;
  }
}
