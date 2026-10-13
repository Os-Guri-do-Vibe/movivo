/**
 * Quando o link do dia (04:00) leva também a pergunta sobre o treino que ficou sem registro.
 *
 * Decisão de produto (fundador + Sofia, 2026-10-13): a pergunta NÃO é uma mensagem própria.
 * Ela viaja dentro do link, porque no canal não oficial cada mensagem proativa extra é uma
 * chance de denúncia e bloqueio do número, e porque de manhã o dia anterior já fechou (sem
 * "ainda dá tempo", sem o "hoje" dito depois da meia-noite).
 *
 * `decideAsk` é pura e testável por guarda; `MissedWorkoutAskPolicy.decide` só carrega os
 * fatos, na ordem do mais seletivo para o mais caro, e sai na primeira guarda que falha.
 */
import { Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, ne, or } from 'drizzle-orm';

import { CoachAttendanceService } from '../../core/database/coach-attendance.service';
import { conversations, handoffAlerts } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { FollowupService } from '../followup/followup.service';
import { localMidnightUtc, previousDay, shortWeekdayName } from './workout-eligibility';
import { type WorkoutDayStatus, WorkoutJournalService } from './workout-journal.service';

/** Teto de insistência: no máximo 2 perguntas entregues por semana. */
export const MAX_QUESTIONS_PER_WEEK = 2;

/** Alertas abertos de dor: enquanto existirem, a pergunta de ausência não sai. */
export const PAIN_ALERT_REASONS = ['DOR_APOS_TREINO', 'AUSENCIA_DOR', 'SUBSTITUTION_PAIN'] as const;

export interface AskFacts {
  /** `today` e `timezone` do aluno (a data local em que o link sai). */
  today: string;
  timezone: string;
  /** Última sessão prevista antes de hoje e quantas faltas seguidas terminam nela. */
  streak: { target: { date: string; status: WorkoutDayStatus } | null; streak: number };
  question: { hasOpen: boolean; deliveredLast7d: number; lastDeliveredAt: Date | null };
  paused: boolean;
  openPainAlert: boolean;
  /** O aluno escreveu desde o começo do dia do treino sem registro. */
  wroteSinceTargetDay: boolean;
}

export interface AskSubject {
  subjectDate: string;
  focus: string;
  sessionKey: string;
  workoutSessionId: string | null;
  protocolId: string;
  /** "ontem" ou o dia da semana curto, para a copy. */
  when: string;
}

export type AskDecision =
  | { kind: 'ASK'; subject: AskSubject }
  | {
      kind: 'NONE';
      reason:
        | 'NO_TARGET'
        | 'NOT_MISSED'
        | 'REPEATED_MISS'
        | 'QUESTION_OPEN'
        | 'WEEKLY_CAP'
        | 'ASKED_YESTERDAY'
        | 'PAUSED'
        | 'PAIN_ALERT'
        | 'ALREADY_WROTE';
    };

function localDateOf(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/**
 * Regras (todas precisam valer para perguntar):
 *  - a última sessão prevista ficou sem registro e é a PRIMEIRA falta da sequência (na 2ª
 *    seguida vai só o link: a pergunta repetida vira cobrança);
 *  - nenhuma pergunta aberta, nenhuma entregue ontem e menos de 2 na semana;
 *  - atendimento não pausado pelo profissional e nenhum alerta de dor aberto;
 *  - o aluno não escreveu desde o dia do treino (aproximação: quem já conversou pode ter
 *    explicado a ausência, e perguntar de menos é o lado seguro).
 */
export function decideAsk(facts: AskFacts): AskDecision {
  const { target, streak } = facts.streak;
  if (!target) return { kind: 'NONE', reason: 'NO_TARGET' };
  if (target.status.kind !== 'MISSED') return { kind: 'NONE', reason: 'NOT_MISSED' };
  if (streak > 1) return { kind: 'NONE', reason: 'REPEATED_MISS' };
  if (facts.question.hasOpen) return { kind: 'NONE', reason: 'QUESTION_OPEN' };
  if (facts.question.deliveredLast7d >= MAX_QUESTIONS_PER_WEEK) {
    return { kind: 'NONE', reason: 'WEEKLY_CAP' };
  }
  if (
    facts.question.lastDeliveredAt &&
    localDateOf(facts.question.lastDeliveredAt, facts.timezone) === previousDay(facts.today)
  ) {
    return { kind: 'NONE', reason: 'ASKED_YESTERDAY' };
  }
  if (facts.paused) return { kind: 'NONE', reason: 'PAUSED' };
  if (facts.openPainAlert) return { kind: 'NONE', reason: 'PAIN_ALERT' };
  if (facts.wroteSinceTargetDay) return { kind: 'NONE', reason: 'ALREADY_WROTE' };
  return {
    kind: 'ASK',
    subject: {
      subjectDate: target.date,
      focus: target.status.focus,
      sessionKey: target.status.sessionKey,
      workoutSessionId: target.status.workoutSessionId,
      protocolId: target.status.protocolId,
      when: target.date === previousDay(facts.today) ? 'ontem' : shortWeekdayName(target.date),
    },
  };
}

@Injectable()
export class MissedWorkoutAskPolicy {
  constructor(
    private readonly db: TenantDatabase,
    private readonly journal: WorkoutJournalService,
    private readonly followups: FollowupService,
    private readonly attendance: CoachAttendanceService,
  ) {}

  async decide(userId: string, today: string, timezone: string, now: Date): Promise<AskDecision> {
    const streak = await this.journal.recentMissStreak(userId, today, now);
    const neutral: AskFacts = {
      today,
      timezone,
      streak,
      question: { hasOpen: false, deliveredLast7d: 0, lastDeliveredAt: null },
      paused: false,
      openPainAlert: false,
      wroteSinceTargetDay: false,
    };
    // Só a primeira falta da sequência chega às consultas seguintes.
    if (streak.target?.status.kind !== 'MISSED' || streak.streak !== 1) return decideAsk(neutral);

    const question = await this.followups.recentSummary(userId, 'MISSED_WORKOUT', now);
    const early = decideAsk({ ...neutral, question });
    if (early.kind === 'NONE') return early;

    const paused = await this.attendance.isPaused(userId);
    if (paused) return decideAsk({ ...neutral, question, paused });
    const openPainAlert = await this.hasOpenPainAlert(userId);
    if (openPainAlert) return decideAsk({ ...neutral, question, openPainAlert });
    const wroteSinceTargetDay = await this.wroteSince(
      userId,
      localMidnightUtc(early.subject.subjectDate, timezone),
    );
    return decideAsk({ ...neutral, question, wroteSinceTargetDay });
  }

  private async hasOpenPainAlert(userId: string): Promise<boolean> {
    const rows = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({ id: handoffAlerts.id })
        .from(handoffAlerts)
        .where(
          and(
            eq(handoffAlerts.userId, userId),
            eq(handoffAlerts.status, 'OPEN'),
            or(
              eq(handoffAlerts.level, 'SAFETY'),
              inArray(handoffAlerts.reason, [...PAIN_ALERT_REASONS]),
            ),
          ),
        )
        .limit(1),
    );
    return rows.length > 0;
  }

  private async wroteSince(userId: string, since: Date): Promise<boolean> {
    const rows = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(
            eq(conversations.userId, userId),
            eq(conversations.direction, 'INBOUND'),
            ne(conversations.messageType, 'SYSTEM'),
            gte(conversations.createdAt, since),
          ),
        )
        .limit(1),
    );
    return rows.length > 0;
  }
}
