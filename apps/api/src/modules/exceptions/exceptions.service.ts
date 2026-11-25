/**
 * Fila de exceções: o que o motor de políticas não resolveu sozinho chega aqui, para o
 * profissional do domínio certo (CREF treino, CRN nutrição, CRM médico). Toda decisão do
 * profissional vira decisão `STAFF` na trilha, com proposta, nota e execução.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, ne, notInArray } from 'drizzle-orm';

import {
  ACTION_DOMAIN,
  canActOnCase,
  canCloseSafety,
  type CoachingAction,
  domainsForCouncil,
  type Council,
  type EditProtocolRequest,
  type ExceptionDomain,
  type ExceptionScope,
  type ExceptionsSummary,
  type ProtocolRegenerationResponse,
  QUEUE_EXCEPTION_KINDS,
  type SafetyScope,
  type SafetySignalKind,
} from '@movivo/shared';

import type { StateSlice } from '../../core/agents/agent-task';
import { HealthCipherService } from '../../core/database/health-cipher.service';
import {
  coachingDecisions,
  coachingProposals,
  decisionExecutions,
  exceptionCases,
  nutritionPlans,
  safetyEvents,
  staff,
  trainingPlans,
  users,
} from '../../core/database/schema';
import {
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database/tenant-database.service';
import { AuditService } from '../admin/audit.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import type { CommandResult } from '../coaching/decision/decision-executor.service';
import { DecisionPipeline } from '../coaching/decision/decision-pipeline.service';
import { AnamnesisService } from '../anamnesis/anamnesis.service';
import { ConversationStore } from '../conversation/conversation-store';
import { DomainCommands } from '../conversation/domain-commands.service';
import * as msg from '../conversation/messages';
import { DomainEventRecorder } from '../domain-events/domain-event-recorder';
import { OutboxRelay } from '../domain-events/outbox-relay';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import type { WhatsappOutboundJob } from '../jobs/whatsapp-outbound.contract';
import { examFileOf, examViewOf } from '../medical/medical-exam.service';
import { signatureHashOf } from '../planning/plan-signature';
import { todayIn } from '../planning/plan-generation.service';
import {
  isPublishPlanAction,
  protocolKindOf,
  ProtocolReviewService,
} from '../planning/protocol-review.service';
import { StudentStateReader } from '../student-state/student-state.reader';
import { TrainingLinkService } from '../training/training-link.service';
import { proposalIdsOf, withListContext } from './exception-list';
import { openCaseCounts, summaryOf } from './exception-summary';
import { ProposalRunner } from './proposal-runner.service';
import { ReviewHoldService } from './review-hold.service';

const PRIORITY_RANK = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 } as const;
/** Motivo gravado no caso quando o profissional pede o protocolo refeito do zero. */
export const REGENERATION_NOTE = 'Regeneração completa do protocolo pedida pelo profissional.';

/** O caso já foi encerrado por um pedido de regeneração (clique repetido recebe a mesma resposta). */
function wasRegenerated(row: { status: string; resolution: Record<string, unknown> | null }) {
  return row.status === 'RESOLVED' && row.resolution?.outcome === 'REGENERATION_REQUESTED';
}
const STATE_SLICES: readonly StateSlice[] = [
  'identity',
  'goals',
  'training',
  'nutrition',
  'adherence',
  'preferences',
  'restrictions',
  'recentDecisions',
];

/**
 * Quem está agindo. O PROFISSIONAL age no domínio do conselho dele, com registro ativo. O ADMIN
 * (fundador e sócio, que também é o profissional da MOVIVO) vê e resolve todos os domínios.
 */
export interface Actor {
  staffId: string;
  role: 'PROFESSIONAL' | 'ADMIN';
  council: Council | null;
  councilActive: boolean;
  /**
   * Conselho com registro ATIVO cadastrado na conta, qualquer que seja o papel (o ADMIN, que é
   * sócio e também profissional, pode ter o dele). É o que decide quem encerra sinal clínico.
   */
  registeredCouncil: Council | null;
}

@Injectable()
export class ExceptionsService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly state: StudentStateReader,
    private readonly runner: ProposalRunner,
    private readonly pipeline: DecisionPipeline,
    private readonly events: DomainEventRecorder,
    private readonly outbox: OutboxRelay,
    private readonly audit: AuditService,
    private readonly queues: QueueManager,
    private readonly store: ConversationStore,
    private readonly protocols: ProtocolReviewService,
    private readonly cipher: HealthCipherService,
    private readonly hold: ReviewHoldService,
    private readonly anamnesis: AnamnesisService,
    private readonly commands: DomainCommands,
    private readonly links: TrainingLinkService,
  ) {}

  async actorOf(user: AuthenticatedUser): Promise<Actor> {
    if (user.role !== 'PROFESSIONAL' && user.role !== 'ADMIN') {
      throw new ForbiddenException('Sem acesso à fila de exceções.');
    }
    const [row] = await this.db.runAsSystem((tx) =>
      tx
        .select({ council: staff.council, active: staff.councilActive })
        .from(staff)
        .where(eq(staff.id, user.userId)),
    );
    return {
      staffId: user.userId,
      role: user.role,
      council:
        user.role === 'PROFESSIONAL' ? ((row?.council as Council | undefined) ?? 'CREF') : null,
      councilActive: user.role === 'PROFESSIONAL' ? (row?.active ?? false) : false,
      registeredCouncil: row?.active ? ((row.council as Council | undefined) ?? null) : null,
    };
  }

  private domainsOf(actor: Actor): readonly ExceptionDomain[] | null {
    return actor.council ? domainsForCouncil(actor.council) : null;
  }

  /** Pode agir neste domínio? Profissional: o do conselho dele, com registro ativo. ADMIN: todos. */
  private canAct(actor: Actor, domain: ExceptionDomain): boolean {
    return canActOnCase(actor, domain);
  }

  async list(
    user: AuthenticatedUser,
    filter: { status?: 'OPEN' | 'IN_REVIEW' | 'RESOLVED'; scope?: ExceptionScope },
  ) {
    const actor = await this.actorOf(user);
    const domains = this.domainsOf(actor);
    const rows = await this.db.runAsSystem(async (tx) => {
      const cases = await tx
        .select({
          id: exceptionCases.id,
          kind: exceptionCases.kind,
          priority: exceptionCases.priority,
          status: exceptionCases.status,
          domain: exceptionCases.domain,
          summary: exceptionCases.summary,
          createdAt: exceptionCases.createdAt,
          assignedStaffId: exceptionCases.assignedStaffId,
          reviewUrgency: exceptionCases.reviewUrgency,
          autoReleaseAt: exceptionCases.autoReleaseAt,
          studentId: exceptionCases.userId,
          studentName: users.name,
          subject: exceptionCases.subject,
        })
        .from(exceptionCases)
        .innerJoin(users, eq(users.id, exceptionCases.userId))
        .where(
          and(
            filter.status
              ? eq(exceptionCases.status, filter.status)
              : ne(exceptionCases.status, 'RESOLVED'),
            domains ? inArray(exceptionCases.domain, [...domains]) : undefined,
            filter.scope === 'QUEUE'
              ? inArray(exceptionCases.kind, [...QUEUE_EXCEPTION_KINDS])
              : filter.scope === 'ALERTS'
                ? notInArray(exceptionCases.kind, [...QUEUE_EXCEPTION_KINDS])
                : undefined,
          ),
        )
        .orderBy(asc(exceptionCases.createdAt))
        .limit(200);
      // O tipo da ação proposta (uma leitura só) diz à Fila o que está pendente em poucas palavras.
      const proposalIds = proposalIdsOf(cases);
      const proposals = proposalIds.length
        ? await tx
            .select({ id: coachingProposals.id, actionType: coachingProposals.actionType })
            .from(coachingProposals)
            .where(inArray(coachingProposals.id, proposalIds))
        : [];
      return withListContext(cases, new Map(proposals.map((p) => [p.id, p.actionType])));
    });
    return rows
      .map((row) => ({ ...row, canResolve: this.canAct(actor, row.domain as ExceptionDomain) }))
      .sort(
        (a, b) =>
          (PRIORITY_RANK[a.priority as keyof typeof PRIORITY_RANK] ?? 9) -
            (PRIORITY_RANK[b.priority as keyof typeof PRIORITY_RANK] ?? 9) ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      );
  }

  /**
   * Abertos (e urgentes) em cada painel e no total. A Fila conta alunos distintos (um cartão por
   * aluno); Alertas contam casos (um item por caso). Uma consulta agregada, sem ler os casos.
   */
  async summary(user: AuthenticatedUser): Promise<ExceptionsSummary> {
    const actor = await this.actorOf(user);
    const counts = await this.db.runAsSystem((tx) => openCaseCounts(tx, this.domainsOf(actor)));
    return summaryOf(counts);
  }

  private async load(user: AuthenticatedUser, id: string) {
    const actor = await this.actorOf(user);
    const [row] = await this.db.runAsSystem((tx) =>
      tx.select().from(exceptionCases).where(eq(exceptionCases.id, id)),
    );
    if (!row) throw new NotFoundException('Caso não encontrado.');
    const domains = this.domainsOf(actor);
    // Fora do domínio do profissional o caso nem existe para ele.
    if (domains && !domains.includes(row.domain as ExceptionDomain)) {
      throw new NotFoundException('Caso não encontrado.');
    }
    return { actor, row };
  }

  async detail(user: AuthenticatedUser, id: string, now: Date = new Date()) {
    const { actor, row } = await this.load(user, id);
    const proposalId = row.subject.proposalId;
    const decisionId = row.subject.decisionId;
    const safetyEventId = row.subject.safetyEventId;
    const examId = row.subject.examId;
    const { proposal, decision, safety, student, exam } = await this.db.runAsSystem(async (tx) => ({
      exam: examId ? await examViewOf(tx, this.cipher, examId) : null,
      proposal: proposalId
        ? ((
            await tx.select().from(coachingProposals).where(eq(coachingProposals.id, proposalId))
          )[0] ?? null)
        : null,
      decision: decisionId
        ? ((
            await tx.select().from(coachingDecisions).where(eq(coachingDecisions.id, decisionId))
          )[0] ?? null)
        : null,
      safety: safetyEventId
        ? ((await tx.select().from(safetyEvents).where(eq(safetyEvents.id, safetyEventId)))[0] ??
          null)
        : null,
      student: (
        await tx
          .select({ id: users.id, name: users.name, timezone: users.timezone })
          .from(users)
          .where(eq(users.id, row.userId))
      )[0],
    }));
    const stateRead = await this.state.read(row.userId, STATE_SLICES, now);
    const canResolveSafetyEvent =
      safety !== null &&
      canCloseSafety(actor, safety.kind as SafetySignalKind, safety.scope as SafetyScope);
    return {
      case: { ...row, canResolve: this.canAct(actor, row.domain as ExceptionDomain) },
      student: student ?? null,
      proposal,
      decision,
      safety: safety ? { ...safety, canResolve: canResolveSafetyEvent } : null,
      state: stateRead.slices,
      exam,
      exerciseNames: this.exerciseNamesOf(proposal?.action, row.subject),
    };
  }

  /** Nome dos exercícios citados no caso (proposta de troca ou troca sem equivalente). */
  private exerciseNamesOf(
    action: CoachingAction | undefined,
    subject: Record<string, string>,
  ): Record<string, string> | null {
    const ids: string[] = [];
    if (action?.type === 'SUBSTITUTE_EXERCISE')
      ids.push(action.fromExerciseId, action.toExerciseId);
    if (subject.fromExerciseId) ids.push(subject.fromExerciseId);
    return ids.length > 0 ? this.protocols.exerciseNames(ids) : null;
  }

  /** Arquivo original do exame do caso (só quem vê o caso; o acesso fica na auditoria). */
  async examFile(user: AuthenticatedUser, id: string) {
    const { actor, row } = await this.load(user, id);
    const examId = row.subject.examId;
    if (!examId) throw new NotFoundException('Este caso não tem exame.');
    const file = await this.db.runAsSystem(async (tx) => {
      await this.audit.append(tx, {
        actorId: actor.staffId,
        userId: row.userId,
        action: 'exception.exam_file_viewed',
        entityType: 'exception_case',
        entityId: id,
        changes: { examId },
      });
      return examFileOf(tx, this.cipher, examId);
    });
    if (!file) throw new NotFoundException('Exame não encontrado.');
    return file;
  }

  async claim(user: AuthenticatedUser, id: string) {
    const { actor, row } = await this.load(user, id);
    this.assertCanAct(actor, row.domain as ExceptionDomain);
    if (row.status === 'RESOLVED') throw new ConflictException('Caso já resolvido.');
    await this.db.runAsSystem(async (tx) => {
      await tx
        .update(exceptionCases)
        .set({ assignedStaffId: actor.staffId, status: 'IN_REVIEW' })
        .where(eq(exceptionCases.id, id));
      await this.audit.append(tx, {
        actorId: actor.staffId,
        userId: row.userId,
        action: 'exception.claim',
        entityType: 'exception_case',
        entityId: id,
        changes: { domain: row.domain },
      });
    });
    return { id, status: 'IN_REVIEW' as const };
  }

  /** Aprova a proposta pendente: o profissional decide e o comando de domínio é executado. */
  async approve(
    user: AuthenticatedUser,
    id: string,
    note: string | undefined,
    now: Date = new Date(),
  ) {
    const { actor, row } = await this.load(user, id);
    this.assertCanAct(actor, row.domain as ExceptionDomain);
    if (!row.subject.proposalId) {
      throw new BadRequestException('Este caso não tem proposta para aprovar.');
    }
    if (row.status === 'RESOLVED') throw new ConflictException('Caso já resolvido.');

    const result = await this.db.runAsSystem(async (tx) => {
      const [locked] = await tx
        .select()
        .from(exceptionCases)
        .where(eq(exceptionCases.id, id))
        .for('update');
      if (!locked || locked.status === 'RESOLVED')
        throw new ConflictException('Caso já resolvido.');
      return this.applyApproval(tx, locked, { by: 'STAFF', actor, note }, now);
    });
    await this.outbox.flushSoon();
    await this.notifyAfterRelease(row.userId, id, result);
    return { id, status: 'RESOLVED' as const, command: result.executed.command };
  }

  /**
   * A tela de revisão avisa que está aberta (`active: true`, renovado a cada ~30 s) ou foi
   * fechada. Aberta, a liberação automática que vencer espera; ao fechar, a que venceu sai na hora.
   */
  async setReviewHold(user: AuthenticatedUser, id: string, active: boolean) {
    const { actor, row } = await this.load(user, id);
    this.assertCanAct(actor, row.domain as ExceptionDomain);
    const target = { userId: row.userId, exceptionCaseId: id };
    // Só o protocolo opcional tem liberação automática a segurar.
    if (row.reviewUrgency !== 'OPTIONAL' || row.status === 'RESOLVED') {
      return { held: false, released: false };
    }
    if (active) {
      await this.hold.hold(target);
      return { held: true, released: false };
    }
    return { held: false, released: await this.hold.release(target) };
  }

  /**
   * Libera sozinho o protocolo de revisão opcional cuja janela venceu. Reconfere o estado sob
   * trava: se um profissional já agiu (aprovou, recusou, pediu ajuste) ou o caso virou
   * obrigatório, não faz nada.
   */
  async autoRelease(
    id: string,
    now: Date = new Date(),
  ): Promise<{ released: boolean; userId: string | null }> {
    const outcome = await this.db.runAsSystem(async (tx) => {
      const [locked] = await tx
        .select()
        .from(exceptionCases)
        .where(eq(exceptionCases.id, id))
        .for('update');
      if (
        !locked ||
        locked.status === 'RESOLVED' ||
        locked.kind !== 'PROTOCOL_REVIEW' ||
        locked.reviewUrgency !== 'OPTIONAL'
      ) {
        return { released: false, userId: locked?.userId ?? null, applied: null };
      }
      const [proposal] = locked.subject.proposalId
        ? await tx
            .select({ status: coachingProposals.status })
            .from(coachingProposals)
            .where(eq(coachingProposals.id, locked.subject.proposalId))
        : [];
      if (proposal?.status !== 'PENDING') {
        return { released: false, userId: locked.userId, applied: null };
      }
      const applied = await this.applyApproval(tx, locked, { by: 'AUTO_RELEASE' }, now);
      return { released: true, userId: locked.userId, applied };
    });
    if (outcome.released) {
      await this.outbox.flushSoon();
      if (outcome.applied) await this.notifyAfterRelease(outcome.userId, id, outcome.applied);
    }
    return { released: outcome.released, userId: outcome.userId };
  }

  /**
   * Núcleo da aprovação, igual para o profissional e para a liberação automática: grava a
   * decisão, marca a proposta, executa o comando de domínio e encerra o caso. Roda na transação
   * (e com o caso travado) de quem chama.
   */
  private async applyApproval(
    tx: TenantTransaction,
    row: typeof exceptionCases.$inferSelect,
    approval: { by: 'STAFF'; actor: Actor; note?: string } | { by: 'AUTO_RELEASE' },
    now: Date,
  ) {
    const proposalId = row.subject.proposalId;
    if (!proposalId) throw new BadRequestException('Este caso não tem proposta para aprovar.');
    const [proposal] = await tx
      .select()
      .from(coachingProposals)
      .where(eq(coachingProposals.id, proposalId));
    if (!proposal) throw new NotFoundException('Proposta não encontrada.');
    if (proposal.status !== 'PENDING') {
      throw new ConflictException('A proposta não está mais pendente.');
    }
    const [timezone] = await tx
      .select({ tz: users.timezone })
      .from(users)
      .where(eq(users.id, row.userId));
    const staff = approval.by === 'STAFF';
    const [decision] = await tx
      .insert(coachingDecisions)
      .values({
        userId: row.userId,
        proposalId,
        verdict: 'EXECUTE',
        reasons: staff
          ? [
              `Aprovado por profissional (${approval.actor.council ?? 'ADMIN'}).${approval.note ? ` ${approval.note}` : ''}`,
            ]
          : ['Liberado automaticamente: a janela de revisão opcional terminou sem ação da equipe.'],
        decidedBy: staff ? 'STAFF' : 'AUTO_RELEASE',
        staffId: staff ? approval.actor.staffId : null,
      })
      .returning({ id: coachingDecisions.id });
    if (!decision) throw new Error('falha ao gravar a decisão do caso');
    await tx
      .update(coachingProposals)
      .set({ status: 'ACCEPTED' })
      .where(eq(coachingProposals.id, proposalId));
    await this.events.record(tx, {
      userId: row.userId,
      type: 'DecisionMade',
      payload: { decisionId: decision.id, proposalId, verdict: 'EXECUTE' },
    });
    const executed = await this.runner.run(
      tx,
      row.userId,
      proposal.action,
      decision.id,
      todayIn(timezone?.tz ?? null, now),
    );
    await this.pipeline.recordExecution(tx, {
      userId: row.userId,
      decisionId: decision.id,
      command: executed.command,
      status: 'SUCCEEDED',
      result: executed.result,
    });
    await tx
      .update(exceptionCases)
      .set({
        status: 'RESOLVED',
        resolvedAt: now,
        assignedStaffId: staff ? approval.actor.staffId : row.assignedStaffId,
        resolution: staff
          ? { outcome: 'APPROVED', note: approval.note ?? null, decisionId: decision.id }
          : { outcome: 'AUTO_RELEASED', note: null, decisionId: decision.id },
      })
      .where(eq(exceptionCases.id, row.id));
    await this.recordResolved(
      tx,
      row.userId,
      row.id,
      row.kind,
      staff ? 'APPROVED' : 'AUTO_RELEASED',
    );
    if (staff) {
      // A liberação por um profissional é uma assinatura: fica gravado quem liberou, quando e o
      // hash do conteúdo. A liberação automática não assina (ninguém revisou).
      await this.signReleasedPlan(tx, proposal.action, executed, approval.actor.staffId, now);
      // O PAR-Q de risco não abre caso próprio: a revisão do protocolo é o caso. Ao liberar o
      // treino, o sinal do PAR-Q deixa de suspender as ações automáticas do aluno.
      if (proposal.action.type === 'PUBLISH_TRAINING_PLAN') {
        await this.releaseParqSignal(tx, row.userId, approval.actor.staffId, now);
      }
      await this.audit.append(tx, {
        actorId: approval.actor.staffId,
        userId: row.userId,
        action: 'exception.approve',
        entityType: 'exception_case',
        entityId: row.id,
        changes: { proposalId, decisionId: decision.id, command: executed.command },
      });
    }
    return { executed, action: proposal.action };
  }

  /** Assina o plano que a liberação publicou ou criou (se houver): quem, quando e o hash. */
  private async signReleasedPlan(
    tx: TenantTransaction,
    action: CoachingAction,
    executed: CommandResult,
    staffId: string,
    now: Date,
  ): Promise<void> {
    if (action.type === 'PUBLISH_TRAINING_PLAN') {
      return this.signPlan(tx, 'TRAINING', action.planId, staffId, now);
    }
    if (action.type === 'PUBLISH_NUTRITION_PLAN') {
      return this.signPlan(tx, 'NUTRITION', action.planId, staffId, now);
    }
    const planId = executed.result.planId;
    if (typeof planId !== 'string') return;
    const domain = ACTION_DOMAIN[action.type];
    if (domain === 'TRAINING' || domain === 'NUTRITION') {
      await this.signPlan(tx, domain, planId, staffId, now);
    }
  }

  private async signPlan(
    tx: TenantTransaction,
    kind: 'TRAINING' | 'NUTRITION',
    planId: string,
    staffId: string,
    now: Date,
  ): Promise<void> {
    const table = kind === 'TRAINING' ? trainingPlans : nutritionPlans;
    const [plan] = await tx
      .select({ structure: table.structure })
      .from(table)
      .where(eq(table.id, planId));
    if (!plan) return;
    await tx
      .update(table)
      .set({ signedBy: staffId, signedAt: now, signatureHash: signatureHashOf(plan.structure) })
      .where(eq(table.id, planId));
  }

  private async releaseParqSignal(
    tx: TenantTransaction,
    userId: string,
    staffId: string,
    now: Date,
  ): Promise<void> {
    await tx
      .update(safetyEvents)
      .set({
        status: 'RESOLVED',
        resolvedBy: staffId,
        resolvedAt: now,
        resolutionNote: 'PAR-Q revisado junto com o protocolo, liberado pelo profissional.',
      })
      .where(
        and(
          eq(safetyEvents.userId, userId),
          eq(safetyEvents.kind, 'PARQ_POSITIVE'),
          eq(safetyEvents.status, 'ACTIVE'),
        ),
      );
  }

  /**
   * Depois que a mudança é liberada, avisa o aluno. A troca de exercício no protocolo manda o
   * protocolo atualizado; o resto responde só quando o comando devolveu um texto.
   */
  private async notifyAfterRelease(
    userId: string,
    exceptionId: string,
    approval: { executed: CommandResult; action: CoachingAction },
  ): Promise<void> {
    const { executed, action } = approval;
    const result = executed.result;
    if (action.type === 'SUBSTITUTE_EXERCISE' && action.scope === 'PLAN') {
      if (result.applied !== true) return;
      const text = msg.swapReleasedMessage(
        String(result.fromName ?? 'o exercício'),
        String(result.toName ?? 'o novo exercício'),
        await this.links.shortUrl(userId),
      );
      await this.sendToStudent(userId, text, exceptionId);
      return;
    }
    if (typeof result.text === 'string') await this.sendToStudent(userId, result.text, exceptionId);
  }

  /** Recusa a proposta (nada muda no plano do aluno) e encerra o caso com o motivo. */
  async reject(user: AuthenticatedUser, id: string, note: string, now: Date = new Date()) {
    const { actor, row } = await this.load(user, id);
    this.assertCanAct(actor, row.domain as ExceptionDomain);
    const proposalId = row.subject.proposalId;
    if (!proposalId) throw new BadRequestException('Este caso não tem proposta para recusar.');
    const [rejected] = await this.db.runAsSystem((tx) =>
      tx
        .select({ action: coachingProposals.action })
        .from(coachingProposals)
        .where(eq(coachingProposals.id, proposalId)),
    );
    await this.db.runAsSystem(async (tx) => {
      const [locked] = await tx
        .select()
        .from(exceptionCases)
        .where(eq(exceptionCases.id, id))
        .for('update');
      if (!locked || locked.status === 'RESOLVED')
        throw new ConflictException('Caso já resolvido.');
      await tx
        .update(coachingProposals)
        .set({ status: 'REJECTED' })
        .where(and(eq(coachingProposals.id, proposalId), eq(coachingProposals.status, 'PENDING')));
      await tx
        .update(exceptionCases)
        .set({
          status: 'RESOLVED',
          resolvedAt: now,
          assignedStaffId: actor.staffId,
          resolution: { outcome: 'REJECTED', note },
        })
        .where(eq(exceptionCases.id, id));
      await this.recordResolved(tx, row.userId, id, row.kind, 'REJECTED');
      await this.audit.append(tx, {
        actorId: actor.staffId,
        userId: row.userId,
        action: 'exception.reject',
        entityType: 'exception_case',
        entityId: id,
        changes: { proposalId },
      });
    });
    await this.outbox.flushSoon();
    // O aluno pediu a troca e ficou esperando: a recusa também precisa de resposta.
    if (rejected?.action.type === 'SUBSTITUTE_EXERCISE' && rejected.action.scope === 'PLAN') {
      await this.sendToStudent(row.userId, msg.SWAP_REJECTED_MESSAGE, id);
    }
    return { id, status: 'RESOLVED' as const };
  }

  /**
   * Encerra um caso sem proposta (revisão pedida pelo aluno, falha, sinal de segurança). Em caso
   * de segurança, também encerra o sinal ativo, se o conselho do profissional puder fazê-lo.
   */
  async resolve(user: AuthenticatedUser, id: string, note: string, now: Date = new Date()) {
    const { actor, row } = await this.load(user, id);
    this.assertCanAct(actor, row.domain as ExceptionDomain);
    const safetyEventId = row.subject.safetyEventId;
    await this.db.runAsSystem(async (tx) => {
      const [locked] = await tx
        .select()
        .from(exceptionCases)
        .where(eq(exceptionCases.id, id))
        .for('update');
      if (!locked || locked.status === 'RESOLVED')
        throw new ConflictException('Caso já resolvido.');
      if (safetyEventId) {
        const [event] = await tx
          .select()
          .from(safetyEvents)
          .where(eq(safetyEvents.id, safetyEventId));
        if (
          event &&
          event.status === 'ACTIVE' &&
          !canCloseSafety(actor, event.kind as SafetySignalKind, event.scope as SafetyScope)
        ) {
          throw new ForbiddenException(
            'Este sinal de segurança só pode ser encerrado pelo profissional do domínio dele (sinal clínico: médico com CRM ativo).',
          );
        }
        if (event && event.status === 'ACTIVE') {
          await tx
            .update(safetyEvents)
            .set({
              status: 'RESOLVED',
              resolvedBy: actor.staffId,
              resolutionNote: note,
              resolvedAt: now,
            })
            .where(eq(safetyEvents.id, safetyEventId));
        }
      }
      await tx
        .update(exceptionCases)
        .set({
          status: 'RESOLVED',
          resolvedAt: now,
          assignedStaffId: actor.staffId,
          resolution: { outcome: 'RESOLVED', note },
        })
        .where(eq(exceptionCases.id, id));
      await this.recordResolved(tx, row.userId, id, row.kind, 'RESOLVED');
      await this.audit.append(tx, {
        actorId: actor.staffId,
        userId: row.userId,
        action: 'exception.resolve',
        entityType: 'exception_case',
        entityId: id,
        changes: { kind: row.kind, safetyEventId: safetyEventId ?? null },
      });
    });
    await this.outbox.flushSoon();
    return { id, status: 'RESOLVED' as const };
  }

  /** Protocolo (plano de treino ou alimentar) que o caso pede para aprovar, com a prévia da semana. */
  async protocol(user: AuthenticatedUser, id: string, now: Date = new Date()) {
    const { actor, row } = await this.load(user, id);
    const { action, pending } = await this.publishProposalOf(row);
    const canEdit =
      pending && row.status !== 'RESOLVED' && this.canAct(actor, row.domain as ExceptionDomain);
    return this.protocols.view(row.userId, action, canEdit, now);
  }

  /** Edição manual do rascunho pelo profissional do domínio; a aprovação continua separada. */
  async editProtocol(
    user: AuthenticatedUser,
    id: string,
    request: EditProtocolRequest,
    now: Date = new Date(),
  ) {
    const { actor, row } = await this.load(user, id);
    this.assertCanAct(actor, row.domain as ExceptionDomain);
    if (row.status === 'RESOLVED') throw new ConflictException('Caso já resolvido.');
    const { action, pending } = await this.publishProposalOf(row);
    if (!pending) throw new ConflictException('A proposta não está mais pendente.');
    const edited = await this.protocols.validate(row.userId, action, request, now);
    await this.db.runAsSystem(async (tx) => {
      const [locked] = await tx
        .select({ status: exceptionCases.status })
        .from(exceptionCases)
        .where(eq(exceptionCases.id, id))
        .for('update');
      if (!locked || locked.status === 'RESOLVED')
        throw new ConflictException('Caso já resolvido.');
      await this.protocols.replaceDraft(tx, row.userId, action, edited);
      await tx
        .update(exceptionCases)
        .set({ status: 'IN_REVIEW', assignedStaffId: actor.staffId })
        .where(eq(exceptionCases.id, id));
      await this.audit.append(tx, {
        actorId: actor.staffId,
        userId: row.userId,
        action: 'exception.protocol_edit',
        entityType: 'exception_case',
        entityId: id,
        changes: { planId: action.planId, kind: edited.kind },
      });
    });
    return this.protocols.view(row.userId, action, true, now);
  }

  /**
   * Pede aos agentes um novo protocolo com a orientação do profissional: o caso fecha, o rascunho
   * é descartado pelo planejamento e o novo volta para a fila pela mesma política.
   */
  async requestAdjustment(
    user: AuthenticatedUser,
    id: string,
    instruction: string,
    now: Date = new Date(),
  ) {
    const { actor, row } = await this.load(user, id);
    this.assertCanAct(actor, row.domain as ExceptionDomain);
    const { action, pending } = await this.publishProposalOf(row);
    if (!pending) throw new ConflictException('A proposta não está mais pendente.');
    await this.db.runAsSystem(async (tx) => {
      const [locked] = await tx
        .select({ status: exceptionCases.status })
        .from(exceptionCases)
        .where(eq(exceptionCases.id, id))
        .for('update');
      if (!locked || locked.status === 'RESOLVED')
        throw new ConflictException('Caso já resolvido.');
      await tx
        .update(coachingProposals)
        .set({ status: 'REJECTED' })
        .where(
          and(
            eq(coachingProposals.id, row.subject.proposalId as string),
            eq(coachingProposals.status, 'PENDING'),
          ),
        );
      await tx
        .update(exceptionCases)
        .set({
          status: 'RESOLVED',
          resolvedAt: now,
          assignedStaffId: actor.staffId,
          resolution: { outcome: 'ADJUSTMENT_REQUESTED', note: instruction },
        })
        .where(eq(exceptionCases.id, id));
      await this.recordResolved(tx, row.userId, id, row.kind, 'ADJUSTMENT_REQUESTED');
      await this.audit.append(tx, {
        actorId: actor.staffId,
        userId: row.userId,
        action: 'exception.protocol_adjust',
        entityType: 'exception_case',
        entityId: id,
        changes: { planId: action.planId, proposalId: row.subject.proposalId ?? null },
      });
    });
    await this.outbox.flushSoon();
    return { id, status: 'RESOLVED' as const, outcome: 'ADJUSTMENT_REQUESTED' as const };
  }

  /**
   * Regera do zero o protocolo do caso (treino OU alimentar), sem orientação do profissional: a
   * proposta atual é recusada sem chegar ao aluno, o caso fecha e o planejamento refaz aquele
   * protocolo a partir do Estado do Aluno e da estratégia salva (o rascunho antigo não serve de
   * base). O novo entra na Fila pela política de sempre, como um caso novo.
   *
   * Clique duplo e chamadas concorrentes: o caso é travado (`FOR UPDATE`); quem chega depois de
   * uma regeneração já pedida recebe a mesma resposta, sem novo evento — uma geração só.
   */
  async regenerateProtocol(
    user: AuthenticatedUser,
    id: string,
    now: Date = new Date(),
  ): Promise<ProtocolRegenerationResponse> {
    const { actor, row } = await this.load(user, id);
    this.assertCanAct(actor, row.domain as ExceptionDomain);
    const done: ProtocolRegenerationResponse = {
      id,
      status: 'RESOLVED',
      outcome: 'REGENERATION_REQUESTED',
    };
    if (wasRegenerated(row)) return done;
    const { action, proposalId } = await this.regenerableProposalOf(row);
    if (row.status === 'RESOLVED') throw new ConflictException('Caso já resolvido.');
    const kind = protocolKindOf(action);
    const replayed = await this.db.runAsSystem(async (tx) => {
      const [locked] = await tx
        .select({ status: exceptionCases.status, resolution: exceptionCases.resolution })
        .from(exceptionCases)
        .where(eq(exceptionCases.id, id))
        .for('update');
      if (locked && wasRegenerated(locked)) return true;
      if (!locked || locked.status === 'RESOLVED')
        throw new ConflictException('Caso já resolvido.');
      const rejected = await tx
        .update(coachingProposals)
        .set({ status: 'REJECTED' })
        .where(and(eq(coachingProposals.id, proposalId), eq(coachingProposals.status, 'PENDING')))
        .returning({ id: coachingProposals.id });
      if (rejected.length === 0) throw new ConflictException('A proposta não está mais pendente.');
      await tx
        .update(exceptionCases)
        .set({
          status: 'RESOLVED',
          resolvedAt: now,
          assignedStaffId: actor.staffId,
          resolution: { outcome: 'REGENERATION_REQUESTED', note: REGENERATION_NOTE },
        })
        .where(eq(exceptionCases.id, id));
      // O evento leva o planejamento a refazer o protocolo (job idempotente pelo id do evento).
      await this.recordResolved(tx, row.userId, id, row.kind, 'REGENERATION_REQUESTED');
      await this.audit.append(tx, {
        actorId: actor.staffId,
        userId: row.userId,
        action: 'exception.protocol_regenerate',
        entityType: 'exception_case',
        entityId: id,
        changes: { planId: action.planId, proposalId, kind, reason: 'FULL_REGENERATION' },
      });
      return false;
    });
    if (!replayed) await this.outbox.flushSoon();
    return done;
  }

  /**
   * Só a publicação de protocolo (treino ou alimentar) regera do zero. Troca de exercício e
   * ajuste têm a própria revisão; a geração que falhou é refeita pelo `resolve`.
   */
  private async regenerableProposalOf(row: { kind: string; subject: Record<string, string> }) {
    if (row.kind === 'DECISION_FAILURE') {
      throw new UnprocessableEntityException(
        'Geração que falhou não tem protocolo para regerar: encerre o caso (resolve) e os agentes refazem.',
      );
    }
    const proposalId = row.subject.proposalId;
    const [proposal] =
      row.kind === 'PROTOCOL_REVIEW' && proposalId
        ? await this.db.runAsSystem((tx) =>
            tx
              .select({ action: coachingProposals.action })
              .from(coachingProposals)
              .where(eq(coachingProposals.id, proposalId)),
          )
        : [];
    if (!proposalId || !proposal || !isPublishPlanAction(proposal.action)) {
      throw new UnprocessableEntityException(
        'Só o protocolo de treino ou alimentar em revisão pode ser regerado do zero.',
      );
    }
    return { action: proposal.action, proposalId };
  }

  /** Carrega o caso de troca sem equivalente seguro (a equipe escolhe o exercício). */
  private async swapGapCase(user: AuthenticatedUser, id: string) {
    const { actor, row } = await this.load(user, id);
    if (row.kind !== 'PROTOCOL_REVIEW' || row.subject.source !== 'SWAP_GAP') {
      throw new NotFoundException('Este caso não é uma troca de exercício sem equivalente.');
    }
    return { actor, row };
  }

  /** Exercícios seguros e viáveis para o aluno, para a equipe escolher no lugar do que ele quer trocar. */
  async swapOptions(user: AuthenticatedUser, id: string) {
    const { row } = await this.swapGapCase(user, id);
    const fromExerciseId = row.subject.fromExerciseId ?? '';
    const options = (await this.protocols.swapOptions(row.userId)).filter(
      (option) => option.id !== fromExerciseId,
    );
    const fromName =
      this.protocols.exerciseNames([fromExerciseId])[fromExerciseId] ?? fromExerciseId;
    return { fromExerciseId, fromName, options };
  }

  /**
   * A equipe escolhe o exercício da troca sem equivalente: a troca entra no protocolo (nova
   * versão, assinada) e o aluno recebe o protocolo atualizado. O exercício precisa estar entre
   * os seguros e viáveis para o aluno.
   */
  async substituteForCase(
    user: AuthenticatedUser,
    id: string,
    toExerciseId: string,
    now: Date = new Date(),
  ) {
    const { actor, row } = await this.swapGapCase(user, id);
    this.assertCanAct(actor, row.domain as ExceptionDomain);
    if (row.status === 'RESOLVED') throw new ConflictException('Caso já resolvido.');
    const fromExerciseId = row.subject.fromExerciseId ?? '';
    const allowed = await this.protocols.swapOptions(row.userId, now);
    const chosen = allowed.find((option) => option.id === toExerciseId);
    if (!chosen || toExerciseId === fromExerciseId) {
      throw new BadRequestException(
        'Esse exercício não está entre os seguros e viáveis para este aluno.',
      );
    }
    const reason = (row.subject.reason ?? 'OTHER') as Extract<
      CoachingAction,
      { type: 'SUBSTITUTE_EXERCISE' }
    >['reason'];
    const action = {
      type: 'SUBSTITUTE_EXERCISE' as const,
      planSessionKey: row.subject.planSessionKey ?? '',
      fromExerciseId,
      toExerciseId,
      reason,
      scope: 'PLAN' as const,
    };
    const executed = await this.db.runAsSystem(async (tx) => {
      const [locked] = await tx
        .select({ status: exceptionCases.status })
        .from(exceptionCases)
        .where(eq(exceptionCases.id, id))
        .for('update');
      if (!locked || locked.status === 'RESOLVED')
        throw new ConflictException('Caso já resolvido.');
      const [timezone] = await tx
        .select({ tz: users.timezone })
        .from(users)
        .where(eq(users.id, row.userId));
      const [proposal] = await tx
        .insert(coachingProposals)
        .values({
          userId: row.userId,
          taskId: 'staff.choose_substitute',
          actionType: action.type,
          action,
          rationale: [
            'O profissional escolheu o exercício: não havia equivalente seguro automático.',
          ],
          evidence: [],
          assumptions: [],
          uncertainty: 'LOW',
          expectedOutcome: 'O aluno treina sem o exercício que não pode ou não quer fazer.',
          stateVersion: 0,
          status: 'ACCEPTED',
          expiresAt: now,
        })
        .returning({ id: coachingProposals.id });
      if (!proposal) throw new Error('falha ao gravar a proposta da troca');
      const [decision] = await tx
        .insert(coachingDecisions)
        .values({
          userId: row.userId,
          proposalId: proposal.id,
          verdict: 'EXECUTE',
          reasons: [`Troca escolhida por profissional (${actor.council ?? 'ADMIN'}).`],
          decidedBy: 'STAFF',
          staffId: actor.staffId,
        })
        .returning({ id: coachingDecisions.id });
      if (!decision) throw new Error('falha ao gravar a decisão da troca');
      const result = await this.commands.substituteExercise(
        tx,
        row.userId,
        action,
        decision.id,
        todayIn(timezone?.tz ?? null, now),
      );
      await this.pipeline.recordExecution(tx, {
        userId: row.userId,
        decisionId: decision.id,
        command: result.command,
        status: result.result.applied === true ? 'SUCCEEDED' : 'FAILED',
        result: result.result,
      });
      if (result.result.applied !== true) {
        throw new ConflictException(
          'Não foi possível aplicar a troca: o exercício não está mais no protocolo ativo.',
        );
      }
      await this.signReleasedPlan(tx, action, result, actor.staffId, now);
      await tx
        .update(exceptionCases)
        .set({
          status: 'RESOLVED',
          resolvedAt: now,
          assignedStaffId: actor.staffId,
          resolution: {
            outcome: 'APPROVED',
            note: `Trocado por ${chosen.name}.`,
            decisionId: decision.id,
          },
        })
        .where(eq(exceptionCases.id, id));
      await this.recordResolved(tx, row.userId, id, row.kind, 'APPROVED');
      await this.audit.append(tx, {
        actorId: actor.staffId,
        userId: row.userId,
        action: 'exception.substitute',
        entityType: 'exception_case',
        entityId: id,
        changes: { fromExerciseId, toExerciseId },
      });
      return result;
    });
    await this.outbox.flushSoon();
    await this.notifyAfterRelease(row.userId, id, { executed, action });
    return { id, status: 'RESOLVED' as const };
  }

  /** Respostas da anamnese do aluno do caso (dado de saúde: a leitura fica na auditoria). */
  async anamnesisOf(user: AuthenticatedUser, id: string) {
    const { actor, row } = await this.load(user, id);
    const view = await this.anamnesis.submittedAnswersOf(row.userId);
    if (!view) throw new NotFoundException('O aluno não tem anamnese enviada.');
    await this.db.runAsSystem((tx) =>
      this.audit.append(tx, {
        actorId: actor.staffId,
        userId: row.userId,
        action: 'exception.anamnesis_viewed',
        entityType: 'exception_case',
        entityId: id,
        changes: { kind: row.kind },
      }),
    );
    return view;
  }

  /** Protocolo ativo do aluno, aberto para emenda pelo profissional do domínio. */
  async activeProtocol(
    user: AuthenticatedUser,
    studentId: string,
    kind: 'TRAINING' | 'NUTRITION',
    now: Date = new Date(),
  ) {
    const actor = await this.actorOf(user);
    const action = await this.protocols.activeAction(studentId, kind);
    if (!action) throw new NotFoundException('O aluno não tem protocolo ativo desse tipo.');
    return this.protocols.view(studentId, action, this.canAct(actor, kind), now, true);
  }

  /**
   * Emenda do protocolo ativo: o profissional do domínio altera o que já está em uso. A edição
   * passa pelas mesmas travas da geração, vira a versão seguinte do plano (agenda mantida) e o
   * aluno recebe o protocolo atualizado.
   */
  async amendProtocol(
    user: AuthenticatedUser,
    studentId: string,
    request: EditProtocolRequest,
    now: Date = new Date(),
  ) {
    const actor = await this.actorOf(user);
    this.assertCanAct(actor, request.kind);
    const action = await this.protocols.activeAction(studentId, request.kind);
    if (!action) throw new NotFoundException('O aluno não tem protocolo ativo desse tipo.');
    const edited = await this.protocols.validate(studentId, action, request, now, true);
    const amended = await this.db.runAsSystem(async (tx) => {
      const [timezone] = await tx
        .select({ tz: users.timezone })
        .from(users)
        .where(eq(users.id, studentId));
      const today = todayIn(timezone?.tz ?? null, now);
      const result =
        edited.kind === 'TRAINING'
          ? await this.commands.amendTrainingPlan(tx, studentId, edited.structure, today)
          : await this.commands.amendNutritionPlan(tx, studentId, edited.structure);
      if (!result) throw new ConflictException('O protocolo ativo mudou. Recarregue a tela.');
      await this.signPlan(tx, request.kind, result.planId, actor.staffId, now);
      await this.audit.append(tx, {
        actorId: actor.staffId,
        userId: studentId,
        action: 'protocol.amend',
        entityType: request.kind === 'TRAINING' ? 'training_plan' : 'nutrition_plan',
        entityId: result.planId,
        changes: { previousPlanId: action.planId, kind: request.kind },
      });
      return result;
    });
    await this.outbox.flushSoon();
    await this.sendToStudent(
      studentId,
      msg.protocolAmendedMessage(
        request.kind,
        await this.links.shortUrl(
          studentId,
          request.kind === 'NUTRITION' ? { next: '/alimentacao' } : {},
        ),
      ),
      `amend_${amended.planId}`,
    );
    return { planId: amended.planId, kind: request.kind };
  }

  private async publishProposalOf(row: { subject: Record<string, string> }) {
    const proposalId = row.subject.proposalId;
    const [proposal] = proposalId
      ? await this.db.runAsSystem((tx) =>
          tx
            .select({ action: coachingProposals.action, status: coachingProposals.status })
            .from(coachingProposals)
            .where(eq(coachingProposals.id, proposalId)),
        )
      : [];
    if (!proposal || !isPublishPlanAction(proposal.action)) {
      throw new NotFoundException('Este caso não tem protocolo para revisar.');
    }
    return { action: proposal.action, pending: proposal.status === 'PENDING' };
  }

  /** Trilha de decisões de um aluno (proposta, veredito, quem decidiu, execução). */
  async decisionsOf(userId: string) {
    return this.db.runAsSystem((tx) =>
      tx
        .select({
          proposalId: coachingProposals.id,
          action: coachingProposals.actionType,
          rationale: coachingProposals.rationale,
          assumptions: coachingProposals.assumptions,
          uncertainty: coachingProposals.uncertainty,
          verdict: coachingDecisions.verdict,
          decidedBy: coachingDecisions.decidedBy,
          reasons: coachingDecisions.reasons,
          command: decisionExecutions.command,
          createdAt: coachingProposals.createdAt,
        })
        .from(coachingProposals)
        .leftJoin(coachingDecisions, eq(coachingDecisions.proposalId, coachingProposals.id))
        .leftJoin(decisionExecutions, eq(decisionExecutions.decisionId, coachingDecisions.id))
        .where(eq(coachingProposals.userId, userId))
        .orderBy(desc(coachingProposals.createdAt))
        .limit(50),
    );
  }

  private assertCanAct(actor: Actor, domain: ExceptionDomain): void {
    if (actor.role === 'PROFESSIONAL' && !actor.councilActive) {
      throw new ForbiddenException('Seu registro no conselho não está ativo.');
    }
    if (!this.canAct(actor, domain)) {
      throw new ForbiddenException('Este caso é de outro domínio profissional.');
    }
  }

  private recordResolved(
    tx: TenantTransaction,
    userId: string,
    exceptionCaseId: string,
    kind: string,
    outcome:
      | 'APPROVED'
      | 'AUTO_RELEASED'
      | 'REJECTED'
      | 'RESOLVED'
      | 'ADJUSTMENT_REQUESTED'
      | 'REGENERATION_REQUESTED',
  ) {
    return this.events.record(tx, {
      userId,
      type: 'ExceptionResolved',
      payload: { exceptionCaseId, kind, outcome },
    });
  }

  private async sendToStudent(userId: string, text: string, exceptionId: string): Promise<void> {
    await this.store.persistTurn({
      userId,
      direction: 'OUTBOUND',
      content: text,
      validationPassed: true,
    });
    const job: WhatsappOutboundJob = {
      userId,
      type: 'CONVERSATION_MESSAGE',
      text,
      dedupeId: `exception_${exceptionId}`,
    };
    await this.queues.enqueue(QUEUE.whatsappOutbound, 'agent-message', job, {
      jobId: `agent-message_exception_${exceptionId}`,
    });
  }
}
