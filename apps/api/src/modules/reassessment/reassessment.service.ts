/**
 * Reavaliação de fim de ciclo — abertura e resposta.
 *
 * No dia em que o protocolo vence, o aluno recebe um link (WhatsApp) para um formulário com
 * perguntas úteis e avaliativas. A resposta é cifrada, as medidas entram na evolução e a análise
 * dos agentes + o próximo protocolo seguem em segundo plano (`CycleRenewalService`).
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import {
  cycleReassessmentAnswersSchema,
  type CycleReassessmentAnswers,
  type CycleReassessmentView,
} from '@movivo/shared';

import { HealthCipherService } from '../../core/database/health-cipher.service';
import {
  bodyMeasurements,
  cycleReassessments,
  nutritionPlans,
  trainingPlans,
} from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { EvolutionService } from '../checkin-v2/evolution.service';
import { ConversationStore } from '../conversation/conversation-store';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { todayIn } from '../planning/plan-generation.service';
import { AgentMessenger } from '../progress/agent-messenger';
import { StudentMemoryService } from '../student-state/student-memory.service';
import { ReassessmentPhotosService } from './reassessment-photos.service';
import { TrainingLinkService } from '../training/training-link.service';
import { lastDayOfCycle, nutritionLastDay, reassessmentDue } from './cycle-end';

export type OpenResult =
  | { status: 'OPENED'; reassessmentId: string; cycleEndedOn: string }
  | { status: 'SKIPPED'; reason: 'NO_ACTIVE_PLAN' | 'NOT_DUE' | 'ALREADY_OPENED' };

export interface ReassessmentJob {
  kind: 'SCAN' | 'RENEW';
  userId?: string;
  reassessmentId?: string;
}

const clip = (text: string, size = 150) =>
  text.length > size ? `${text.slice(0, size - 1)}…` : text;

@Injectable()
export class ReassessmentService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly cipher: HealthCipherService,
    private readonly links: TrainingLinkService,
    private readonly messenger: AgentMessenger,
    private readonly store: ConversationStore,
    private readonly evolution: EvolutionService,
    private readonly memory: StudentMemoryService,
    private readonly photos: ReassessmentPhotosService,
    private readonly queues: QueueManager,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ReassessmentService.name);
  }

  /** Abre a reavaliação do aluno se o ciclo venceu e ainda não foi aberta. Idempotente por ciclo. */
  async openDue(
    userId: string,
    timezone: string | null,
    now: Date = new Date(),
  ): Promise<OpenResult> {
    const today = todayIn(timezone, now);
    const plans = await this.db.runAsUser(userId, 'USER', async (tx) => {
      const [training] = await tx
        .select({
          id: trainingPlans.id,
          startsOn: trainingPlans.startsOn,
          structure: trainingPlans.structure,
        })
        .from(trainingPlans)
        .where(and(eq(trainingPlans.userId, userId), eq(trainingPlans.status, 'ACTIVE')));
      const [nutrition] = await tx
        .select({ id: nutritionPlans.id, startsOn: nutritionPlans.startsOn })
        .from(nutritionPlans)
        .where(and(eq(nutritionPlans.userId, userId), eq(nutritionPlans.status, 'ACTIVE')));
      return { training, nutrition };
    });
    const lastDay = plans.training
      ? lastDayOfCycle(
          plans.training.startsOn,
          plans.training.structure.phases.map((phase) => phase.weeks),
        )
      : plans.nutrition
        ? nutritionLastDay(plans.nutrition.startsOn)
        : null;
    if (!lastDay) return { status: 'SKIPPED', reason: 'NO_ACTIVE_PLAN' };
    if (!reassessmentDue(today, lastDay)) return { status: 'SKIPPED', reason: 'NOT_DUE' };

    const [created] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .insert(cycleReassessments)
        .values({
          userId,
          trainingPlanId: plans.training?.id ?? null,
          nutritionPlanId: plans.nutrition?.id ?? null,
          cycleEndedOn: lastDay,
        })
        .onConflictDoNothing()
        .returning({ id: cycleReassessments.id }),
    );
    if (!created) return { status: 'SKIPPED', reason: 'ALREADY_OPENED' };

    const { firstName } = await this.store.loadUser(userId);
    const link = await this.links.shortUrl(userId, { next: '/reavaliacao' });
    await this.messenger.send(
      userId,
      [
        `${firstName ? `Oi, ${firstName}! ` : 'Oi! '}Hoje fecha mais um ciclo do seu protocolo, e eu queria saber como foi essa fase pra você.`,
        `Leva uns 5 minutos e é com o que você contar (e tudo que já registrou) que a gente monta o próximo ciclo de treino e de alimentação do jeito certo: ${link}`,
      ],
      `cycle_reassessment_${created.id}`,
    );
    this.logger.info(
      { event: 'cycle_reassessment_opened', userId, cycleEndedOn: lastDay },
      'reavaliação de ciclo aberta',
    );
    return { status: 'OPENED', reassessmentId: created.id, cycleEndedOn: lastDay };
  }

  /** A reavaliação em aberto (ou a última respondida) para a página do aluno. */
  async current(userId: string): Promise<CycleReassessmentView | null> {
    const { row, measurements } = await this.db.runAsUser(userId, 'USER', async (tx) => {
      const [latest] = await tx
        .select()
        .from(cycleReassessments)
        .where(eq(cycleReassessments.userId, userId))
        .orderBy(desc(cycleReassessments.cycleEndedOn))
        .limit(1);
      const rows = await tx
        .select({
          kind: bodyMeasurements.kind,
          value: bodyMeasurements.value,
          measuredOn: bodyMeasurements.measuredOn,
        })
        .from(bodyMeasurements)
        .where(eq(bodyMeasurements.userId, userId))
        .orderBy(asc(bodyMeasurements.measuredOn));
      return { row: latest, measurements: rows };
    });
    if (!row) return null;
    const latestByKind = new Map<string, { kind: string; value: number; measuredOn: string }>();
    for (const m of measurements) latestByKind.set(m.kind, m);
    const { firstName } = await this.store.loadUser(userId);
    return {
      id: row.id,
      photos: await this.photos.state(userId, row.id),
      status: row.status as CycleReassessmentView['status'],
      cycleEndedOn: row.cycleEndedOn,
      firstName,
      latestMeasurements: [...latestByKind.values()],
    };
  }

  async submit(
    userId: string,
    reassessmentId: string,
    answers: CycleReassessmentAnswers,
    now: Date = new Date(),
  ): Promise<void> {
    const encrypted = await this.cipher.encryptHealth(JSON.stringify(answers));
    const [updated] = await this.db.runAsUser(userId, 'USER', async (tx) => {
      const [existing] = await tx
        .select({ id: cycleReassessments.id, status: cycleReassessments.status })
        .from(cycleReassessments)
        .where(
          and(eq(cycleReassessments.id, reassessmentId), eq(cycleReassessments.userId, userId)),
        );
      if (!existing) throw new NotFoundException();
      if (existing.status !== 'SENT') throw new ConflictException('Reavaliação já respondida.');
      return tx
        .update(cycleReassessments)
        .set({ answers: encrypted, status: 'SUBMITTED', submittedAt: now })
        .where(
          and(
            eq(cycleReassessments.id, reassessmentId),
            eq(cycleReassessments.userId, userId),
            inArray(cycleReassessments.status, ['SENT']),
          ),
        )
        .returning({ id: cycleReassessments.id });
    });
    if (!updated) throw new ConflictException('Reavaliação já respondida.');

    await this.evolution.addMeasurements(userId, answers.measurements);
    await this.remember(userId, answers);
    await this.enqueueRenewal(userId, reassessmentId);
  }

  /** Entrega a análise e o próximo ciclo ao worker (também usado para retomar respostas paradas). */
  async enqueueRenewal(userId: string, reassessmentId: string): Promise<void> {
    const job: ReassessmentJob = { kind: 'RENEW', userId, reassessmentId };
    await this.queues.enqueue(QUEUE.cycleReassessment, 'renew', job, {
      jobId: `cycle-renew_${reassessmentId}`,
    });
  }

  /** Respostas que ficaram sem análise (falha ao enfileirar, reinício): o worker as retoma. */
  async stuckSubmissions(olderThanMs: number, now: Date = new Date()) {
    const cutoff = new Date(now.getTime() - olderThanMs);
    const rows = await this.db.runAsSystem((tx) =>
      tx
        .select({
          id: cycleReassessments.id,
          userId: cycleReassessments.userId,
          submittedAt: cycleReassessments.submittedAt,
        })
        .from(cycleReassessments)
        .where(eq(cycleReassessments.status, 'SUBMITTED')),
    );
    return rows.filter((row) => row.submittedAt !== null && row.submittedAt <= cutoff);
  }

  /** Respostas decifradas (para a análise). */
  async answersOf(userId: string, reassessmentId: string) {
    const [row] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select()
        .from(cycleReassessments)
        .where(
          and(eq(cycleReassessments.id, reassessmentId), eq(cycleReassessments.userId, userId)),
        ),
    );
    if (!row?.answers) return null;
    const answers = cycleReassessmentAnswersSchema.parse(
      JSON.parse(await this.cipher.decryptHealth(row.answers)),
    );
    return { row, answers };
  }

  /** O que o aluno contou vira memória durável: rotina nova, objetivo e o que atrapalhou. */
  private async remember(userId: string, answers: CycleReassessmentAnswers): Promise<void> {
    const items = [
      answers.routine.changed
        ? {
            kind: 'ROUTINE' as const,
            text: clip(
              `Rotina atual (reavaliação): ${[
                answers.routine.daysPerWeek ? `${answers.routine.daysPerWeek} dias por semana` : '',
                answers.routine.sessionMinutes
                  ? `${answers.routine.sessionMinutes} min por sessão`
                  : '',
                answers.routine.notes,
              ]
                .filter(Boolean)
                .join(', ')}`,
            ),
            importance: 3 as const,
            origin: 'REASSESSMENT' as const,
          }
        : null,
      !answers.goals.stillTheSame && answers.goals.notes
        ? {
            kind: 'MOTIVATION' as const,
            text: clip(`Objetivo novo (reavaliação): ${answers.goals.notes}`),
            importance: 3 as const,
            origin: 'REASSESSMENT' as const,
          }
        : null,
      answers.whatDidNot
        ? {
            kind: 'BARRIER' as const,
            text: clip(`O que atrapalhou na fase: ${answers.whatDidNot}`),
            importance: 2 as const,
            origin: 'REASSESSMENT' as const,
          }
        : null,
      answers.nutrition.newRestrictions
        ? {
            kind: 'PREFERENCE' as const,
            text: clip(`Restrição alimentar nova: ${answers.nutrition.newRestrictions}`),
            importance: 3 as const,
            origin: 'REASSESSMENT' as const,
          }
        : null,
    ].filter((item): item is NonNullable<typeof item> => item !== null);
    if (items.length === 0) return;
    try {
      await this.memory.apply(userId, items);
    } catch (error) {
      this.logger.warn({ userId, err: error }, 'memória da reavaliação não gravada');
    }
  }
}
