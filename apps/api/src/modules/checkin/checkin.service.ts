import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';

import { HealthCipherService } from '../../core/database/health-cipher.service';
import { HealthConsentService } from '../../core/database/health-consent.service';
import {
  checkins,
  handoffAlerts,
  protocols,
  reengagementNudges,
  subscriptions,
} from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkoutCompletionService } from '../workout/workout-completion.service';
import type { WhatsappOutboundJob } from '../jobs/whatsapp-outbound.contract';

const responseStateSchema = z.object({
  fatigue: z.enum(['LEVE', 'ADEQUADO', 'PESADO']).optional(),
  workouts: z.enum(['NENHUM', 'UM_DOIS', 'TRES_MAIS']).optional(),
  adjustment: z.enum(['REDUZIR', 'MANTER', 'AUMENTAR']).optional(),
  painReport: z.string().max(4096).optional(),
});
type ResponseState = z.infer<typeof responseStateSchema>;

const buttonSchema = z
  .string()
  .regex(/^checkin:([0-9a-f-]{36}):(fatigue|workouts|adjustment):([A-Z_]+)$/i);
// Semente conservadora do MVP; o responsavel tecnico deve ratificar termos/limiar
// antes da producao. Negacoes explicitas sao removidas para evitar "sem dor".
const SAFETY_SIGNAL =
  /\b(dor|doendo|latejando|fisgada|pontada)\b|\b(desconforto|incomodo)\b.{0,24}\b(forte|intenso|anormal)\b|\b(forte|intenso|anormal)\b.{0,24}\b(desconforto|incomodo)\b/i;
const NEGATED_SAFETY =
  /\b(?:sem|nenhuma?|nao\s+(?:sinto|tenho|estou\s+com))\s+(?:dor|desconforto|incomodo)(?:\s+(?:no|na|nos|nas)\s+(?:joelho|ombro|coluna|lombar|quadril|tornozelo|cotovelo|punho))?/gi;

@Injectable()
export class CheckinService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly cipher: HealthCipherService,
    private readonly healthConsent: HealthConsentService,
    private readonly queues: QueueManager,
    private readonly queueEvents: DashboardQueueEventsService,
    private readonly workoutCompletions: WorkoutCompletionService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CheckinService.name);
  }

  /** Intercepta somente respostas deterministicas de check-in; o restante segue ao Coach. */
  async tryHandleInbound(
    userId: string,
    buttonId: string | undefined,
    text: string,
  ): Promise<boolean> {
    if (!(await this.healthConsent.hasActiveForUser(userId))) return true;

    if (buttonId === 'checkin:anticipated' || /\bcheck[- ]?in\b.*\b(agora|antecip)/i.test(text)) {
      await this.startAnticipated(userId);
      return true;
    }

    if (buttonId && buttonSchema.safeParse(buttonId).success) {
      await this.handleButton(userId, buttonId);
      return true;
    }

    if (this.hasSafetySignal(text)) {
      const open = await this.findOpen(userId);
      if (!open) return false;
      await this.handlePain(userId, open.id, text);
      return true;
    }
    return false;
  }

  async startAnticipated(userId: string): Promise<void> {
    if (!(await this.healthConsent.hasActiveForUser(userId))) return;
    const eligible = await this.db.runAsUser(userId, 'USER', async (tx) => {
      const [row] = await tx
        .select({
          protocolId: protocols.id,
          createdAt: protocols.createdAt,
          totalWeeks: protocols.totalWeeks,
        })
        .from(protocols)
        .innerJoin(subscriptions, eq(subscriptions.userId, protocols.userId))
        .where(
          and(
            eq(protocols.userId, userId),
            eq(protocols.status, 'ACTIVE'),
            eq(subscriptions.status, 'ACTIVE'),
          ),
        )
        .orderBy(desc(protocols.createdAt))
        .limit(1);
      return row;
    });
    if (!eligible) return;
    const weekNumber = this.weekNumber(eligible.createdAt, eligible.totalWeeks);
    await this.queues.enqueue(
      QUEUE.checkinWeekly,
      'checkin-anticipated',
      { kind: 'SEND', userId, protocolId: eligible.protocolId, weekNumber },
      { jobId: `checkin-send-${userId}-${eligible.protocolId}-${weekNumber}` },
    );
  }

  /** Cria o registro antes do outbound: UNIQUE garante idempotencia mesmo com failover. */
  async createAndSend(
    userId: string,
    protocolId: string,
    weekNumber: number,
  ): Promise<'SENT' | 'EXISTS' | 'NO_CONSENT'> {
    if (!(await this.healthConsent.hasActiveForUser(userId))) return 'NO_CONSENT';
    const stateCipher = await this.cipher.encryptHealth(JSON.stringify({} satisfies ResponseState));
    const pending = await this.db.runAsSystem(async (tx) => {
      const [row] = await tx
        .insert(checkins)
        .values({ userId, protocolId, weekNumber, responsesCipher: stateCipher })
        .onConflictDoNothing()
        .returning({ id: checkins.id, sentAt: checkins.sentAt });
      if (row) return { ...row, inserted: true };
      const [existing] = await tx
        .select({ id: checkins.id, sentAt: checkins.sentAt })
        .from(checkins)
        .where(
          and(
            eq(checkins.userId, userId),
            eq(checkins.protocolId, protocolId),
            eq(checkins.weekNumber, weekNumber),
          ),
        )
        .limit(1);
      return existing ? { ...existing, inserted: false } : undefined;
    });
    if (!pending || pending.sentAt) return 'EXISTS';

    await this.outbound({
      userId,
      type: 'CHECKIN_MESSAGE',
      dedupeId: `${pending.id}-q1`,
      text: 'Mais uma semana de movimento concluida. O profissional CREF da MOVIVO acompanha suas respostas. Como o treino pareceu nesta semana?',
      buttons: [
        { id: `checkin:${pending.id}:fatigue:LEVE`, title: 'Leve' },
        { id: `checkin:${pending.id}:fatigue:ADEQUADO`, title: 'Na medida' },
        { id: `checkin:${pending.id}:fatigue:PESADO`, title: 'Muito pesado' },
      ],
    });
    await this.db.runAsSystem((tx) =>
      tx.update(checkins).set({ sentAt: new Date() }).where(eq(checkins.id, pending.id)),
    );
    this.logger.info(
      { event: 'checkin_sent', userId, checkinId: pending.id, recovered: !pending.inserted },
      'check-in semanal enfileirado',
    );
    return 'SENT';
  }

  private async handleButton(userId: string, buttonId: string): Promise<void> {
    const [, checkinId, field, rawValue] = buttonId.split(':');
    if (!checkinId || !field || !rawValue) return;
    const row = await this.loadOwned(userId, checkinId);
    if (!row || row.completedAt) return;
    const expectedField =
      row.currentQuestion === 1
        ? 'fatigue'
        : row.currentQuestion === 2
          ? 'workouts'
          : row.currentQuestion === 3
            ? 'adjustment'
            : undefined;
    if (field !== expectedField) return;

    const state = await this.decrypt(row.responsesCipher);
    const next: ResponseState = { ...state, [field]: rawValue };
    const parsed = responseStateSchema.safeParse(next);
    if (!parsed.success) return;
    const cipher = await this.cipher.encryptHealth(JSON.stringify(parsed.data));

    const nextQuestion = field === 'fatigue' ? 2 : field === 'workouts' ? 3 : 4;
    const completedAt = nextQuestion === 4 ? new Date() : null;
    const advanced = await this.db.runAsUser(userId, 'USER', async (tx) => {
      const [updated] = await tx
        .update(checkins)
        .set({
          responsesCipher: cipher,
          respondedAt: new Date(),
          currentQuestion: nextQuestion,
          completedAt,
        })
        .where(
          and(
            eq(checkins.id, checkinId),
            eq(checkins.userId, userId),
            eq(checkins.currentQuestion, row.currentQuestion),
          ),
        )
        .returning({ id: checkins.id });
      if (!updated) return false;
      await tx
        .update(reengagementNudges)
        .set({ respondedAt: new Date() })
        .where(and(eq(reengagementNudges.userId, userId), isNull(reengagementNudges.respondedAt)));
      return true;
    });
    if (!advanced) return;

    if (nextQuestion === 2) await this.askWorkouts(userId, checkinId);
    else if (nextQuestion === 3) await this.askAdjustment(userId, checkinId);
    else await this.complete(userId, checkinId, parsed.data);
  }

  private async askWorkouts(userId: string, checkinId: string): Promise<void> {
    await this.outbound({
      userId,
      type: 'CHECKIN_MESSAGE',
      dedupeId: `${checkinId}-q2`,
      text: 'Quantos treinos voce concluiu desde o ultimo check-in?',
      buttons: [
        { id: `checkin:${checkinId}:workouts:NENHUM`, title: 'Nenhum' },
        { id: `checkin:${checkinId}:workouts:UM_DOIS`, title: '1 ou 2' },
        { id: `checkin:${checkinId}:workouts:TRES_MAIS`, title: '3 ou mais' },
      ],
    });
  }

  private async askAdjustment(userId: string, checkinId: string): Promise<void> {
    await this.outbound({
      userId,
      type: 'CHECKIN_MESSAGE',
      dedupeId: `${checkinId}-q3`,
      text: 'O que voce gostaria que o profissional CREF considerasse para a proxima semana?',
      buttons: [
        { id: `checkin:${checkinId}:adjustment:REDUZIR`, title: 'Mais leve' },
        { id: `checkin:${checkinId}:adjustment:MANTER`, title: 'Manter' },
        { id: `checkin:${checkinId}:adjustment:AUMENTAR`, title: 'Mais desafio' },
      ],
    });
  }

  private async complete(userId: string, checkinId: string, state: ResponseState): Promise<void> {
    // US-8.1 / TASK-8.1.4 — fallback de captura de treino. Nenhuma pergunta nova foi
    // acrescentada ao check-in: a resposta `workouts` que ele JA coleta vira contagem
    // em `workout_completions`. O que o quick reply diario ja registrou permanece —
    // `WHATSAPP_QUICK_REPLY` tem precedencia sobre `CHECKIN` no dedupe.
    await this.workoutCompletions.recordFromCheckin(userId, state.workouts);

    const recurringLow = await this.hasPreviousLowAdherence(userId, checkinId, state.workouts);
    if (state.adjustment !== 'MANTER' || recurringLow || state.fatigue === 'PESADO') {
      await this.createAlert(
        userId,
        checkinId,
        'ALERT',
        recurringLow ? 'CHECKIN_BAIXA_ADERENCIA' : 'CHECKIN_REVISAO',
      );
    }
    await this.outbound({
      userId,
      type: 'CHECKIN_MESSAGE',
      dedupeId: `${checkinId}-done`,
      text: 'Respostas recebidas. Nenhuma mudanca e feita automaticamente. O contexto foi registrado para supervisao do profissional CREF da MOVIVO.',
    });
    this.logger.info({ event: 'checkin_responded', userId, checkinId }, 'check-in concluido');
  }

  private async handlePain(userId: string, checkinId: string, text: string): Promise<void> {
    const persisted = await this.db.runAsUser(userId, 'USER', async (tx) => {
      const [row] = await tx
        .select({ responsesCipher: checkins.responsesCipher })
        .from(checkins)
        .where(and(eq(checkins.id, checkinId), eq(checkins.userId, userId)))
        .for('update')
        .limit(1);
      if (!row) return false;
      const state = await this.decrypt(row.responsesCipher);
      const cipher = await this.cipher.encryptHealth(
        JSON.stringify({ ...state, painReport: text }),
      );
      await tx
        .update(checkins)
        .set({ responsesCipher: cipher, respondedAt: new Date() })
        .where(eq(checkins.id, checkinId));
      await tx
        .insert(handoffAlerts)
        .values({
          userId,
          level: 'SAFETY',
          reason: 'CHECKIN_DOR_ARTICULAR',
          sourceType: 'CHECKIN',
          sourceId: checkinId,
        })
        .onConflictDoNothing();
      return true;
    });
    if (!persisted) return;
    this.queueEvents.emit('checkin');
    await this.outbound({
      userId,
      type: 'CHECKIN_MESSAGE',
      dedupeId: `${checkinId}-safety`,
      text: 'Pare o treino agora e procure avaliacao presencial de um profissional habilitado ou servico de saude. Seu relato foi encaminhado para supervisao profissional. Nao retome este exercicio ate receber orientacao presencial.',
    });
    this.logger.warn(
      { event: 'checkin_safety_handoff', userId, checkinId },
      'relato de dor roteado para SAFETY',
    );
  }

  private async createAlert(
    userId: string,
    checkinId: string,
    level: 'ALERT' | 'SAFETY',
    reason: string,
  ): Promise<void> {
    await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .insert(handoffAlerts)
        .values({ userId, level, reason, sourceType: 'CHECKIN', sourceId: checkinId })
        .onConflictDoNothing(),
    );
    this.queueEvents.emit('checkin');
  }

  private async hasPreviousLowAdherence(
    userId: string,
    currentId: string,
    current: ResponseState['workouts'],
  ): Promise<boolean> {
    if (current === 'TRES_MAIS') return false;
    const rows = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({ id: checkins.id, responsesCipher: checkins.responsesCipher })
        .from(checkins)
        .where(and(eq(checkins.userId, userId), eq(checkins.currentQuestion, 4)))
        .orderBy(desc(checkins.completedAt))
        .limit(2),
    );
    const previous = rows.find((row) => row.id !== currentId);
    if (!previous) return false;
    const state = await this.decrypt(previous.responsesCipher);
    return state.workouts !== undefined && state.workouts !== 'TRES_MAIS';
  }

  private async findOpen(userId: string) {
    const [row] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({ id: checkins.id, responsesCipher: checkins.responsesCipher })
        .from(checkins)
        .where(and(eq(checkins.userId, userId), isNull(checkins.completedAt)))
        .orderBy(desc(checkins.createdAt))
        .limit(1),
    );
    return row;
  }

  private async loadOwned(userId: string, checkinId: string) {
    const [row] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({
          id: checkins.id,
          responsesCipher: checkins.responsesCipher,
          completedAt: checkins.completedAt,
          currentQuestion: checkins.currentQuestion,
        })
        .from(checkins)
        .where(and(eq(checkins.id, checkinId), eq(checkins.userId, userId)))
        .limit(1),
    );
    return row;
  }

  private async decrypt(cipher: Buffer | null): Promise<ResponseState> {
    if (!cipher) return {};
    return responseStateSchema.parse(JSON.parse(await this.cipher.decryptHealth(cipher)));
  }

  private async outbound(job: WhatsappOutboundJob): Promise<void> {
    await this.queues.enqueue(QUEUE.whatsappOutbound, 'checkin-message', job, {
      jobId: `wa-${job.userId}-${job.dedupeId}`,
    });
  }

  weekNumber(createdAt: Date, totalWeeks: number): number {
    const elapsed = Math.floor((Date.now() - createdAt.getTime()) / (7 * 24 * 60 * 60 * 1000));
    return Math.min(Math.max(elapsed + 1, 1), totalWeeks);
  }

  private hasSafetySignal(text: string): boolean {
    const normalized = text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(NEGATED_SAFETY, ' ');
    return SAFETY_SIGNAL.test(normalized);
  }
}
