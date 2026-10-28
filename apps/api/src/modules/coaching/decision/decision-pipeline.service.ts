/**
 * Pipeline de decisão: PROPOSTA (agente) → DECISÃO (motor de políticas) → EXECUÇÃO (comando de
 * domínio). Cada passo deixa uma linha, com a versão da política aplicada — é o que permite
 * responder "por que a MOVIVO fez isso?" e atender a revisão humana (LGPD art. 20).
 *
 * Tudo roda DENTRO da transação de quem chama: a proposta, a decisão e a execução (que muda o
 * estado) são atômicas, e os eventos saem pelo outbox. O que NÃO é `EXECUTE` não é executado:
 * abre um caso na fila da equipe com o resumo do que foi proposto e por quê.
 */
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import {
  ACTION_DOMAIN,
  type CoachingProposal,
  type DecisionVerdict,
  type SafetyScope,
  type SafetySeverity,
} from '@movivo/shared';

import {
  coachingDecisions,
  coachingProposals,
  decisionExecutions,
  exceptionCases,
  safetyEvents,
} from '../../../core/database/schema';
import type { TenantTransaction } from '../../../core/database/tenant-database.service';
import { DomainEventRecorder } from '../../domain-events/domain-event-recorder';
import { evaluateAction } from '../policy/autonomy-policy';
import { PublishedPolicies } from '../policy/published-policies';

/** Quanto tempo uma proposta pendente de resposta humana continua válida. */
const PROPOSAL_TTL_DAYS = 7;
const DAY_MS = 86_400_000;

export interface DecideInput {
  userId: string;
  /** Tarefa de agente que produziu a proposta (ex.: `goals.define_strategy`). */
  taskId: string;
  triggerEventId: string | null;
  proposal: CoachingProposal;
  /** Versão do Estado do Aluno lida pelo agente. */
  stateVersion: number;
  modelRunId: string | null;
  /** Só para `SHORTEN_SESSION`: duração prevista da sessão. */
  sessionPlannedMinutes?: number;
}

export interface DecisionOutcome {
  proposalId: string;
  decisionId: string;
  verdict: DecisionVerdict;
  reasons: string[];
  policyVersion: number | null;
  exceptionCaseId: string | null;
}

@Injectable()
export class DecisionPipeline {
  constructor(
    private readonly policies: PublishedPolicies,
    private readonly events: DomainEventRecorder,
  ) {}

  async decide(tx: TenantTransaction, input: DecideInput): Promise<DecisionOutcome> {
    const { userId, proposal } = input;
    const signals = await tx
      .select({
        kind: safetyEvents.kind,
        severity: safetyEvents.severity,
        scope: safetyEvents.scope,
      })
      .from(safetyEvents)
      .where(and(eq(safetyEvents.userId, userId), eq(safetyEvents.status, 'ACTIVE')));
    const [reviewCase] = await tx
      .select({ id: exceptionCases.id })
      .from(exceptionCases)
      .where(
        and(
          eq(exceptionCases.userId, userId),
          eq(exceptionCases.kind, 'STUDENT_REVIEW_REQUEST'),
          eq(exceptionCases.status, 'OPEN'),
        ),
      )
      .limit(1);

    const policy = await this.policies.autonomy();
    const verdict = evaluateAction(
      proposal.action,
      {
        activeSignals: signals.map((s) => ({
          kind: s.kind,
          severity: s.severity as SafetySeverity,
          scope: s.scope as SafetyScope,
        })),
        uncertainty: proposal.uncertainty,
        reviewRequested: reviewCase !== undefined,
        sessionPlannedMinutes: input.sessionPlannedMinutes,
      },
      policy,
    );

    const [row] = await tx
      .insert(coachingProposals)
      .values({
        userId,
        triggerEventId: input.triggerEventId,
        taskId: input.taskId,
        actionType: proposal.action.type,
        action: proposal.action,
        rationale: proposal.rationale,
        evidence: proposal.evidence,
        assumptions: proposal.assumptions,
        uncertainty: proposal.uncertainty,
        expectedOutcome: proposal.expectedOutcome,
        stateVersion: input.stateVersion,
        modelRunId: input.modelRunId,
        status: verdict.verdict === 'EXECUTE' ? 'ACCEPTED' : 'PENDING',
        expiresAt: new Date(Date.now() + PROPOSAL_TTL_DAYS * DAY_MS),
      })
      .returning({ id: coachingProposals.id });
    if (!row) throw new Error('falha ao gravar a proposta');

    const [decision] = await tx
      .insert(coachingDecisions)
      .values({
        userId,
        proposalId: row.id,
        verdict: verdict.verdict,
        reasons: verdict.reasons,
        decidedBy: 'POLICY_ENGINE',
      })
      .returning({ id: coachingDecisions.id });
    if (!decision) throw new Error('falha ao gravar a decisão');

    await this.events.record(tx, {
      userId,
      type: 'ProposalCreated',
      payload: { proposalId: row.id, action: proposal.action.type, taskId: input.taskId },
    });
    await this.events.record(tx, {
      userId,
      type: 'DecisionMade',
      payload: { decisionId: decision.id, proposalId: row.id, verdict: verdict.verdict },
    });

    let exceptionCaseId: string | null = null;
    if (verdict.verdict === 'ASK' || verdict.verdict === 'ESCALATE') {
      exceptionCaseId = await this.openException(tx, input, row.id, decision.id, verdict.reasons);
    }
    return {
      proposalId: row.id,
      decisionId: decision.id,
      verdict: verdict.verdict,
      reasons: verdict.reasons,
      policyVersion: verdict.policyVersion,
      exceptionCaseId,
    };
  }

  /** Registra o resultado da execução de uma decisão `EXECUTE`. */
  async recordExecution(
    tx: TenantTransaction,
    input: {
      userId: string;
      decisionId: string;
      command: string;
      status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
      result: Record<string, unknown>;
    },
  ): Promise<void> {
    await tx.insert(decisionExecutions).values({
      userId: input.userId,
      decisionId: input.decisionId,
      command: input.command,
      status: input.status,
      result: input.result,
    });
    await this.events.record(tx, {
      userId: input.userId,
      type: 'DecisionExecuted',
      payload: { decisionId: input.decisionId, command: input.command, status: input.status },
    });
  }

  private async openException(
    tx: TenantTransaction,
    input: DecideInput,
    proposalId: string,
    decisionId: string,
    reasons: string[],
  ): Promise<string> {
    const domain = ACTION_DOMAIN[input.proposal.action.type];
    const [exception] = await tx
      .insert(exceptionCases)
      .values({
        userId: input.userId,
        kind: 'NO_APPLICABLE_POLICY',
        priority: 'NORMAL',
        domain:
          domain === 'NUTRITION' ? 'NUTRITION' : domain === 'TRAINING' ? 'TRAINING' : 'GENERAL',
        subject: { proposalId, decisionId },
        summary:
          `A política exige decisão humana para ${input.proposal.action.type}. ${reasons.join(' ')} Proposta: ${input.proposal.rationale.join(' ')}`.slice(
            0,
            1_500,
          ),
      })
      .returning({ id: exceptionCases.id });
    if (!exception) throw new Error('falha ao abrir o caso de exceção');
    await this.events.record(tx, {
      userId: input.userId,
      type: 'ExceptionOpened',
      payload: { exceptionCaseId: exception.id, kind: 'NO_APPLICABLE_POLICY' },
    });
    return exception.id;
  }

  /** Abre um caso para falha de geração (o agente não produziu saída válida, dado faltando). */
  async openFailureCase(
    tx: TenantTransaction,
    input: {
      userId: string;
      domain: 'TRAINING' | 'NUTRITION' | 'GENERAL';
      summary: string;
      subject: Record<string, string>;
      priority?: 'LOW' | 'NORMAL' | 'HIGH';
    },
  ): Promise<string> {
    const [exception] = await tx
      .insert(exceptionCases)
      .values({
        userId: input.userId,
        kind: 'DECISION_FAILURE',
        priority: input.priority ?? 'NORMAL',
        domain: input.domain,
        subject: input.subject,
        summary: input.summary.slice(0, 1_500),
      })
      .returning({ id: exceptionCases.id });
    if (!exception) throw new Error('falha ao abrir o caso de exceção');
    await this.events.record(tx, {
      userId: input.userId,
      type: 'ExceptionOpened',
      payload: { exceptionCaseId: exception.id, kind: 'DECISION_FAILURE' },
    });
    return exception.id;
  }
}
