/**
 * Retrato do aluno (camada 0 da memória longitudinal) — poucas dezenas de tokens, a cada
 * mensagem, para o Coach saber ONDE o aluno está na caminhada sem carregar o histórico todo:
 * tempo de MOVIVO, mesociclo e, nas últimas duas semanas, quais treinos previstos foram
 * registrados e quais ficaram sem registro.
 *
 * Achado 2026-10-13: o estado só trazia treinos CONCLUÍDOS. Um dia sem registro não existia
 * para o Coach, então ele não tinha como falar de "ontem que não foi feito" nem reconhecer a
 * constância de quem treina com regularidade. A conta é feita em código (nunca pelo modelo):
 * mesmo calendário que decide o treino do link diário (`sessionFor`).
 *
 * # Guardrail de linguagem
 * As chaves dizem "semRegistro", nunca "perdeu"/"faltou"/"falhou" (vocabulário da marca), e
 * o retrato não tem sequência nem placar: constância é reconhecida, não pontuada.
 */
import type { ProtocolStructure } from '@movivo/shared';

import { dayKey, sessionFor } from '../../workout/workout-schedule';

/** Janela de dias fechados (a partir de ontem) que o retrato resume. */
export const RETRATO_WINDOW_DAYS = 14;

export interface RetratoInput {
  now: Date;
  /** Início do PRIMEIRO protocolo do aluno (qualquer status). */
  firstProtocolStart: Date;
  mesocycleNumber: number;
  currentWeek: number;
  totalWeeks: number;
  /** Protocolo vigente, para saber em que dias da semana há treino previsto. */
  structure: ProtocolStructure;
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

/** Meio-dia em São Paulo (15:00 UTC) do dia civil: longe o bastante de qualquer virada. */
function atNoon(day: string): Date {
  return new Date(`${day}T15:00:00.000Z`);
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
  const today = dayKey(input.now);
  const deliveryDay = dayKey(input.firstProtocolStart);
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
    if (!sessionFor(atNoon(day), input.structure)) continue;
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
