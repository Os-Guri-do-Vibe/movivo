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
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';

import {
  canActOnDomain,
  canResolveSafety,
  domainsForCouncil,
  type Council,
  type EditProtocolRequest,
  type ExceptionDomain,
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
  safetyEvents,
  staff,
  users,
} from '../../core/database/schema';
import {
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database/tenant-database.service';
import { AuditService } from '../admin/audit.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { DecisionPipeline } from '../coaching/decision/decision-pipeline.service';
import { ConversationStore } from '../conversation/conversation-store';
import { DomainEventRecorder } from '../domain-events/domain-event-recorder';
import { OutboxRelay } from '../domain-events/outbox-relay';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import type { WhatsappOutboundJob } from '../jobs/whatsapp-outbound.contract';
import { examFileOf, examViewOf } from '../medical/medical-exam.service';
import { todayIn } from '../planning/plan-generation.service';
import { isPublishPlanAction, ProtocolReviewService } from '../planning/protocol-review.service';
import { StudentStateReader } from '../student-state/student-state.reader';
import { ProposalRunner } from './proposal-runner.service';

const PRIORITY_RANK = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 } as const;
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

/** Quem está agindo: o conselho limita os domínios; ADMIN só lê (e resolve o que é geral). */
export interface Actor {
  staffId: string;
  role: 'PROFESSIONAL' | 'ADMIN';
  council: Council | null;
  councilActive: boolean;
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
    };
  }

  private domainsOf(actor: Actor): readonly ExceptionDomain[] | null {
    return actor.council ? domainsForCouncil(actor.council) : null;
  }

  /** Pode agir neste domínio? Profissional: o do conselho dele, com registro ativo. ADMIN: só o geral. */
  private canAct(actor: Actor, domain: ExceptionDomain): boolean {
    if (actor.role === 'ADMIN') return domain === 'GENERAL';
    return actor.councilActive && actor.council !== null && canActOnDomain(actor.council, domain);
  }

  async list(user: AuthenticatedUser, filter: { status?: 'OPEN' | 'IN_REVIEW' | 'RESOLVED' }) {
    const actor = await this.actorOf(user);
    const domains = this.domainsOf(actor);
    const rows = await this.db.runAsSystem((tx) =>
      tx
        .select({
          id: exceptionCases.id,
          kind: exceptionCases.kind,
          priority: exceptionCases.priority,
          status: exceptionCases.status,
          domain: exceptionCases.domain,
          summary: exceptionCases.summary,
          createdAt: exceptionCases.createdAt,
          assignedStaffId: exceptionCases.assignedStaffId,
          studentId: exceptionCases.userId,
          studentName: users.name,
        })
        .from(exceptionCases)
        .innerJoin(users, eq(users.id, exceptionCases.userId))
        .where(
          and(
            filter.status
              ? eq(exceptionCases.status, filter.status)
              : ne(exceptionCases.status, 'RESOLVED'),
            domains ? inArray(exceptionCases.domain, [...domains]) : undefined,
          ),
        )
        .orderBy(asc(exceptionCases.createdAt))
        .limit(200),
    );
    return rows
      .map((row) => ({ ...row, canResolve: this.canAct(actor, row.domain as ExceptionDomain) }))
      .sort(
        (a, b) =>
          (PRIORITY_RANK[a.priority as keyof typeof PRIORITY_RANK] ?? 9) -
            (PRIORITY_RANK[b.priority as keyof typeof PRIORITY_RANK] ?? 9) ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      );
  }

  /** Contagem de casos abertos por prioridade (o sino do painel). */
  async summary(user: AuthenticatedUser) {
    const cases = await this.list(user, {});
    return {
      open: cases.length,
      urgent: cases.filter((c) => c.priority === 'URGENT' || c.priority === 'HIGH').length,
    };
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
      actor.council !== null &&
      actor.councilActive &&
      canResolveSafety(actor.council, safety.kind as SafetySignalKind, safety.scope as SafetyScope);
    return {
      case: { ...row, canResolve: this.canAct(actor, row.domain as ExceptionDomain) },
      student: student ?? null,
      proposal,
      decision,
      safety: safety ? { ...safety, canResolve: canResolveSafetyEvent } : null,
      state: stateRead.slices,
      exam,
    };
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
    const proposalId = row.subject.proposalId;
    if (!proposalId) throw new BadRequestException('Este caso não tem proposta para aprovar.');
    if (row.status === 'RESOLVED') throw new ConflictException('Caso já resolvido.');

    const result = await this.db.runAsSystem(async (tx) => {
      const [locked] = await tx
        .select()
        .from(exceptionCases)
        .where(eq(exceptionCases.id, id))
        .for('update');
      if (!locked || locked.status === 'RESOLVED')
        throw new ConflictException('Caso já resolvido.');
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
      const [decision] = await tx
        .insert(coachingDecisions)
        .values({
          userId: row.userId,
          proposalId,
          verdict: 'EXECUTE',
          reasons: [
            `Aprovado por profissional (${actor.council ?? 'ADMIN'}).${note ? ` ${note}` : ''}`,
          ],
          decidedBy: 'STAFF',
          staffId: actor.staffId,
        })
        .returning({ id: coachingDecisions.id });
      if (!decision) throw new Error('falha ao gravar a decisão do profissional');
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
          assignedStaffId: actor.staffId,
          resolution: { outcome: 'APPROVED', note: note ?? null, decisionId: decision.id },
        })
        .where(eq(exceptionCases.id, id));
      await this.recordResolved(tx, row.userId, id, row.kind, 'APPROVED');
      await this.audit.append(tx, {
        actorId: actor.staffId,
        userId: row.userId,
        action: 'exception.approve',
        entityType: 'exception_case',
        entityId: id,
        changes: { proposalId, decisionId: decision.id, command: executed.command },
      });
      return executed;
    });
    await this.outbox.flushSoon();
    const text = result.result.text;
    if (typeof text === 'string') await this.sendToStudent(row.userId, text, id);
    return { id, status: 'RESOLVED' as const, command: result.command };
  }

  /** Recusa a proposta (nada muda no plano do aluno) e encerra o caso com o motivo. */
  async reject(user: AuthenticatedUser, id: string, note: string, now: Date = new Date()) {
    const { actor, row } = await this.load(user, id);
    this.assertCanAct(actor, row.domain as ExceptionDomain);
    const proposalId = row.subject.proposalId;
    if (!proposalId) throw new BadRequestException('Este caso não tem proposta para recusar.');
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
          !(
            actor.council !== null &&
            canResolveSafety(
              actor.council,
              event.kind as SafetySignalKind,
              event.scope as SafetyScope,
            )
          )
        ) {
          throw new ForbiddenException(
            'Este sinal de segurança só pode ser encerrado pelo profissional do domínio dele.',
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
    outcome: 'APPROVED' | 'REJECTED' | 'RESOLVED' | 'ADJUSTMENT_REQUESTED',
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
