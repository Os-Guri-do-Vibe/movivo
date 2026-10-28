/**
 * Executa, por decisão de um profissional, uma proposta que o motor de políticas não executou
 * sozinho. Mesmos comandos de domínio do orquestrador; só muda quem decide.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import type { CoachingAction } from '@movivo/shared';

import { planSessions, scheduledSessions } from '../../core/database/schema';
import type { TenantTransaction } from '../../core/database/tenant-database.service';
import type { CommandResult } from '../coaching/decision/decision-executor.service';
import { DomainCommands } from '../conversation/domain-commands.service';
import { shortenFactor } from '../training/session-adjustment';

@Injectable()
export class ProposalRunner {
  constructor(private readonly commands: DomainCommands) {}

  async run(
    tx: TenantTransaction,
    userId: string,
    action: CoachingAction,
    decisionId: string,
    today: string,
  ): Promise<CommandResult> {
    switch (action.type) {
      case 'RESCHEDULE_WEEK':
        return this.commands.rescheduleWeek(tx, userId, action, decisionId);
      case 'SUBSTITUTE_EXERCISE':
        return this.commands.substituteExercise(tx, userId, action, decisionId, today);
      case 'SHORTEN_SESSION': {
        const [row] = await tx
          .select({ minutes: planSessions.estimatedMinutes })
          .from(scheduledSessions)
          .innerJoin(planSessions, eq(planSessions.id, scheduledSessions.planSessionId))
          .where(eq(scheduledSessions.id, action.scheduledSessionId));
        if (!row) throw new BadRequestException('A sessão da proposta não existe mais.');
        return this.commands.shortenSession(
          tx,
          userId,
          action,
          shortenFactor(row.minutes, action.targetMinutes),
          decisionId,
        );
      }
      case 'ADJUST_WEEKLY_VOLUME':
        return this.commands.adjustWeeklyVolume(tx, userId, action, decisionId, today);
      case 'ADJUST_ENERGY_TARGET':
        return this.commands.adjustEnergyTarget(tx, userId, action);
      case 'ADJUST_MEAL_GUIDANCE':
        return this.commands.adjustMealGuidance(tx, userId, action);
      case 'RECORD_PREFERENCE':
        return this.commands.recordPreference(tx, userId, action.preference, []);
      case 'RECORD_CONSTRAINT':
        return this.commands.recordConstraint(tx, userId, action, today);
      case 'ASK_STUDENT':
        return { command: 'communication.ask_student', result: { text: action.question } };
      case 'SEND_MESSAGE':
        return { command: 'communication.send_message', result: { text: action.text } };
      case 'PUBLISH_TRAINING_PLAN':
      case 'PUBLISH_NUTRITION_PLAN':
      case 'DEFINE_STRATEGY':
        throw new BadRequestException(
          'Planos e estratégia são publicados pelo fluxo de planejamento, não pela fila.',
        );
    }
  }
}
