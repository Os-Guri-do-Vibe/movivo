/**
 * Dor relatada no fechamento do treino: do sinal à conversa.
 *
 *   relato → especialista de recuperação interpreta (hipótese, sinais de alerta, o que poupar)
 *          → o código adapta os próximos treinos dentro das políticas (troca de exercício que
 *            sobrecarrega a região, alívio de volume) → a persona conversa com o aluno e, se for o
 *            caso, encaminha a um profissional → o que pede olhar humano vai para Alertas.
 *
 * A sentinela continua gerando o sinal de segurança em paralelo; aqui o aluno recebe orientação.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, between, eq, gte, ne } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import {
  personaOf,
  type CoachingProposal,
  type CoachedModality,
  type PainReport,
} from '@movivo/shared';

import type { AgentContextSources } from '../../core/agents/agent-context';
import { AgentRunner, AgentTaskError } from '../../core/agents/agent-runner';
import {
  dailyCheckIns,
  planSessions,
  scheduledSessions,
  sessionExecutions,
} from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';
import { ExerciseCatalogProvider } from '../catalog/exercises/exercise-catalog-provider.service';
import { rankEquivalents } from '../catalog/exercises/exercise-equivalence';
import type { ContraindicationTag } from '../catalog/exercises/exercise-catalog';
import { DecisionExecutor } from '../coaching/decision/decision-executor.service';
import { DecisionPipeline } from '../coaching/decision/decision-pipeline.service';
import { PublishedPolicies } from '../coaching/policy/published-policies';
import { ConversationStore } from '../conversation/conversation-store';
import { DomainCommands } from '../conversation/domain-commands.service';
import { OutboxRelay } from '../domain-events/outbox-relay';
import { PublishedMethodologyReader } from '../methodology/published-methodology.reader';
import { addDays } from '../planning/calc/week-planner';
import { catalogProfileOf, contraindicationsOf, exercisePreference } from '../planning/inputs';
import { todayIn } from '../planning/plan-generation.service';
import { parseStateView } from '../planning/state-view';
import { StudentStateReader } from '../student-state/student-state.reader';
import { AgentMessenger } from './agent-messenger';
import {
  painAssessmentTask,
  painGuidanceTask,
  type BodyRegion,
  type PainAssessment,
} from './pain-tasks';

const HISTORY_DAYS = 21;
const UPCOMING_DAYS = 7;
/** Trocas por relato: o bastante para poupar a região sem refazer o plano. */
const MAX_SWAPS = 6;
const MARKER_TTL_SECONDS = 14 * 86_400;
const SLICES = [
  'identity',
  'goals',
  'availability',
  'restrictions',
  'preferences',
  'training',
  'safety',
] as const;

export type PainGuidanceResult =
  | { status: 'SKIPPED'; reason: 'NO_PAIN' | 'ALREADY_HANDLED' | 'NO_VALID_ASSESSMENT' }
  | { status: 'SENT'; level: PainAssessment['level']; adaptations: number; referred: boolean };

interface Adaptation {
  sessionTitle: string;
  date: string;
  from: string;
  to: string;
}

function proposalOf(
  action: CoachingProposal['action'],
  rationale: string,
  expectedOutcome: string,
): CoachingProposal {
  return {
    action,
    rationale: [rationale],
    evidence: [],
    assumptions: [],
    uncertainty: 'LOW',
    expectedOutcome,
  };
}

@Injectable()
export class PainGuidanceService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly runner: AgentRunner,
    private readonly state: StudentStateReader,
    private readonly methodology: PublishedMethodologyReader,
    private readonly catalog: ExerciseCatalogProvider,
    private readonly executor: DecisionExecutor,
    private readonly pipeline: DecisionPipeline,
    private readonly policies: PublishedPolicies,
    private readonly commands: DomainCommands,
    private readonly store: ConversationStore,
    private readonly messenger: AgentMessenger,
    private readonly outbox: OutboxRelay,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PainGuidanceService.name);
  }

  async handle(
    userId: string,
    executionId: string,
    now: Date = new Date(),
  ): Promise<PainGuidanceResult> {
    const marker = this.keys.forUser(userId, 'pain-guidance', 'execution', executionId);
    if ((await this.redis.set(marker, '1', 'EX', MARKER_TTL_SECONDS, 'NX')) === null) {
      return { status: 'SKIPPED', reason: 'ALREADY_HANDLED' };
    }
    try {
      return await this.run(userId, executionId, now);
    } catch (error) {
      // Falha antes de orientar o aluno: libera a marca para o retry do job tentar de novo.
      await this.redis.del(marker);
      throw error;
    }
  }

  private async run(userId: string, executionId: string, now: Date): Promise<PainGuidanceResult> {
    const stateRead = await this.state.read(userId, SLICES, now);
    const view = parseStateView(stateRead.slices as Record<string, unknown>);
    const identity = stateRead.slices.identity as
      | { timezone?: string | null; biologicalSex?: string | null; firstName?: string | null }
      | undefined;
    const today = todayIn(identity?.timezone ?? null, now);
    const sources = this.sources(userId, now);

    const context = await this.db.runAsUser(userId, 'USER', async (tx) => {
      const [execution] = await tx
        .select()
        .from(sessionExecutions)
        .where(and(eq(sessionExecutions.id, executionId), eq(sessionExecutions.userId, userId)));
      const previous = await tx
        .select({
          painReports: sessionExecutions.painReports,
          performedOn: sessionExecutions.performedOn,
        })
        .from(sessionExecutions)
        .where(
          and(
            eq(sessionExecutions.userId, userId),
            gte(sessionExecutions.performedOn, addDays(today, -HISTORY_DAYS)),
            ne(sessionExecutions.id, executionId),
          ),
        );
      const upcoming = await tx
        .select({
          id: scheduledSessions.id,
          date: scheduledSessions.scheduledOn,
          key: planSessions.key,
          title: planSessions.title,
          content: planSessions.content,
        })
        .from(scheduledSessions)
        .innerJoin(planSessions, eq(planSessions.id, scheduledSessions.planSessionId))
        .where(
          and(
            eq(scheduledSessions.userId, userId),
            eq(scheduledSessions.status, 'PLANNED'),
            between(scheduledSessions.scheduledOn, today, addDays(today, UPCOMING_DAYS)),
          ),
        )
        .orderBy(asc(scheduledSessions.scheduledOn));
      const [executed] = execution?.scheduledSessionId
        ? await tx
            .select({ title: planSessions.title })
            .from(scheduledSessions)
            .innerJoin(planSessions, eq(planSessions.id, scheduledSessions.planSessionId))
            .where(eq(scheduledSessions.id, execution.scheduledSessionId))
        : [];
      const [checkIn] = execution
        ? await tx
            .select()
            .from(dailyCheckIns)
            .where(
              and(
                eq(dailyCheckIns.userId, userId),
                eq(dailyCheckIns.onDate, execution.performedOn),
              ),
            )
        : [];
      return {
        execution,
        previous,
        upcoming,
        title: executed?.title ?? null,
        checkIn: checkIn ?? null,
      };
    });
    const { execution, previous, upcoming, title, checkIn } = context;
    if (!execution || execution.painReports.length === 0)
      return { status: 'SKIPPED', reason: 'NO_PAIN' };

    const history = new Map<string, Set<string>>();
    for (const row of previous) {
      for (const report of row.painReports) {
        history.set(report.region, (history.get(report.region) ?? new Set()).add(row.performedOn));
      }
    }
    const signals = await this.activeSignalKinds(stateRead.slices);

    let assessment: PainAssessment;
    try {
      assessment = (
        await this.runner.run(
          painAssessmentTask,
          {
            reports: execution.painReports,
            session: {
              modality: execution.modality,
              title,
              rpe: execution.rpe,
              status: execution.status,
            },
            history: [...history].map(([region, days]) => ({ region, days: days.size })),
            activeSignals: signals,
            upcoming: upcoming.map((s) => ({
              date: s.date,
              title: s.title,
              exercises:
                s.content.modality === 'STRENGTH' ? s.content.exercises.map((e) => e.name) : [],
            })),
            checkIn: checkIn
              ? {
                  energy: checkIn.energy ?? null,
                  sleep: checkIn.sleep ?? null,
                  soreness: checkIn.soreness ?? null,
                }
              : null,
          },
          { userId, sources },
        )
      ).output;
    } catch (error) {
      if (!(error instanceof AgentTaskError)) throw error;
      this.logger.warn(
        { userId, executionId, taskId: error.taskId },
        'dor sem leitura válida do especialista',
      );
      return { status: 'SKIPPED', reason: 'NO_VALID_ASSESSMENT' };
    }

    const adaptations =
      assessment.level === 'MONITOR'
        ? []
        : await this.adapt(userId, view, assessment.avoidRegions, upcoming, today);
    const volumeApplied = await this.reduceVolume(userId, execution.modality, assessment, today);

    const referred = assessment.referral !== null;
    const { firstName } = await this.store.loadUser(userId);
    const messages = await this.talk(
      userId,
      { biologicalSex: identity?.biologicalSex ?? null, firstName },
      assessment,
      execution.painReports,
      adaptations,
      volumeApplied,
      sources,
    );
    if (messages) await this.messenger.send(userId, messages, `pain_${executionId}`);

    if (assessment.referral) {
      const { specialty, urgency, reason } = assessment.referral;
      await this.db.runAsSystem((tx) =>
        this.pipeline.openCase(tx, {
          userId,
          kind: 'NO_APPLICABLE_POLICY',
          domain: specialty === 'DOCTOR' || specialty === 'SPORTS_DOCTOR' ? 'MEDICAL' : 'TRAINING',
          summary: `O agente de recuperação orientou o aluno a procurar ${SPECIALTY_LABEL[specialty]} (${URGENCY_LABEL[urgency]}) após relato de dor: ${reason}`,
          subject: { source: 'PAIN_GUIDANCE', executionId },
          priority: urgency === 'URGENT' ? 'URGENT' : urgency === 'SOON' ? 'HIGH' : 'NORMAL',
        }),
      );
      await this.outbox.flushSoon();
    }
    this.logger.info(
      {
        event: 'pain_guidance',
        userId,
        executionId,
        level: assessment.level,
        adaptations: adaptations.length,
        referred,
      },
      'dor interpretada e aluno orientado',
    );
    return { status: 'SENT', level: assessment.level, adaptations: adaptations.length, referred };
  }

  /** Poupa a região nos próximos treinos: troca o exercício contraindicado por um equivalente seguro. */
  private async adapt(
    userId: string,
    view: ReturnType<typeof parseStateView>,
    regions: readonly BodyRegion[],
    upcoming: ReadonlyArray<{
      date: string;
      key: string;
      title: string;
      content: { modality: string; exercises?: Array<{ exerciseId: string; name: string }> };
    }>,
    today: string,
  ): Promise<Adaptation[]> {
    if (regions.length === 0) return [];
    const profile = catalogProfileOf(view);
    const injuryTags = [...contraindicationsOf(view), ...regions] as ContraindicationTag[];
    const done: Adaptation[] = [];
    for (const session of upcoming) {
      if (session.content.modality !== 'STRENGTH') continue;
      for (const exercise of session.content.exercises ?? []) {
        if (done.length >= MAX_SWAPS) return done;
        const target = this.catalog.getById(exercise.exerciseId);
        if (!target || !regions.some((r) => target.contraindicatedFor.includes(r))) continue;
        const best = rankEquivalents(
          target,
          { level: profile.level, location: profile.location, equipment: [], injuryTags },
          this.catalog.getAll(),
          {
            disliked: exercisePreference(view, 'DISLIKES'),
            liked: exercisePreference(view, 'LIKES'),
          },
        )[0];
        if (!best) continue;
        const action = {
          type: 'SUBSTITUTE_EXERCISE' as const,
          planSessionKey: session.key,
          fromExerciseId: target.id,
          toExerciseId: best.id,
          reason: 'DISCOMFORT' as const,
          scope: 'NEXT_SESSION' as const,
        };
        const outcome = await this.executor.decideAndRun(
          userId,
          painAssessmentTask.id,
          proposalOf(
            action,
            `Dor relatada na região do exercício ${target.name}: poupar até o desconforto passar.`,
            'O aluno segue treinando sem sobrecarregar a região com dor.',
          ),
          (tx, decisionId) =>
            this.commands.substituteExercise(tx, userId, action, decisionId, today),
        );
        if (outcome.verdict === 'EXECUTE' && outcome.execution?.result.applied === true) {
          done.push({
            sessionTitle: session.title,
            date: session.date,
            from: target.name,
            to: best.name,
          });
        }
      }
    }
    return done;
  }

  /** Alivia o volume da semana (até o limite que a política deixa o sistema fazer sozinho). */
  private async reduceVolume(
    userId: string,
    modality: string,
    assessment: PainAssessment,
    today: string,
  ): Promise<number> {
    if (assessment.volumeReductionPercent <= 0) return 0;
    if (!['STRENGTH', 'RUNNING', 'HYROX'].includes(modality)) return 0;
    const limit = (await this.policies.autonomy())?.byAction.ADJUST_WEEKLY_VOLUME?.limit ?? 15;
    const percent = Math.min(assessment.volumeReductionPercent, Math.max(5, limit));
    const action = {
      type: 'ADJUST_WEEKLY_VOLUME' as const,
      modality: modality as CoachedModality,
      percentChange: -percent,
      weeks: 1,
    };
    const outcome = await this.executor.decideAndRun(
      userId,
      painAssessmentTask.id,
      proposalOf(
        action,
        'Dor relatada: aliviar o volume da semana.',
        'A semana respeita o corpo do aluno.',
      ),
      (tx, decisionId) => this.commands.adjustWeeklyVolume(tx, userId, action, decisionId, today),
    );
    return outcome.verdict === 'EXECUTE' ? percent : 0;
  }

  /** A persona conversa com o aluno; sem texto válido, a orientação não sai (nunca texto cru). */
  private async talk(
    userId: string,
    identity: { biologicalSex?: string | null; firstName?: string | null } | undefined,
    assessment: PainAssessment,
    reports: PainReport[],
    adaptations: Adaptation[],
    volumeApplied: number,
    sources: AgentContextSources,
  ): Promise<string[] | null> {
    try {
      const run = await this.runner.run(
        painGuidanceTask,
        {
          firstName: identity?.firstName ?? null,
          assessment,
          reports,
          adaptations,
          volumeReductionApplied: volumeApplied,
        },
        { userId, sources, persona: personaOf(identity?.biologicalSex) },
      );
      return run.output.messages;
    } catch (error) {
      if (!(error instanceof AgentTaskError)) throw error;
      this.logger.warn({ userId, taskId: error.taskId }, 'orientação de dor sem texto válido');
      return null;
    }
  }

  private async activeSignalKinds(slices: Record<string, unknown>): Promise<string[]> {
    const safety = slices.safety as { activeSignals?: Array<{ kind: string }> } | undefined;
    return (safety?.activeSignals ?? []).map((s) => s.kind);
  }

  private sources(userId: string, now: Date): AgentContextSources {
    return {
      methodology: (domains) => this.methodology.render(domains),
      state: (slices) => this.state.read(userId, slices, now),
    };
  }
}

const SPECIALTY_LABEL = {
  ORTHOPEDIST: 'um ortopedista',
  PHYSIOTHERAPIST: 'um fisioterapeuta',
  SPORTS_DOCTOR: 'um médico do esporte',
  DOCTOR: 'um médico',
} as const;
const URGENCY_LABEL = {
  ROUTINE: 'sem pressa',
  SOON: 'nos próximos dias',
  URGENT: 'com urgência',
} as const;
