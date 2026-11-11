/**
 * Fecha o ciclo e prepara o próximo:
 *
 *   respostas → análise do especialista (começo × agora) → conversa da persona com o aluno →
 *   protocolos novos de treino e alimentação pelo mesmo caminho de sempre (agentes montam, a
 *   Fila do Profissional audita, liberação automática depois da janela de revisão).
 */
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import { personaOf, type CycleReassessmentAnswers, type StudentConstraint } from '@movivo/shared';

import { AgentRunner, AgentTaskError } from '../../core/agents/agent-runner';
import type { AgentContextSources } from '../../core/agents/agent-context';
import { HealthCipherService } from '../../core/database/health-cipher.service';
import {
  bodyMeasurements,
  cycleReassessments,
  dailyCheckIns,
  sessionExecutions,
  trainingPlans,
} from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { DecisionExecutor } from '../coaching/decision/decision-executor.service';
import { DecisionPipeline } from '../coaching/decision/decision-pipeline.service';
import { DomainCommands } from '../conversation/domain-commands.service';
import { OutboxRelay } from '../domain-events/outbox-relay';
import { PublishedMethodologyReader } from '../methodology/published-methodology.reader';
import { addDays, mondayOf } from '../planning/calc/week-planner';
import { PlanGenerationService, todayIn } from '../planning/plan-generation.service';
import { AgentMessenger } from '../progress/agent-messenger';
import { loadMetricsView } from '../progress/load-metrics';
import { collectLoadMetrics } from '../progress/load-metrics-data';
import { collectWeeks } from '../progress/review-data';
import { regionOf } from '../progress/pain-tasks';
import { StudentStateReader } from '../student-state/student-state.reader';
import { ConversationStore } from '../conversation/conversation-store';
import { ReassessmentPhotosService } from './reassessment-photos.service';
import { ReassessmentService } from './reassessment.service';
import { renewalOf } from './renewal-instructions';
import { availabilityFromRoutine } from './routine-availability';
import {
  cycleReviewTask,
  cycleWrapUpTask,
  type CycleReview,
  type CycleReviewInput,
} from './reassessment-tasks';

const MAX_WEEKS = 16;

export type RenewalResult =
  | { status: 'SKIPPED'; reason: 'NOT_FOUND' | 'ALREADY_HANDLED' }
  | { status: 'FAILED'; reason: string }
  | { status: 'PLANNED'; generation: string };

@Injectable()
export class CycleRenewalService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly runner: AgentRunner,
    private readonly cipher: HealthCipherService,
    private readonly state: StudentStateReader,
    private readonly methodology: PublishedMethodologyReader,
    private readonly reassessments: ReassessmentService,
    private readonly photos: ReassessmentPhotosService,
    private readonly generation: PlanGenerationService,
    private readonly messenger: AgentMessenger,
    private readonly store: ConversationStore,
    private readonly pipeline: DecisionPipeline,
    private readonly executor: DecisionExecutor,
    private readonly commands: DomainCommands,
    private readonly outbox: OutboxRelay,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CycleRenewalService.name);
  }

  async handle(
    userId: string,
    reassessmentId: string,
    now: Date = new Date(),
  ): Promise<RenewalResult> {
    const loaded = await this.reassessments.answersOf(userId, reassessmentId);
    if (!loaded) return { status: 'SKIPPED', reason: 'NOT_FOUND' };
    const { row, answers } = loaded;

    let review: CycleReview;
    if (row.status === 'SUBMITTED') {
      const analyzed = await this.analyze(userId, row, answers, now);
      if (analyzed.status === 'FAILED') return analyzed;
      review = analyzed.review;
    } else if (row.status === 'ANALYZED' && row.analysis) {
      review = JSON.parse(await this.cipher.decryptHealth(row.analysis)) as CycleReview;
    } else {
      return { status: 'SKIPPED', reason: 'ALREADY_HANDLED' };
    }

    // Só um executor segue: o status sai de ANALYZED antes de gerar (sem duplicar rascunhos).
    const [claimed] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .update(cycleReassessments)
        .set({ status: 'PLANNED' })
        .where(
          and(
            eq(cycleReassessments.id, reassessmentId),
            eq(cycleReassessments.userId, userId),
            eq(cycleReassessments.status, 'ANALYZED'),
          ),
        )
        .returning({ id: cycleReassessments.id }),
    );
    if (!claimed) return { status: 'SKIPPED', reason: 'ALREADY_HANDLED' };

    await this.talk(userId, review, now);
    await this.flagHealth(userId, answers, review);
    // A rotina nova vira a disponibilidade do aluno ANTES de montar o próximo ciclo.
    const routineNote = await this.applyRoutine(userId, answers, now);
    const renewal = renewalOf(review, answers);
    if (routineNote) renewal.notes.push(routineNote);

    const result = await this.generation.generate(userId, { now, renewal });
    if (result.status === 'FAILED') {
      await this.fail(userId, reassessmentId, result.reason);
      return { status: 'FAILED', reason: result.reason };
    }
    if (result.status === 'PUBLISHED') {
      await this.db.runAsUser(userId, 'USER', (tx) =>
        tx
          .update(cycleReassessments)
          .set({
            nextTrainingPlanId: result.trainingPlanId,
            nextNutritionPlanId: result.nutritionPlanId,
          })
          .where(eq(cycleReassessments.id, reassessmentId)),
      );
    }
    this.logger.info(
      { event: 'cycle_renewal', userId, generation: result.status },
      'próximo ciclo encaminhado',
    );
    return { status: 'PLANNED', generation: result.status };
  }

  /**
   * Grava a disponibilidade que a rotina nova pede (dias, período e tempo por sessão), pelo mesmo
   * caminho de decisão das mudanças de agenda do chat. Devolve um aviso para a Fila, se houver.
   */
  private async applyRoutine(
    userId: string,
    answers: CycleReassessmentAnswers,
    now: Date,
  ): Promise<string | null> {
    if (!answers.routine.changed) return null;
    const read = await this.state.read(userId, ['identity', 'availability'], now);
    const today = todayIn(
      (read.slices.identity as { timezone?: string | null } | undefined)?.timezone ?? null,
      now,
    );
    const current = (read.slices.availability as StudentConstraint[] | undefined)?.find(
      (c): c is Extract<StudentConstraint, { kind: 'AVAILABILITY' }> => c.kind === 'AVAILABILITY',
    );
    const next = availabilityFromRoutine(answers.routine, current ?? null);
    if (!next) return null;
    const action = { type: 'RECORD_CONSTRAINT' as const, constraint: next.constraint };
    const outcome = await this.executor.decideAndRun(
      userId,
      'reassessment.routine_availability',
      {
        action,
        rationale: ['O aluno contou na reavaliação do ciclo que a rotina mudou.'],
        evidence: [],
        assumptions: [],
        uncertainty: 'LOW',
        expectedOutcome: 'O próximo ciclo respeita os dias, o período e o tempo de agora.',
      },
      (tx) => this.commands.recordConstraint(tx, userId, action, today),
    );
    if (outcome.verdict !== 'EXECUTE') {
      return 'A rotina nova do aluno não foi aplicada automaticamente à disponibilidade: confirme dias e tempo com ele antes de liberar o protocolo.';
    }
    return next.note;
  }

  private async analyze(
    userId: string,
    row: typeof cycleReassessments.$inferSelect,
    answers: CycleReassessmentAnswers,
    now: Date,
  ): Promise<{ status: 'OK'; review: CycleReview } | { status: 'FAILED'; reason: string }> {
    const base = await this.db.runAsUser(userId, 'USER', (tx) =>
      this.buildInput(tx, userId, row, answers),
    );
    const identity = (await this.state.read(userId, ['identity'], now)).slices.identity as
      { biologicalSex?: string | null } | undefined;
    const today = row.cycleEndedOn;
    const galleryIds = await this.photos.adopt(userId, row.id, today);
    const comparison = await this.photos.compare(
      userId,
      row.id,
      identity?.biologicalSex ?? null,
      today,
      galleryIds,
    );
    const input: CycleReviewInput = {
      ...base,
      photos: comparison
        ? {
            comparable: comparison.comparable,
            visibleChanges: comparison.visibleChanges,
            bodyFatRange: comparison.bodyFatRange,
            confidence: comparison.confidence,
            limitations: comparison.limitations,
          }
        : null,
    };
    try {
      const run = await this.runner.run(cycleReviewTask, input, {
        userId,
        sources: this.sources(userId, now),
      });
      const encrypted = await this.cipher.encryptHealth(JSON.stringify(run.output));
      await this.db.runAsUser(userId, 'USER', (tx) =>
        tx
          .update(cycleReassessments)
          .set({ analysis: encrypted, status: 'ANALYZED' })
          .where(eq(cycleReassessments.id, row.id)),
      );
      return { status: 'OK', review: run.output };
    } catch (error) {
      if (!(error instanceof AgentTaskError)) throw error;
      const reason = 'a análise do ciclo não teve saída válida';
      await this.fail(userId, row.id, reason);
      return { status: 'FAILED', reason };
    }
  }

  private async buildInput(
    tx: Parameters<Parameters<TenantDatabase['runAsUser']>[2]>[0],
    userId: string,
    row: typeof cycleReassessments.$inferSelect,
    answers: CycleReassessmentAnswers,
  ): Promise<CycleReviewInput> {
    const [training] = row.trainingPlanId
      ? await tx
          .select({ startsOn: trainingPlans.startsOn, structure: trainingPlans.structure })
          .from(trainingPlans)
          .where(eq(trainingPlans.id, row.trainingPlanId))
      : [];
    const startsOn = training?.startsOn ?? addDays(row.cycleEndedOn, -7 * 12 + 1);
    const phases = training?.structure.phases ?? [];
    const totalWeeks = Math.max(
      1,
      Math.round(
        (Date.parse(`${row.cycleEndedOn}T00:00:00Z`) - Date.parse(`${startsOn}T00:00:00Z`)) /
          (7 * 86_400_000),
      ) + 1,
    );
    const weeks = await collectWeeks(
      tx,
      userId,
      mondayOf(row.cycleEndedOn),
      Math.min(totalWeeks, MAX_WEEKS),
    );

    const measured = await tx
      .select({
        kind: bodyMeasurements.kind,
        value: bodyMeasurements.value,
        measuredOn: bodyMeasurements.measuredOn,
      })
      .from(bodyMeasurements)
      .where(eq(bodyMeasurements.userId, userId))
      .orderBy(asc(bodyMeasurements.measuredOn));
    const byKind = new Map<string, typeof measured>();
    for (const m of measured) byKind.set(m.kind, [...(byKind.get(m.kind) ?? []), m]);
    const measurements = [...byKind].map(([kind, list]) => {
      const first = list[0];
      const last = list.length > 1 ? list[list.length - 1] : undefined;
      return {
        kind,
        start: first?.value ?? null,
        startedOn: first?.measuredOn ?? null,
        now: last?.value ?? null,
        nowOn: last?.measuredOn ?? null,
      };
    });

    const checkIns = await tx
      .select()
      .from(dailyCheckIns)
      .where(
        and(
          eq(dailyCheckIns.userId, userId),
          gte(dailyCheckIns.onDate, startsOn),
          lte(dailyCheckIns.onDate, row.cycleEndedOn),
        ),
      );
    const avg = (pick: (c: (typeof checkIns)[number]) => number | null) => {
      const values = checkIns.map(pick).filter((v): v is number => v !== null);
      return values.length === 0
        ? null
        : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
    };

    const executions = await tx
      .select({ painReports: sessionExecutions.painReports })
      .from(sessionExecutions)
      .where(
        and(
          eq(sessionExecutions.userId, userId),
          gte(sessionExecutions.performedOn, startsOn),
          lte(sessionExecutions.performedOn, row.cycleEndedOn),
        ),
      )
      .orderBy(desc(sessionExecutions.performedOn));
    const pain = new Map<string, { reports: number; maxIntensity: number }>();
    for (const execution of executions) {
      for (const report of execution.painReports) {
        const key = regionOf(report.region) ?? report.region.toLowerCase();
        const current = pain.get(key) ?? { reports: 0, maxIntensity: 0 };
        pain.set(key, {
          reports: current.reports + 1,
          maxIntensity: Math.max(current.maxIntensity, report.intensity),
        });
      }
    }
    const loadMetrics = await collectLoadMetrics(tx, userId, row.cycleEndedOn);

    return {
      cycle: {
        startsOn,
        endedOn: row.cycleEndedOn,
        weeks: totalWeeks,
        phases: phases.map((p) => ({
          name: p.name,
          focus: p.focus,
          endsWithDeload: p.endsWithDeload,
          mesocycle: p.mesocycle,
        })),
      },
      weeks,
      measurements,
      answers,
      loadMetrics: loadMetricsView(loadMetrics),
      checkIns: {
        answeredDays: checkIns.length,
        avgEnergy: avg((c) => c.energy),
        avgSleep: avg((c) => c.sleep),
        avgStress: avg((c) => c.stress),
        avgMood: avg((c) => c.mood),
      },
      pain: [...pain].map(([region, value]) => ({ region, ...value })).slice(0, 8),
      goal: { primary: null, summary: null },
    };
  }

  /** A persona fecha o ciclo com o aluno; sem texto válido, o próximo protocolo segue mesmo assim. */
  private async talk(userId: string, review: CycleReview, now: Date): Promise<void> {
    try {
      const { firstName } = await this.store.loadUser(userId);
      const identity = (await this.state.read(userId, ['identity'], now)).slices.identity as
        { biologicalSex?: string | null } | undefined;
      const run = await this.runner.run(
        cycleWrapUpTask,
        {
          firstName,
          review: {
            summary: review.summary,
            achievements: review.achievements,
            goalStatus: review.goalStatus,
          },
        },
        { userId, sources: this.sources(userId, now), persona: personaOf(identity?.biologicalSex) },
      );
      await this.messenger.send(
        userId,
        run.output.messages,
        `cycle_wrap_${userId}_${now.toISOString().slice(0, 10)}`,
      );
    } catch (error) {
      if (!(error instanceof AgentTaskError)) throw error;
      this.logger.warn({ userId, taskId: error.taskId }, 'fechamento do ciclo sem texto válido');
    }
  }

  /** Dor, lesão ou condição nova: o profissional é avisado (auditoria, não trava o ciclo). */
  private async flagHealth(
    userId: string,
    answers: CycleReassessmentAnswers,
    review: CycleReview,
  ): Promise<void> {
    if (!answers.health.newPainOrInjury && !answers.health.newCondition) return;
    await this.db.runAsSystem((tx) =>
      this.pipeline.openCase(tx, {
        userId,
        kind: 'NO_APPLICABLE_POLICY',
        domain: 'MEDICAL',
        summary:
          `Na reavaliação do ciclo o aluno relatou ${answers.health.newPainOrInjury ? 'dor ou lesão nova' : 'condição de saúde nova'}. ${review.professionalFlags.join(' ')}`.trim(),
        subject: { source: 'CYCLE_REASSESSMENT' },
        priority: 'HIGH',
      }),
    );
    await this.outbox.flushSoon();
  }

  private async fail(userId: string, reassessmentId: string, reason: string): Promise<void> {
    await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .update(cycleReassessments)
        .set({ status: 'FAILED', failureReason: reason.slice(0, 200) })
        .where(eq(cycleReassessments.id, reassessmentId)),
    );
    await this.db.runAsSystem((tx) =>
      this.pipeline.openCase(tx, {
        userId,
        kind: 'DECISION_FAILURE',
        domain: 'GENERAL',
        summary: `A reavaliação do ciclo não virou protocolo novo: ${reason}`,
        subject: { source: 'CYCLE_REASSESSMENT', reassessmentId },
        priority: 'HIGH',
      }),
    );
    await this.outbox.flushSoon();
  }

  private sources(userId: string, now: Date): AgentContextSources {
    return {
      methodology: (domains) => this.methodology.render(domains),
      state: (slices) => this.state.read(userId, slices, now),
    };
  }
}
