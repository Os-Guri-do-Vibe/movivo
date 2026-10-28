/**
 * Extração de preferências: lê o que o aluno FEZ (gosto declarado em cada treino, trocas por
 * preferência, horários em que cumpre ou perde) e registra como hipótese. O que o aluno
 * declarou nunca é sobrescrito, e nada observado vira obrigatório.
 */
import { Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, isNotNull } from 'drizzle-orm';

import type { CoachingProposal } from '@movivo/shared';

import { AgentRunner } from '../../core/agents/agent-runner';
import {
  coachingProposals,
  planSessions,
  scheduledSessions,
  sessionExecutions,
} from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { DecisionExecutor } from '../coaching/decision/decision-executor.service';
import { DomainCommands } from '../conversation/domain-commands.service';
import { PublishedMethodologyReader } from '../methodology/published-methodology.reader';
import { addDays } from '../planning/calc/week-planner';
import { StudentStateReader } from '../student-state/student-state.reader';
import { preferencesTask, type PreferencesInput } from './tasks';

const WINDOW_DAYS = 42;
const MIN_EVIDENCE = 2;
const MIN_SLOT_SESSIONS = 3;

interface Evidence {
  id: string;
  kind: PreferencesInput['evidence'][number]['kind'];
  label: string;
  detail: string;
  /** Referências reais (ids do banco) guardadas junto da preferência. */
  refs: string[];
}

const SLOT_LABEL: Record<string, string> = {
  MORNING: 'manhã',
  AFTERNOON: 'tarde',
  EVENING: 'noite',
};

@Injectable()
export class PreferenceExtractionService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly runner: AgentRunner,
    private readonly state: StudentStateReader,
    private readonly methodology: PublishedMethodologyReader,
    private readonly executor: DecisionExecutor,
    private readonly commands: DomainCommands,
  ) {}

  /** Devolve quantas preferências foram registradas. Sem evidência suficiente, nem chama o modelo. */
  async extract(userId: string, today: string, now: Date = new Date()): Promise<number> {
    const evidence = await this.collect(userId, today);
    if (evidence.length < MIN_EVIDENCE) return 0;
    const run = await this.runner.run(
      preferencesTask,
      { evidence: evidence.map(({ id, kind, label, detail }) => ({ id, kind, label, detail })) },
      {
        userId,
        sources: {
          methodology: (domains) => this.methodology.render(domains),
          state: (slices) => this.state.read(userId, slices, now),
        },
      },
    );
    let recorded = 0;
    for (const item of run.output.preferences) {
      const refs = evidence.filter((e) => item.evidenceIds.includes(e.id)).flatMap((e) => e.refs);
      const preference = {
        domain: item.domain,
        key: item.key,
        value: item.value,
        strength: item.strength,
        origin: item.origin,
        confidence: item.confidence,
      };
      const proposal: CoachingProposal = {
        action: { type: 'RECORD_PREFERENCE', preference },
        rationale: [`Padrão observado em ${item.evidenceIds.length} registros do aluno.`],
        evidence: item.evidenceIds,
        assumptions: ['Preferência observada é hipótese até o aluno confirmar.'],
        // Registrar uma hipótese é seguro: a incerteza está na força (HYPOTHESIS), não na ação.
        uncertainty: 'MEDIUM',
        expectedOutcome: 'Planos futuros passam a considerar a preferência como hipótese.',
      };
      const outcome = await this.executor.decideAndRun(
        userId,
        preferencesTask.id,
        proposal,
        (tx) => this.commands.recordPreference(tx, userId, preference, refs),
        { modelRunId: run.modelRunIds[0] ?? null },
      );
      if (outcome.execution?.result.applied === true) recorded += 1;
    }
    return recorded;
  }

  private async collect(userId: string, today: string): Promise<Evidence[]> {
    const since = addDays(today, -WINDOW_DAYS);
    const { executions, scheduled, swaps } = await this.db.runAsUser(
      userId,
      'USER',
      async (tx) => ({
        executions: await tx
          .select({
            id: sessionExecutions.id,
            modality: sessionExecutions.modality,
            enjoyment: sessionExecutions.enjoyment,
            rpe: sessionExecutions.rpe,
            title: planSessions.title,
          })
          .from(sessionExecutions)
          .leftJoin(planSessions, eq(planSessions.id, sessionExecutions.planSessionId))
          .where(
            and(
              eq(sessionExecutions.userId, userId),
              gte(sessionExecutions.performedOn, since),
              isNotNull(sessionExecutions.enjoyment),
            ),
          ),
        scheduled: await tx
          .select({
            id: scheduledSessions.id,
            slot: scheduledSessions.slot,
            status: scheduledSessions.status,
          })
          .from(scheduledSessions)
          .where(
            and(
              eq(scheduledSessions.userId, userId),
              gte(scheduledSessions.scheduledOn, since),
              inArray(scheduledSessions.status, ['DONE', 'PARTIAL', 'MISSED']),
            ),
          ),
        swaps: await tx
          .select({ id: coachingProposals.id, action: coachingProposals.action })
          .from(coachingProposals)
          .where(
            and(
              eq(coachingProposals.userId, userId),
              eq(coachingProposals.actionType, 'SUBSTITUTE_EXERCISE'),
              eq(coachingProposals.status, 'ACCEPTED'),
              gte(coachingProposals.createdAt, new Date(`${since}T00:00:00Z`)),
            ),
          ),
      }),
    );

    const found: Omit<Evidence, 'id'>[] = [];
    // Gosto: só os extremos dizem alguma coisa.
    for (const row of executions) {
      if (row.enjoyment === null || (row.enjoyment > 2 && row.enjoyment < 4)) continue;
      found.push({
        kind: 'ENJOYMENT',
        label: row.title ?? row.modality,
        detail: `Gosto ${row.enjoyment}/5${row.rpe !== null ? `, esforço ${row.rpe}` : ''}.`,
        refs: [`execution:${row.id}`],
      });
    }
    for (const row of swaps) {
      const action = row.action;
      if (action.type !== 'SUBSTITUTE_EXERCISE') continue;
      if (action.reason !== 'PREFERENCE' && action.reason !== 'DIFFICULTY') continue;
      found.push({
        kind: 'SUBSTITUTION',
        label: `Troca ${action.fromExerciseId} por ${action.toExerciseId}`,
        detail: `Pediu a troca (${action.reason === 'PREFERENCE' ? 'preferência' : 'dificuldade'}); exercício: ${action.fromExerciseId}.`,
        refs: [`proposal:${row.id}`],
      });
    }
    // Horário: por turno, quanto cumpre e quanto perde (a partir de 3 sessões no turno).
    for (const slot of ['MORNING', 'AFTERNOON', 'EVENING']) {
      const inSlot = scheduled.filter((s) => s.slot === slot);
      if (inSlot.length < MIN_SLOT_SESSIONS) continue;
      const missed = inSlot.filter((s) => s.status === 'MISSED').length;
      found.push({
        kind: 'MISSED_SLOT',
        label: `Treinos de ${SLOT_LABEL[slot] ?? slot}`,
        detail: `Perdeu ${missed} de ${inSlot.length} sessões marcadas de ${SLOT_LABEL[slot] ?? slot} (slot:${slot}).`,
        refs: inSlot.map((s) => `scheduled:${s.id}`).slice(0, 10),
      });
    }
    return found.slice(0, 40).map((e, i) => ({ ...e, id: `e${i + 1}` }));
  }
}
