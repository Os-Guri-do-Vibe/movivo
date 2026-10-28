/**
 * Check-in adaptativo: monta as perguntas a partir de sinais reais, envia o link e grava as
 * respostas. Resposta de peso vira medida corporal; relato de dor vira sinal de segurança
 * (atenção) na mesma transação. O que muda no plano por causa das respostas é decisão do
 * orquestrador (evento `CheckInSubmitted`).
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';

import type { CheckInAnswers, CheckInQuestion } from '@movivo/shared';

import {
  bodyMeasurements,
  checkIns,
  foodLogs,
  nutritionPlans,
  scheduledSessions,
  sessionExecutions,
  users,
} from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { PublishedPolicies } from '../coaching/policy/published-policies';
import { signalOf } from '../coaching/safety/sentinel-rules';
import { SafetyService } from '../coaching/safety/safety.service';
import { DomainEventRecorder } from '../domain-events/domain-event-recorder';
import { OutboxRelay } from '../domain-events/outbox-relay';
import { PublishedMethodologyReader } from '../methodology/published-methodology.reader';
import { addDays } from '../planning/calc/week-planner';
import { todayIn } from '../planning/plan-generation.service';
import { AnswerError, composeQuestions, validateAnswers, type CheckInSignals } from './questions';

const EXPIRES_IN_DAYS = 5;
const DEFAULT_LOW_ADHERENCE = 0.6;

export interface CurrentCheckIn {
  id: string;
  kind: string;
  questions: CheckInQuestion[];
  expiresAt: Date;
}

@Injectable()
export class CheckInService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly events: DomainEventRecorder,
    private readonly outbox: OutboxRelay,
    private readonly safety: SafetyService,
    private readonly policies: PublishedPolicies,
    private readonly methodology: PublishedMethodologyReader,
  ) {}

  /** Cria o check-in da semana (idempotente: já existe um aberto → devolve o mesmo). */
  async open(userId: string, now: Date = new Date()): Promise<CurrentCheckIn> {
    const existing = await this.current(userId, now);
    if (existing) return existing;
    const signals = await this.signalsOf(userId, now);
    const questions = composeQuestions(signals);
    const [row] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .insert(checkIns)
        .values({
          userId,
          kind: 'WEEKLY',
          questions,
          expiresAt: new Date(now.getTime() + EXPIRES_IN_DAYS * 86_400_000),
        })
        .returning(),
    );
    if (!row) throw new Error('falha ao abrir o check-in');
    return { id: row.id, kind: row.kind, questions, expiresAt: row.expiresAt };
  }

  /** O check-in aberto (não respondido e não vencido) do aluno, se houver. */
  async current(userId: string, now: Date = new Date()): Promise<CurrentCheckIn | null> {
    const [row] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select()
        .from(checkIns)
        .where(
          and(
            eq(checkIns.userId, userId),
            eq(checkIns.status, 'SENT'),
            gte(checkIns.expiresAt, now),
          ),
        )
        .orderBy(desc(checkIns.createdAt))
        .limit(1),
    );
    return row
      ? { id: row.id, kind: row.kind, questions: row.questions, expiresAt: row.expiresAt }
      : null;
  }

  async answer(userId: string, checkInId: string, answers: CheckInAnswers, now: Date = new Date()) {
    const params = await this.policies.sentinel();
    await this.db.runAsUser(userId, 'USER', async (tx) => {
      const [row] = await tx
        .select()
        .from(checkIns)
        .where(and(eq(checkIns.id, checkInId), eq(checkIns.userId, userId)));
      if (!row) throw new NotFoundException();
      if (row.status !== 'SENT' || row.expiresAt < now) {
        throw new BadRequestException('Este check-in já foi respondido ou expirou.');
      }
      try {
        validateAnswers(row.questions, answers);
      } catch (error) {
        if (error instanceof AnswerError) throw new BadRequestException(error.message);
        throw error;
      }
      await tx
        .update(checkIns)
        .set({ status: 'ANSWERED', answers, answeredAt: now })
        .where(eq(checkIns.id, row.id));

      const [user] = await tx
        .select({ timezone: users.timezone })
        .from(users)
        .where(eq(users.id, userId));
      const today = todayIn(user?.timezone ?? null, now);
      if (typeof answers.weight_kg === 'number') {
        await tx.insert(bodyMeasurements).values({
          userId,
          kind: 'WEIGHT',
          value: answers.weight_kg,
          method: 'SCALE',
          measuredOn: today,
        });
      }
      if (answers.pain === true) {
        await this.safety.raiseIn(
          tx,
          userId,
          [signalOf('PERSISTENT_PAIN', 'no check-in o aluno relatou dor ou desconforto', params)],
          'RULE',
        );
      }
      await this.events.record(tx, {
        userId,
        type: 'CheckInSubmitted',
        payload: { checkInId: row.id, kind: row.kind, pain: answers.pain === true },
      });
    });
    await this.outbox.flushSoon();
  }

  // --- Sinais ----------------------------------------------------------------------------

  async signalsOf(userId: string, now: Date): Promise<CheckInSignals> {
    const adherenceDoc = await this.methodology.publishedOf('ADHERENCE');
    const lowAdherenceRate = Number(
      (adherenceDoc?.parameters.intervention as Record<string, unknown> | undefined)
        ?.lowAdherenceRate ?? DEFAULT_LOW_ADHERENCE,
    );
    return this.db.runAsUser(userId, 'USER', async (tx) => {
      const [user] = await tx
        .select({ timezone: users.timezone })
        .from(users)
        .where(eq(users.id, userId));
      const today = todayIn(user?.timezone ?? null, now);
      const since28 = addDays(today, -28);
      const since7 = addDays(today, -7);

      const scheduled = await tx
        .select({ status: scheduledSessions.status })
        .from(scheduledSessions)
        .where(
          and(
            eq(scheduledSessions.userId, userId),
            gte(scheduledSessions.scheduledOn, since28),
            inArray(scheduledSessions.status, ['DONE', 'PARTIAL', 'MISSED']),
          ),
        );
      const done = scheduled.filter((s) => s.status !== 'MISSED').length;
      const executions = await tx
        .select({
          modality: sessionExecutions.modality,
          rpe: sessionExecutions.rpe,
          performedOn: sessionExecutions.performedOn,
          status: sessionExecutions.status,
        })
        .from(sessionExecutions)
        .where(
          and(eq(sessionExecutions.userId, userId), gte(sessionExecutions.performedOn, since28)),
        );
      const rpes = executions
        .filter((e) => e.rpe !== null && e.performedOn >= since7)
        .map((e) => e.rpe as number);
      const logs = await tx
        .select({ loggedOn: foodLogs.loggedOn })
        .from(foodLogs)
        .where(
          and(
            eq(foodLogs.userId, userId),
            eq(foodLogs.confirmed, true),
            gte(foodLogs.loggedOn, since7),
          ),
        );
      const [plan] = await tx
        .select({ id: nutritionPlans.id })
        .from(nutritionPlans)
        .where(and(eq(nutritionPlans.userId, userId), eq(nutritionPlans.status, 'ACTIVE')));
      const [weight] = await tx
        .select({ measuredOn: bodyMeasurements.measuredOn })
        .from(bodyMeasurements)
        .where(and(eq(bodyMeasurements.userId, userId), eq(bodyMeasurements.kind, 'WEIGHT')))
        .orderBy(desc(bodyMeasurements.measuredOn))
        .limit(1);

      return {
        adherenceRate: scheduled.length > 0 ? done / scheduled.length : null,
        lowAdherenceRate,
        strengthSessionsLastWeek: executions.filter(
          (e) => e.modality === 'STRENGTH' && e.performedOn >= since7 && e.status !== 'ABANDONED',
        ).length,
        // Sem a PSE prevista por sessão aqui, compara com a PSE-alvo típica (6) da metodologia.
        rpeAbovePlanned:
          rpes.length >= 2 ? rpes.reduce((a, b) => a + b, 0) / rpes.length - 6 : null,
        foodLogDaysLast7: new Set(logs.map((l) => l.loggedOn)).size,
        hasNutritionPlan: Boolean(plan),
        daysSinceWeight: weight
          ? Math.round(
              (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${weight.measuredOn}T00:00:00Z`)) /
                86_400_000,
            )
          : null,
      };
    });
  }
}
