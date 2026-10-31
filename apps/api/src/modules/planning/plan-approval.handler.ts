/**
 * Publica o plano que o profissional aprovou na fila. A aprovação grava a decisão (`DecisionMade`,
 * decidida pela equipe); este consumidor ativa o rascunho, monta a agenda a partir de hoje e,
 * quando treino e alimentação estão ativos, envia o plano ao aluno. Idempotente: só ativa
 * rascunho, e a publicação automática (decisão do motor de políticas) não passa por aqui.
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import {
  coachingDecisions,
  coachingProposals,
  nutritionPlans,
  trainingPlans,
} from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { DomainEventHandlers, type DomainEvent } from '../domain-events/domain-event-handlers';
import { OutboxRelay } from '../domain-events/outbox-relay';
import { PublishedMethodologyReader } from '../methodology/published-methodology.reader';
import { StudentStateReader } from '../student-state/student-state.reader';
import { scheduleContextOf } from './inputs';
import { PlanDelivery } from './plan-delivery.service';
import { PLAN_STATE_SLICES, todayIn } from './plan-generation.service';
import { PlanPublisher } from './plan-publisher.service';
import { isPublishPlanAction, type PublishPlanAction } from './protocol-review.service';
import { parseStateView } from './state-view';

@Injectable()
export class PlanApprovalHandler implements OnModuleInit {
  constructor(
    private readonly handlers: DomainEventHandlers,
    private readonly db: TenantDatabase,
    private readonly stateReader: StudentStateReader,
    private readonly methodology: PublishedMethodologyReader,
    private readonly publisher: PlanPublisher,
    private readonly delivery: PlanDelivery,
    private readonly outbox: OutboxRelay,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PlanApprovalHandler.name);
  }

  onModuleInit(): void {
    this.handlers.register({
      name: 'planning.publish-on-staff-approval',
      eventTypes: ['DecisionMade'],
      handle: (event) => this.handle(event),
    });
  }

  async handle(event: DomainEvent): Promise<void> {
    if (!event.userId || event.payload.verdict !== 'EXECUTE') return;
    const userId = event.userId;
    const decisionId = String(event.payload.decisionId);
    const action = await this.approvedPublishAction(decisionId);
    if (!action) return;

    const activated =
      action.type === 'PUBLISH_TRAINING_PLAN'
        ? await this.activateTraining(userId, action.planId, decisionId)
        : await this.activateNutrition(userId, action.planId);
    if (!activated) return;
    await this.outbox.flushSoon();
    this.logger.info({ userId, planType: action.type }, 'plano aprovado pela equipe publicado');
    await this.delivery.sendWhenComplete(userId);
  }

  /** Ação de publicar plano decidida pela equipe; `null` para qualquer outra decisão. */
  private async approvedPublishAction(decisionId: string): Promise<PublishPlanAction | null> {
    const [row] = await this.db.runAsSystem((tx) =>
      tx
        .select({ decidedBy: coachingDecisions.decidedBy, action: coachingProposals.action })
        .from(coachingDecisions)
        .innerJoin(coachingProposals, eq(coachingProposals.id, coachingDecisions.proposalId))
        .where(eq(coachingDecisions.id, decisionId)),
    );
    if (!row || row.decidedBy !== 'STAFF') return null;
    return isPublishPlanAction(row.action) ? row.action : null;
  }

  private async activateTraining(userId: string, planId: string, decisionId: string) {
    const state = await this.stateReader.read(userId, PLAN_STATE_SLICES);
    const view = parseStateView(state.slices as Record<string, unknown>);
    const timezone = (state.slices.identity as { timezone?: string | null } | undefined)?.timezone;
    const today = todayIn(timezone ?? null);
    const hybrid = await this.methodology.publishedOf('HYBRID');
    const running = await this.methodology.publishedOf('RUNNING');
    const schedule = scheduleContextOf(view, hybrid?.parameters, running?.parameters);

    return this.db.runAsSystem(async (tx) => {
      const [plan] = await tx
        .select({ structure: trainingPlans.structure })
        .from(trainingPlans)
        .where(draftOf(trainingPlans, planId, userId))
        .for('update');
      if (!plan) return false;
      // A agenda começa no dia da aprovação, não no da geração do rascunho.
      await tx.update(trainingPlans).set({ startsOn: today }).where(eq(trainingPlans.id, planId));
      await this.publisher.activateTraining(tx, {
        userId,
        planId,
        structure: plan.structure,
        startsOn: today,
        schedule,
        decisionId,
      });
      return true;
    });
  }

  private activateNutrition(userId: string, planId: string) {
    return this.db.runAsSystem(async (tx) => {
      const [plan] = await tx
        .select({ id: nutritionPlans.id })
        .from(nutritionPlans)
        .where(draftOf(nutritionPlans, planId, userId))
        .for('update');
      if (!plan) return false;
      await this.publisher.activateNutrition(tx, { userId, planId });
      return true;
    });
  }
}

function draftOf(
  table: typeof trainingPlans | typeof nutritionPlans,
  planId: string,
  userId: string,
) {
  return and(eq(table.id, planId), eq(table.userId, userId), eq(table.status, 'DRAFT'));
}
