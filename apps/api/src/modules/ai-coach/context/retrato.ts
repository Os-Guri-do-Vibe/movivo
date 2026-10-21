/**
 * Retrato do aluno (camada 0 da memória longitudinal) — poucas dezenas de tokens, a cada
 * mensagem, para o Coach saber ONDE o aluno está na caminhada sem carregar o histórico todo:
 * tempo de MOVIVO, mesociclo e, nas últimas duas semanas, quais treinos previstos foram
 * registrados e quais ficaram sem registro.
 *
 * Achado 2026-10-13: o estado só trazia treinos CONCLUÍDOS. Um dia sem registro não existia
 * para o Coach, então ele não tinha como falar de "ontem que não foi feito" nem reconhecer a
 * constância de quem treina com regularidade. A conta é feita em código (nunca pelo modelo):
 * mesmo calendário que decide o treino do link diário (`effectiveSessionForDate`, que já inclui
 * os ajustes de agenda pedidos pelo aluno).
 *
 * # Guardrail de linguagem
 * As chaves dizem "semRegistro", nunca "perdeu"/"faltou"/"falhou" (vocabulário da marca), e
 * o retrato não tem sequência nem placar: constância é reconhecida, não pontuada.
 */
import type { ProtocolStructure } from '@movivo/shared';

import {
  effectiveSessionForDate,
  type ScheduleOverrides,
  weekDates,
} from '../../workout/schedule-planner';
import { dayKeyIn } from '../../workout/workout-schedule';

/** Janela de dias fechados (a partir de ontem) que o retrato resume. */
export const RETRATO_WINDOW_DAYS = 14;

export interface RetratoInput {
  now: Date;
  /** Fuso do aluno (`users.timezone`): "hoje" e a entrega do protocolo são contados nele. */
  timezone?: string | null;
  /** Início do PRIMEIRO protocolo do aluno (qualquer status). */
  firstProtocolStart: Date;
  mesocycleNumber: number;
  currentWeek: number;
  totalWeeks: number;
  /** Protocolo vigente, para saber em que dias da semana há treino previsto. */
  structure: ProtocolStructure;
  /** Ajustes de agenda pedidos pelo aluno: um dia remarcado não é "sem registro". */
  overrides?: ScheduleOverrides;
  /** Dias (`YYYY-MM-DD`) com treino concluído / iniciado e não finalizado. */
  completedDates: ReadonlySet<string>;
  inProgressDates: ReadonlySet<string>;
}

export interface Retrato {
  naMovivoHa: string;
  mesociclo: number;
  semanaDoMesociclo: string;
  ultimasDuasSemanas: {
    treinosPrevistos: number;
    treinosRegistrados: number;
    /** Ex.: "sábado 04/10". Vazio quando tudo o que estava previsto foi registrado. */
    semRegistro: string[];
  };
  /** Dia do último treino concluído nessa janela (`YYYY-MM-DD`), ou `null`. */
  ultimoTreinoRegistrado: string | null;
}

function tenure(days: number): string {
  if (days < 7) return 'menos de 1 semana';
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return `${weeks} ${weeks === 1 ? 'semana' : 'semanas'}`;
  }
  const months = Math.floor(days / 30.44);
  return `${months} ${months === 1 ? 'mês' : 'meses'}`;
}

function previousDays(today: string, count: number): string[] {
  const days: string[] = [];
  const base = Date.parse(`${today}T12:00:00.000Z`);
  for (let back = 1; back <= count; back += 1) {
    days.push(new Date(base - back * 86_400_000).toISOString().slice(0, 10));
  }
  return days;
}

function label(day: string): string {
  const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(`${day}T12:00:00.000Z`),
  );
  const [, month, dayOfMonth] = day.split('-');
  return `${weekday} ${dayOfMonth}/${month}`;
}

export function buildRetrato(input: RetratoInput): Retrato {
  const today = dayKeyIn(input.now, input.timezone);
  const deliveryDay = dayKeyIn(input.firstProtocolStart, input.timezone);
  const tenureDays = Math.floor(
    (input.now.getTime() - input.firstProtocolStart.getTime()) / 86_400_000,
  );

  let planned = 0;
  let registered = 0;
  const semRegistro: string[] = [];
  let lastCompleted: string | null = null;
  // Do mais recente ao mais antigo; as listas finais saem em ordem cronológica.
  for (const day of previousDays(today, RETRATO_WINDOW_DAYS)) {
    if (input.completedDates.has(day) && lastCompleted === null) lastCompleted = day;
    // Antes do protocolo e no dia da entrega não há o que cobrar; treino iniciado e não
    // finalizado provavelmente aconteceu, então não conta como previsto nem como sem registro.
    if (day <= deliveryDay || input.inProgressDates.has(day)) continue;
    if (!effectiveSessionForDate(day, input.structure, input.overrides)) continue;
    planned += 1;
    if (input.completedDates.has(day)) registered += 1;
    else semRegistro.unshift(label(day));
  }

  return {
    naMovivoHa: tenure(Math.max(0, tenureDays)),
    mesociclo: input.mesocycleNumber,
    semanaDoMesociclo: `${input.currentWeek} de ${input.totalWeeks}`,
    ultimasDuasSemanas: {
      treinosPrevistos: planned,
      treinosRegistrados: registered,
      semRegistro,
    },
    ultimoTreinoRegistrado: lastCompleted,
  };
}

export interface AgendaDia {
  /** Ex.: "terça 20/10". */
  dia: string;
  /** Rótulo da sessão e foco, ou "descanso". */
  treino: string;
  situacao: 'feito' | 'em andamento' | 'previsto' | 'sem registro' | 'descanso';
  /** O aluno pediu para mudar este dia (o padrão do protocolo era outro). */
  remarcado: boolean;
}

/**
 * A semana do aluno (segunda a domingo) como o Coach deve enxergá-la: o calendário efetivo, com
 * os dias que o aluno remarcou marcados. Sem isso o Coach responderia "amanhã é descanso" ou
 * "hoje é o B" com base no calendário padrão, contradizendo o ajuste que acabou de aceitar.
 */
export function buildAgendaDaSemana(input: {
  today: string;
  structure: ProtocolStructure;
  overrides?: ScheduleOverrides;
  completedDates: ReadonlySet<string>;
  inProgressDates: ReadonlySet<string>;
}): AgendaDia[] {
  return weekDates(input.today).map((date) => {
    const session = effectiveSessionForDate(date, input.structure, input.overrides);
    const done = input.completedDates.has(date);
    const situacao: AgendaDia['situacao'] = done
      ? 'feito'
      : input.inProgressDates.has(date)
        ? 'em andamento'
        : !session
          ? 'descanso'
          : date < input.today
            ? 'sem registro'
            : 'previsto';
    return {
      dia: label(date),
      treino: session ? `${session.dayLabel} (${session.focus})` : 'descanso',
      situacao,
      remarcado: input.overrides?.has(date) ?? false,
    };
  });
}
