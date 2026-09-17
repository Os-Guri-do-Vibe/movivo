/**
 * `CheckinService` — check-in semanal por formulário web (achado 2026-09-13, substitui o
 * fluxo de botão de WhatsApp: ver o cabeçalho de `checkins.ts` para o porquê).
 *
 * Envio único, sem retomada por etapa — diferente da renovação de mesociclo, o aluno
 * responde as 8 perguntas numa visita e envia tudo junto no final. Toda a reação (comentário
 * da IA, ajuste de volume, sugestão de substituição) é assíncrona, disparada por
 * `CheckinWeeklyFeedbackWorker` (`CoachModule`) — este serviço só persiste e enfileira.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { checkinWeeklySubmitSchema, type CheckinWeeklySubmit } from '@movivo/shared';

import { AppConfigService } from '../../core/config';
import { HealthCipherService } from '../../core/database/health-cipher.service';
import { HealthConsentService } from '../../core/database/health-consent.service';
import { checkins, handoffAlerts, users } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { ShortLinkService } from '../short-link/short-link.service';
import { checkinWeeklyInviteMessage, checkinWeeklyNudgeMessage } from './checkin-messages';

/** TTL do formulário — cobre a semana inteira até o próximo disparo. */
export const CHECKIN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Abaixo disto, mesmo sem pedir ajuste, o profissional CREF é avisado (baixa aderência). Usado
 * por `CheckinWeeklyFeedbackWorker`, não por este serviço. */
export const LOW_ADHERENCE_ALERT_THRESHOLD = 4;

export interface CheckinWeeklySessionView {
  status: 'PENDING' | 'SUBMITTED' | 'EXPIRED';
  firstName: string | null;
  weekNumber: number;
}

function opaqueToken(): string {
  return randomBytes(32).toString('hex');
}

type CheckinRow = typeof checkins.$inferSelect;

@Injectable()
export class CheckinService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly config: AppConfigService,
    private readonly cipher: HealthCipherService,
    private readonly healthConsent: HealthConsentService,
    private readonly queues: QueueManager,
    private readonly queueEvents: DashboardQueueEventsService,
    private readonly shortLinks: ShortLinkService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CheckinService.name);
  }

  /** Cria o registro antes do outbound: UNIQUE garante idempotência mesmo com failover. */
  async createAndSend(
    userId: string,
    protocolId: string,
    weekNumber: number,
    firstName: string | null,
    reason: 'INVITE' | 'NUDGE' = 'INVITE',
  ): Promise<'SENT' | 'EXISTS' | 'NO_CONSENT'> {
    if (!(await this.healthConsent.hasActiveForUser(userId))) return 'NO_CONSENT';
    const expiresAt = new Date(Date.now() + CHECKIN_TTL_MS);
    const insertToken = opaqueToken();
    const created = await this.db.runAsSystem(async (tx) => {
      const [row] = await tx
        .insert(checkins)
        .values({ userId, protocolId, weekNumber, token: insertToken, expiresAt })
        .onConflictDoNothing()
        .returning({ id: checkins.id });
      return row;
    });

    let checkinId: string;
    let token: string;
    if (created) {
      checkinId = created.id;
      token = insertToken;
    } else {
      // Já existe um check-in desta semana. `PENDING` = o aluno nunca abriu (reengajamento
      // reenvia) — gira um TOKEN NOVO (mesmo racional do reconvite de renovação de
      // mesociclo: `dedupeId`/`jobId` levam o token, então nunca colidem com o job do
      // convite anterior já processado pelo BullMQ). Qualquer outro status: não reenvia.
      const [existing] = await this.db.runAsSystem((tx) =>
        tx
          .select({ id: checkins.id, status: checkins.status })
          .from(checkins)
          .where(
            and(
              eq(checkins.userId, userId),
              eq(checkins.protocolId, protocolId),
              eq(checkins.weekNumber, weekNumber),
            ),
          )
          .limit(1),
      );
      if (!existing || existing.status !== 'PENDING') return 'EXISTS';
      token = opaqueToken();
      checkinId = existing.id;
      await this.db.runAsSystem((tx) =>
        tx.update(checkins).set({ token, expiresAt }).where(eq(checkins.id, checkinId)),
      );
    }

    const longLink = `${this.config.whatsapp.publicSiteUrl}/checkin-semanal/${token}`;
    const code = await this.shortLinks.create(longLink, expiresAt);
    const link = `${this.config.whatsapp.publicSiteUrl}/semana/${code}`;

    const text =
      reason === 'NUDGE'
        ? checkinWeeklyNudgeMessage(link)
        : checkinWeeklyInviteMessage(firstName, link);
    await this.queues.enqueue(
      QUEUE.whatsappOutbound,
      'checkin-message',
      {
        userId,
        type: 'CHECKIN_MESSAGE',
        dedupeId: `checkin-invite-${checkinId}-${token}`,
        text,
      },
      { jobId: `wa-checkin-invite-${checkinId}-${token}` },
    );
    await this.db.runAsSystem((tx) =>
      tx.update(checkins).set({ sentAt: new Date() }).where(eq(checkins.id, checkinId)),
    );
    this.logger.info({ event: 'checkin_sent', userId, checkinId }, 'check-in semanal enfileirado');
    return 'SENT';
  }

  /** `GET /checkin/session/{token}`. */
  async getByToken(token: string): Promise<CheckinWeeklySessionView> {
    const row = await this.selectByTokenAsSystem(token);
    if (!row) throw new NotFoundException('Check-in não encontrado.');
    if (this.isExpired(row.status, row.expiresAt)) {
      await this.expire(row.userId, row.id);
      return this.toView({ ...row, status: 'EXPIRED' });
    }
    return this.toView(row);
  }

  /** `POST /checkin/session/{token}/submit`. */
  async submit(token: string, payload: unknown): Promise<{ status: 'SUBMITTED' }> {
    const row = await this.requirePending(token);
    if (!(await this.healthConsent.hasActiveForUser(row.userId))) {
      throw new ForbiddenException('Consentimento de dados de saúde revogado.');
    }
    const parsed = checkinWeeklySubmitSchema.safeParse(payload);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((issue) => issue.message));
    }
    const data = parsed.data;

    const answers = {
      sleepQuality: data.sleepQuality,
      mood: data.mood,
      nutritionScore: data.nutritionScore,
      adherenceScore: data.adherenceScore,
      changesNoticed: data.changesNoticed,
      changesOther: data.changesOther,
      durationFit: data.durationFit,
      hasDifficultExercise: Boolean(data.difficultExerciseDescription?.trim()),
    };
    const notesCipher = await this.cipher.encryptHealth(
      JSON.stringify({
        difficultExerciseDescription: data.difficultExerciseDescription,
        improvementFeedback: data.improvementFeedback,
      } satisfies Pick<
        CheckinWeeklySubmit,
        'difficultExerciseDescription' | 'improvementFeedback'
      >),
    );
    const submittedAt = new Date();

    await this.db.runAsUser(row.userId, 'USER', (tx) =>
      tx
        .update(checkins)
        .set({ status: 'SUBMITTED', submittedAt, answers, notesCipher })
        .where(eq(checkins.id, row.id)),
    );

    await this.queues.enqueue(QUEUE.checkinWeeklyFeedback, 'checkin-weekly-feedback', {
      userId: row.userId,
      checkinId: row.id,
    });
    this.queueEvents.emit('checkin');
    this.logger.info(
      { event: 'checkin_submitted', userId: row.userId, checkinId: row.id },
      'check-in semanal enviado',
    );
    return { status: 'SUBMITTED' };
  }

  weekNumber(createdAt: Date, totalWeeks: number): number {
    const elapsed = Math.floor((Date.now() - createdAt.getTime()) / (7 * 24 * 60 * 60 * 1000));
    return Math.min(Math.max(elapsed + 1, 1), totalWeeks);
  }

  /** @internal usado por `CheckinScheduler.enqueueNudgeIfDue`. */
  async lastSentOrRespondedAt(userId: string): Promise<Date | undefined> {
    const [last] = await this.db.runAsSystem((tx) =>
      tx
        .select({ sentAt: checkins.sentAt, submittedAt: checkins.submittedAt })
        .from(checkins)
        .where(eq(checkins.userId, userId))
        .orderBy(desc(checkins.sentAt))
        .limit(1),
    );
    return last?.submittedAt ?? last?.sentAt ?? undefined;
  }

  private async requirePending(token: string): Promise<CheckinRow> {
    const row = await this.selectByTokenAsSystem(token);
    if (!row) throw new NotFoundException('Check-in não encontrado.');
    if (this.isExpired(row.status, row.expiresAt)) {
      await this.expire(row.userId, row.id);
      throw new GoneException('Este check-in expirou.');
    }
    if (row.status !== 'PENDING') {
      throw new ConflictException('Este check-in já foi enviado.');
    }
    return row;
  }

  private async selectByTokenAsSystem(token: string): Promise<CheckinRow | undefined> {
    const [row] = await this.db.runAsSystem((tx) =>
      tx.select().from(checkins).where(eq(checkins.token, token)).limit(1),
    );
    return row;
  }

  private isExpired(status: string, expiresAt: Date): boolean {
    return status === 'PENDING' && expiresAt.getTime() < Date.now();
  }

  private async expire(userId: string, id: string): Promise<void> {
    await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .update(checkins)
        .set({ status: 'EXPIRED' })
        .where(and(eq(checkins.id, id), eq(checkins.status, 'PENDING'))),
    );
  }

  private async toView(row: CheckinRow): Promise<CheckinWeeklySessionView> {
    const [self] = await this.db.runAsUser(row.userId, 'USER', (tx) =>
      tx.select({ name: users.name }).from(users).where(eq(users.id, row.userId)).limit(1),
    );
    return {
      status: row.status,
      firstName: self?.name?.trim().split(/\s+/)[0] ?? null,
      weekNumber: row.weekNumber,
    };
  }
}

/** Alertas que a submissão do check-in pode gerar — usado pelo worker de comentário da IA. */
export async function createCheckinAlert(
  db: TenantDatabase,
  queueEvents: DashboardQueueEventsService,
  userId: string,
  checkinId: string,
  level: 'ALERT' | 'SAFETY',
  reason: string,
): Promise<void> {
  await db.runAsUser(userId, 'USER', (tx) =>
    tx
      .insert(handoffAlerts)
      .values({ userId, level, reason, sourceType: 'CHECKIN', sourceId: checkinId })
      .onConflictDoNothing(),
  );
  queueEvents.emit('checkin');
}
