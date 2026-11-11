import { Injectable } from '@nestjs/common';

import type { CoachingProposal } from '@movivo/shared';

import {
  TenantDatabase,
  type TenantTransaction,
} from '../../../core/database/tenant-database.service';
import { OutboxRelay } from '../../domain-events/outbox-relay';
import { DecisionPipeline, type DecisionOutcome } from './decision-pipeline.service';

/** O que um comando de domínio devolve ao ser executado: o nome e os ids do que mudou. */
export interface CommandResult {
  command: string;
  result: Record<string, unknown>;
}

/**
 * Proposta → decisão → execução, tudo na mesma transação: a decisão, a mudança de estado e os
 * eventos são atômicos. Só quem tem a decisão `EXECUTE` em mãos roda o comando.
 */
@Injectable()
export class DecisionExecutor {
  constructor(
    private readonly db: TenantDatabase,
    private readonly pipeline: DecisionPipeline,
    private readonly outbox: OutboxRelay,
  ) {}

  async decideAndRun(
    userId: string,
    taskId: string,
    proposal: CoachingProposal,
    run: (tx: TenantTransaction, decisionId: string) => Promise<CommandResult>,
    options: { sessionPlannedMinutes?: number; modelRunId?: string | null } = {},
  ): Promise<DecisionOutcome & { execution: CommandResult | null }> {
    const outcome = await this.db.runAsSystem(async (tx) => {
      const decision = await this.pipeline.decide(tx, {
        userId,
        taskId,
        triggerEventId: null,
        stateVersion: 0,
        modelRunId: options.modelRunId ?? null,
        proposal,
        sessionPlannedMinutes: options.sessionPlannedMinutes,
      });
      let execution: CommandResult | null = null;
      if (decision.verdict === 'EXECUTE') {
        execution = await run(tx, decision.decisionId);
        await this.pipeline.recordExecution(tx, {
          userId,
          decisionId: decision.decisionId,
          command: execution.command,
          status: 'SUCCEEDED',
          result: execution.result,
        });
      }
      return { ...decision, execution };
    });
    await this.outbox.flushSoon();
    return outcome;
  }
}
