/**
 * Verificação determinística de um plano de treino integrado.
 *
 * É o portão final de QUALQUER plano (uma modalidade ou várias, escrito por agente ou montado
 * pelo código): o plano precisa caber na semana real do aluno. A checagem monta a semana de
 * início e a entrega ao planejador de agenda — se uma sessão-chave ou importante não couber sem
 * violar disponibilidade ou espaçamento, o plano não passa.
 */
import type {
  AvailabilityWindow,
  CoachedModality,
  PlanSession,
  TrainingPlanStructure,
  Weekday,
} from '@movivo/shared';

import type { Violation } from '../../../core/agents/agent-task';
import { intenseSessionsPerWeek, isHeavyLower, isIntense, weeklyLoad } from './load';
import type { HybridRules } from './params';
import { addDays, mondayOf, planWeek, type WeekOccurrence, type WindowOfDay } from './week-planner';

const WEEKDAYS: readonly Weekday[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

export interface PlanCheckContext {
  windows: readonly AvailabilityWindow[];
  maxSessionsPerWeek: number;
  /** Dias fixos do esporte externo, por chave de sessão. */
  externalFixedDays: Readonly<Record<string, readonly Weekday[]>>;
  focus: readonly CoachedModality[];
  rules: HybridRules;
  /** Dias leves mínimos entre duas sessões intensas (metodologia de corrida). */
  minEasyDaysBetweenIntense: number;
  /** Carga semanal média das últimas 4 semanas, se houver histórico. */
  recentWeeklyLoad: number | null;
  startsOn: string;
}

export function windowsByWeekday(
  windows: readonly AvailabilityWindow[],
): Partial<Record<Weekday, WindowOfDay[]>> {
  const out: Partial<Record<Weekday, WindowOfDay[]>> = {};
  for (const w of windows) {
    (out[w.weekday] ??= []).push({ slot: w.slot, maxMinutes: w.maxMinutes });
  }
  return out;
}

/** Ocorrências semanais das sessões do plano (esporte externo com dia fixo já ancorado). */
export function occurrencesOf(
  sessions: readonly PlanSession[],
  externalFixedDays: PlanCheckContext['externalFixedDays'],
  weekStart: string,
): WeekOccurrence[] {
  const out: WeekOccurrence[] = [];
  for (const session of sessions) {
    // Esporte externo: dias do perfil do aluno. Demais: dias que o profissional definiu na revisão.
    const fixedDays =
      externalFixedDays[session.key] ??
      (session.content.modality === 'EXTERNAL_SPORT' ? [] : session.weekdays) ??
      [];
    for (let i = 0; i < session.weeklyFrequency; i += 1) {
      const weekday = fixedDays[i];
      out.push({
        planSessionKey: session.key,
        occurrence: i + 1,
        priority: session.priority,
        minutes: session.estimatedMinutes,
        intense: isIntense(session),
        heavyLower: isHeavyLower(session),
        intenseRun: session.content.modality === 'RUNNING' && isIntense(session),
        strength: session.content.modality === 'STRENGTH',
        fixedOn: weekday ? addDays(weekStart, WEEKDAYS.indexOf(weekday)) : undefined,
      });
    }
  }
  return out;
}

export function checkTrainingPlan(
  plan: TrainingPlanStructure,
  context: PlanCheckContext,
): Violation[] {
  const violations: Violation[] = [];
  const coached = plan.sessions.filter((s) => s.content.modality !== 'EXTERNAL_SPORT');
  const coachedPerWeek = coached.reduce((sum, s) => sum + s.weeklyFrequency, 0);

  if (coachedPerWeek > context.maxSessionsPerWeek) {
    violations.push({
      path: 'sessions',
      message: `${coachedPerWeek} sessões por semana passam do que o aluno sustenta (${context.maxSessionsPerWeek})`,
    });
  }
  for (const modality of context.focus) {
    if (!plan.sessions.some((s) => s.content.modality === modality)) {
      violations.push({
        path: 'sessions',
        message: `a modalidade ${modality} está no foco da estratégia, mas não tem nenhuma sessão`,
      });
    }
  }
  const keys = plan.sessions.filter((s) => s.priority === 'KEY').length;
  if (keys === 0)
    violations.push({ path: 'sessions', message: 'o plano precisa de ao menos uma sessão-chave' });
  if (keys > 4) violations.push({ path: 'sessions', message: 'sessões-chave demais (máximo 4)' });

  const intense = intenseSessionsPerWeek(plan.sessions);
  if (
    context.rules.maxIntenseSessionsPerWeek !== null &&
    intense > context.rules.maxIntenseSessionsPerWeek
  ) {
    violations.push({
      path: 'sessions',
      message: `${intense} sessões intensas por semana (máximo ${context.rules.maxIntenseSessionsPerWeek}, contando o esporte externo)`,
    });
  }

  const load = weeklyLoad(plan.sessions);
  if (
    context.recentWeeklyLoad !== null &&
    context.recentWeeklyLoad > 0 &&
    context.rules.weeklyLoadIncreaseMaxPct !== null
  ) {
    const ceiling = context.recentWeeklyLoad * (1 + context.rules.weeklyLoadIncreaseMaxPct / 100);
    if (load > ceiling) {
      violations.push({
        path: 'sessions',
        message: `carga semanal prevista (${load}) passa de ${context.rules.weeklyLoadIncreaseMaxPct}% sobre a média recente (${Math.round(context.recentWeeklyLoad)})`,
      });
    }
  }

  violations.push(...pinnedDaysViolations(plan.sessions, context));

  // A semana precisa caber: nenhuma sessão do protocolo pode ficar sem dia toda semana. Se não
  // cabe, ela sai do plano (ou a frequência cai) — nunca fica prescrita sem acontecer.
  const weekStart = mondayOf(context.startsOn);
  const week = planWeek({
    weekStart,
    notBefore: weekStart,
    windows: windowsByWeekday(context.windows),
    occurrences: occurrencesOf(plan.sessions, context.externalFixedDays, weekStart),
    rules: context.rules,
    minEasyDaysBetweenIntense: context.minEasyDaysBetweenIntense,
  });
  const byKey = new Map(plan.sessions.map((s) => [s.key, s]));
  for (const dropped of week.dropped) {
    const priority = byKey.get(dropped.planSessionKey)?.priority;
    if (priority === 'KEY' || priority === 'IMPORTANT') {
      violations.push({
        path: 'sessions',
        message: `a sessão ${dropped.planSessionKey} (${priority}) não cabe na semana do aluno: ${dropped.reason}`,
      });
    } else if (priority === 'COMPLEMENTARY') {
      violations.push({
        path: 'sessions',
        message: `a sessão complementar ${dropped.planSessionKey} nunca entraria na agenda (${dropped.reason}): tire-a do plano ou reduza a frequência dela`,
      });
    }
  }
  return violations;
}

/**
 * Dias definidos pelo profissional (`weekdays`): o aluno precisa ter horário no dia, para o tempo
 * da sessão, e dois treinos só dividem o dia se a metodologia permite.
 */
function pinnedDaysViolations(
  sessions: readonly PlanSession[],
  context: PlanCheckContext,
): Violation[] {
  const violations: Violation[] = [];
  const windows = windowsByWeekday(context.windows);
  const perDay = new Map<Weekday, number>();
  for (const session of sessions) {
    if (session.content.modality === 'EXTERNAL_SPORT' || !session.weekdays) continue;
    for (const weekday of session.weekdays) {
      const fits = (windows[weekday] ?? []).some((w) => w.maxMinutes >= session.estimatedMinutes);
      if (!fits) {
        violations.push({
          path: 'sessions',
          message: `${session.title}: o aluno não tem horário livre de ${session.estimatedMinutes} min na ${WEEKDAY_NAME[weekday]}`,
        });
      }
      perDay.set(weekday, (perDay.get(weekday) ?? 0) + 1);
    }
  }
  const limit = context.rules.allowTwoSessionsSameDay ? 2 : 1;
  for (const [weekday, count] of perDay) {
    if (count > limit) {
      violations.push({
        path: 'sessions',
        message: `${count} treinos na ${WEEKDAY_NAME[weekday]}; a metodologia permite no máximo ${limit} por dia`,
      });
    }
  }
  return violations;
}

const WEEKDAY_NAME: Readonly<Record<Weekday, string>> = {
  MON: 'segunda-feira',
  TUE: 'terça-feira',
  WED: 'quarta-feira',
  THU: 'quinta-feira',
  FRI: 'sexta-feira',
  SAT: 'sábado',
  SUN: 'domingo',
};
