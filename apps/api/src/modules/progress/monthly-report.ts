/**
 * Relatório mensal do aluno: consistência no mês (contra o próprio mês anterior), check-ins,
 * peso, uma estimativa de ritmo de prova para quem corre e o foco sugerido para o mês que vem.
 * Tudo calculado pelo código a partir do que já está no banco; nada de modelo e nada armazenado.
 */
import { and, desc, eq, gte, lte } from 'drizzle-orm';

import type { FollowUpAnalysis, WeekMetrics } from '@movivo/shared';

import {
  executionMetrics,
  sessionExecutions,
  users,
  weeklyReviews,
} from '../../core/database/schema';
import type { TenantTransaction } from '../../core/database/tenant-database.service';
import { addDays, mondayOf } from '../planning/calc/week-planner';
import { bullets, COLOR, heading, paragraph, render } from '../planning/plan-pdf';
import { collectWeeks } from './review-data';

const MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];
/** Riegel (1981): T2 = T1 × (D2/D1)^1,06. Só extrapola até 4× a distância do treino-base. */
const RIEGEL_EXPONENT = 1.06;
const MAX_EXTRAPOLATION = 4;
const MIN_RUN_METERS = 3_000;
const RACES = [
  { label: '5 km', meters: 5_000 },
  { label: '10 km', meters: 10_000 },
  { label: '21,1 km', meters: 21_097 },
  { label: '42,2 km', meters: 42_195 },
];

export interface RaceEstimate {
  basedOn: { date: string; meters: number; seconds: number };
  races: { label: string; seconds: number }[];
}

export interface MonthlyReport {
  month: string;
  label: string;
  firstName: string | null;
  sessions: { planned: number; done: number; keyPlanned: number; keyDone: number };
  previousRate: number | null;
  checkIns: { answered: number; avgEnergy: number | null; avgSleep: number | null };
  weight: { first: number; last: number } | null;
  race: RaceEstimate | null;
  focus: string[];
}

export function monthLabel(month: string): string {
  const [year, index] = month.split('-').map(Number);
  return `${MONTHS[(index ?? 1) - 1] ?? ''} de ${year}`;
}

/** Mês anterior ao dia informado (`YYYY-MM`). */
export function previousMonth(today: string): string {
  const [year, month] = today.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 2000, (month ?? 1) - 2, 1));
  return date.toISOString().slice(0, 7);
}

/** Segundas-feiras do mês (as semanas do mês são as que começam nele). */
function mondaysOf(month: string): string[] {
  const first = mondayOf(`${month}-01`);
  const start = first.startsWith(month) ? first : addDays(first, 7);
  const out: string[] = [];
  for (let day = start; day.startsWith(month); day = addDays(day, 7)) out.push(day);
  return out;
}

const rate = (done: number, planned: number) => (planned > 0 ? done / planned : null);
const average = (values: number[]) =>
  values.length > 0
    ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
    : null;

/** Melhor corrida do período, pela marca equivalente nos 5 km; estima as provas ao alcance. */
export function raceEstimate(
  runs: readonly { date: string; meters: number; seconds: number }[],
): RaceEstimate | null {
  const eligible = runs.filter((r) => r.meters >= MIN_RUN_METERS && r.seconds > 0);
  const equivalent = (r: (typeof eligible)[number]) =>
    r.seconds * (5_000 / r.meters) ** RIEGEL_EXPONENT;
  const best = [...eligible].sort((a, b) => equivalent(a) - equivalent(b))[0];
  if (!best) return null;
  const races = RACES.filter((race) => race.meters / best.meters <= MAX_EXTRAPOLATION).map(
    (race) => ({
      label: race.label,
      seconds: Math.round(best.seconds * (race.meters / best.meters) ** RIEGEL_EXPONENT),
    }),
  );
  return races.length > 0 ? { basedOn: best, races } : null;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}h${mm}min${ss}s` : `${m}min${ss}s`;
}

export function summarize(
  month: string,
  firstName: string | null,
  weeks: readonly WeekMetrics[],
  previous: readonly WeekMetrics[],
  runs: readonly { date: string; meters: number; seconds: number }[],
  analyses: readonly (FollowUpAnalysis | null | undefined)[],
): MonthlyReport {
  const sum = (list: readonly WeekMetrics[], key: 'planned' | 'done' | 'keyPlanned' | 'keyDone') =>
    list.reduce((total, week) => total + week[key], 0);
  const checkIns = weeks.flatMap((w) => (w.checkIn ? [w.checkIn] : []));
  const weights = weeks.flatMap((w) => (w.weightKg === null ? [] : [w.weightKg]));
  const firstWeight = weights[0];
  const lastWeight = weights.at(-1);
  return {
    month,
    label: monthLabel(month),
    firstName,
    sessions: {
      planned: sum(weeks, 'planned'),
      done: sum(weeks, 'done'),
      keyPlanned: sum(weeks, 'keyPlanned'),
      keyDone: sum(weeks, 'keyDone'),
    },
    previousRate: rate(sum(previous, 'done'), sum(previous, 'planned')),
    checkIns: {
      answered: checkIns.length,
      avgEnergy: average(checkIns.flatMap((c) => (c.energy === null ? [] : [c.energy]))),
      avgSleep: average(checkIns.flatMap((c) => (c.sleep === null ? [] : [c.sleep]))),
    },
    weight:
      firstWeight !== undefined && lastWeight !== undefined && weights.length >= 2
        ? { first: firstWeight, last: lastWeight }
        : null,
    race: raceEstimate(runs),
    focus: [...new Set(analyses.flatMap((a) => (a ? [a.focus] : [])))].slice(0, 2),
  };
}

export async function loadMonthlyReport(
  tx: TenantTransaction,
  userId: string,
  month: string,
): Promise<MonthlyReport | null> {
  const mondays = mondaysOf(month);
  const last = mondays.at(-1);
  if (!last) return null;
  const weeks = await collectWeeks(tx, userId, last, mondays.length);
  const previousMondays = mondaysOf(previousMonth(`${month}-15`));
  const previousLast = previousMondays.at(-1);
  const previous = previousLast
    ? await collectWeeks(tx, userId, previousLast, previousMondays.length)
    : [];
  const from = mondays[0] ?? last;
  const to = addDays(last, 6);
  const runRows = await tx
    .select({ date: sessionExecutions.performedOn, metrics: executionMetrics.metrics })
    .from(executionMetrics)
    .innerJoin(sessionExecutions, eq(sessionExecutions.id, executionMetrics.executionId))
    .where(
      and(
        eq(executionMetrics.userId, userId),
        eq(executionMetrics.confirmed, true),
        eq(sessionExecutions.modality, 'RUNNING'),
        gte(sessionExecutions.performedOn, from),
        lte(sessionExecutions.performedOn, to),
      ),
    );
  const runs = runRows.flatMap((row) => {
    const meters = row.metrics.distanceMeters;
    const seconds = row.metrics.movingSeconds ?? row.metrics.elapsedSeconds;
    return meters && seconds ? [{ date: row.date, meters, seconds }] : [];
  });
  const reviews = await tx
    .select({ record: weeklyReviews.record })
    .from(weeklyReviews)
    .where(
      and(
        eq(weeklyReviews.userId, userId),
        gte(weeklyReviews.weekStart, from),
        lte(weeklyReviews.weekStart, last),
      ),
    )
    .orderBy(desc(weeklyReviews.weekStart));
  const [user] = await tx.select({ name: users.name }).from(users).where(eq(users.id, userId));
  return summarize(
    month,
    user?.name?.trim().split(/\s+/)[0] ?? null,
    weeks,
    previous,
    runs,
    reviews.flatMap((r) => [r.record.analyses?.habits, r.record.analyses?.recovery]),
  );
}

const percent = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`);

/** Resumo para o WhatsApp: celebra o que foi feito, compara só com o próprio mês anterior. */
export function reportMessage(report: MonthlyReport): string {
  const { sessions } = report;
  const current = rate(sessions.done, sessions.planned);
  const lines = [
    `${report.firstName ? `${report.firstName}, seu` : 'Seu'} relatório de ${report.label} está pronto.`,
    sessions.planned > 0
      ? `Você concluiu ${sessions.done} de ${sessions.planned} sessões (${percent(current)})${
          report.previousRate !== null
            ? `; no mês anterior foram ${percent(report.previousRate)}`
            : ''
        }. Cada sessão feita conta.`
      : 'Este mês ainda não teve sessões agendadas: o relatório mostra o ponto de partida.',
  ];
  if (report.focus[0]) lines.push(`Para o próximo mês, o foco sugerido é: ${report.focus[0]}`);
  return `${lines.join('\n---\n')}\n---\nO PDF com os detalhes vai logo abaixo. Qualquer dúvida, é só responder por aqui.`;
}

export function monthlyReportPdf(report: MonthlyReport): Promise<Buffer> {
  return render(`Relatório de ${report.label}`, (doc) => {
    const { sessions } = report;
    paragraph(
      doc,
      `${report.firstName ? `${report.firstName}, este` : 'Este'} é o seu mês na MOVIVO. A comparação é sempre com você mesmo: somos melhores do que éramos ontem.`,
      COLOR.musgo,
      10,
    );
    heading(doc, 'Consistência');
    bullets(doc, [
      sessions.planned > 0
        ? `Sessões concluídas: ${sessions.done} de ${sessions.planned} (${percent(rate(sessions.done, sessions.planned))}).`
        : 'Nenhuma sessão agendada no mês.',
      ...(sessions.keyPlanned > 0
        ? [`Sessões-chave: ${sessions.keyDone} de ${sessions.keyPlanned}.`]
        : []),
      ...(report.previousRate !== null
        ? [`No mês anterior: ${percent(report.previousRate)} das sessões.`]
        : []),
    ]);
    heading(doc, 'Como você se sentiu');
    bullets(
      doc,
      report.checkIns.answered > 0
        ? [
            `Check-ins respondidos: ${report.checkIns.answered}.`,
            ...(report.checkIns.avgEnergy !== null
              ? [`Energia média: ${String(report.checkIns.avgEnergy).replace('.', ',')} de 5.`]
              : []),
            ...(report.checkIns.avgSleep !== null
              ? [`Sono médio: ${String(report.checkIns.avgSleep).replace('.', ',')} de 5.`]
              : []),
          ]
        : ['Nenhum check-in respondido no mês. Eles ajudam a ajustar a semana ao seu momento.'],
    );
    if (report.weight) {
      heading(doc, 'Peso');
      const delta = Math.round((report.weight.last - report.weight.first) * 10) / 10;
      paragraph(
        doc,
        `De ${String(report.weight.first).replace('.', ',')} kg para ${String(report.weight.last).replace('.', ',')} kg (${delta >= 0 ? '+' : ''}${String(delta).replace('.', ',')} kg). O peso varia de semana para semana; o que importa é a tendência ao longo dos meses.`,
      );
    }
    if (report.race) {
      heading(doc, 'Estimativa de ritmo de prova');
      const base = report.race.basedOn;
      paragraph(
        doc,
        `A partir do seu melhor treino do mês (${String(Math.round(base.meters / 100) / 10).replace('.', ',')} km em ${formatDuration(base.seconds)}), pela fórmula de Riegel. É uma referência de ritmo para conversar com o seu treinador, não uma meta nem uma promessa.`,
        COLOR.musgo,
        9.5,
      );
      bullets(
        doc,
        report.race.races.map((r) => `${r.label}: cerca de ${formatDuration(r.seconds)}`),
      );
    }
    heading(doc, 'Foco para o próximo mês');
    bullets(
      doc,
      report.focus.length > 0
        ? report.focus
        : ['Manter a rotina que está funcionando e responder aos check-ins da semana.'],
    );
  });
}
