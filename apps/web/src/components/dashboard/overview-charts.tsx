'use client';

/**
 * Gráficos da Visão Geral do Control Center.
 *
 * A série diária usa o Line Chart oficial do shadcn/ui (Recharts sob
 * `ChartContainer`); mapa de calor 7x24 e distribuição por status continuam em CSS
 * grid nativo, que resolve as duas formas sem custo de bundle. Regras de dataviz
 * aplicadas: uma série = uma cor (`chart-1`, verde da marca), rampa sequencial de
 * UMA matiz no mapa de calor, malha em hairline recessivo e valor exato sempre
 * alcançável fora da cor (título nativo + texto para leitor de tela).
 */
import type { ControlCenterHeatmapCell, ControlCenterTimeSeriesPoint } from '@movivo/shared';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { cn } from '@/lib/utils';

const number = new Intl.NumberFormat('pt-BR');

/** `YYYY-MM-DD` já vem no fuso da operação; formatar por corte evita reinterpretar em UTC. */
function shortDate(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

function ChartCard({
  title,
  description,
  headline,
  minWidth,
  children,
}: {
  title: string;
  description: string;
  headline?: string;
  minWidth: string;
  children: React.ReactNode;
}) {
  const id = `chart-${title.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <section aria-labelledby={id} className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={id} className="text-h3 font-semibold">
            {title}
          </h3>
          <p className="mt-1 max-w-lg text-label text-muted-foreground">{description}</p>
        </div>
        {headline ? <p className="font-mono text-h2 font-bold">{headline}</p> : null}
      </div>
      {/* Em tela estreita o desenho não encolhe: rola, e a área rolável é focável por teclado. */}
      <div
        className="mt-5 overflow-x-auto"
        role="region"
        aria-label={`${title}, área rolável`}
        tabIndex={0}
      >
        <div className={minWidth}>{children}</div>
      </div>
    </section>
  );
}

export function DailySeriesChart({
  title,
  description,
  points,
  unit,
}: {
  title: string;
  description: string;
  points: readonly ControlCenterTimeSeriesPoint[];
  /** Substantivo no plural usado no tooltip de cada dia: "novos alunos", "mensagens". */
  unit: string;
}) {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return null;
  const total = points.reduce((sum, point) => sum + point.value, 0);
  const config = {
    value: { label: unit, color: 'var(--color-chart-1)' },
  } satisfies ChartConfig;

  return (
    <ChartCard
      title={title}
      description={description}
      headline={`${number.format(total)} em 30 dias`}
      minWidth="min-w-[34rem]"
    >
      <ChartContainer config={config} className="aspect-auto h-[190px] w-full">
        <LineChart data={points as ControlCenterTimeSeriesPoint[]} accessibilityLayer>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={24}
            tickFormatter={shortDate}
          />
          <YAxis
            width={36}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            className="font-mono"
            tickFormatter={(value: number) => number.format(value)}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                className="font-mono"
                labelFormatter={(label) => shortDate(String(label))}
              />
            }
          />
          <Line
            dataKey="value"
            type="monotone"
            stroke="var(--color-value)"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ChartContainer>
      {/* Valor exato de cada dia sem depender do desenho: leitor de tela e tooltip. */}
      <ul className="mt-3 flex gap-px">
        {points.map((point) => (
          <li
            key={point.date}
            className="h-1.5 flex-1 rounded-full bg-secondary"
            title={`${shortDate(point.date)}: ${number.format(point.value)} ${unit}`}
          >
            <span className="sr-only">{`${shortDate(point.date)}: ${number.format(point.value)} ${unit}`}</span>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;

/**
 * Rampa sequencial de uma matiz só (verde da marca), clara→escura no tema claro e
 * escura→clara no escuro, para que "perto de zero" sempre recue em direção à
 * superfície do card. O degrau 0 é a superfície neutra: ausência, não intensidade.
 */
const HEAT_STEPS = [
  'bg-secondary',
  'bg-[#d8f7e6] dark:bg-[#0d5445]',
  'bg-[#9eeec4] dark:bg-[#0a7d52]',
  'bg-[#4fe89b] dark:bg-[#12b269]',
  'bg-[#12b269] dark:bg-[#25e27e]',
  'bg-[#0a7d52] dark:bg-[#7cf0b3]',
] as const;

export function ActivityHeatmap({
  cells,
  title = 'Mensagens do AI Coach por dia e hora',
  description = 'Quando a operação conversa. Concentração de mensagens enviadas nas últimas semanas, no fuso de São Paulo.',
  unitLabel = 'mensagens',
}: {
  cells: readonly ControlCenterHeatmapCell[];
  /** O mesmo componente serve ao heatmap de mensagens e ao de cadastros (US-7.3). */
  title?: string;
  description?: string;
  unitLabel?: string;
}) {
  if (!cells.length) return null;
  const max = Math.max(...cells.map((cell) => cell.value), 1);
  const byKey = new Map(cells.map((cell) => [`${cell.dayOfWeek}-${cell.hour}`, cell.value]));
  const step = (value: number) => (value === 0 ? 0 : Math.ceil((value / max) * 5));

  return (
    <ChartCard title={title} description={description} minWidth="min-w-[42rem]">
      <table className="w-full border-separate border-spacing-0.5 text-[11px]">
        <caption className="sr-only">
          {`Total de ${unitLabel} por dia da semana e hora do dia. Cada célula informa o total exato.`}
        </caption>
        <thead>
          <tr>
            <th scope="col" className="w-10">
              <span className="sr-only">Dia da semana</span>
            </th>
            {Array.from({ length: 24 }, (_, hour) => (
              <th
                key={hour}
                scope="col"
                className="pb-1 font-mono font-normal text-muted-foreground"
              >
                {hour % 3 === 0 ? (
                  String(hour).padStart(2, '0')
                ) : (
                  <span className="sr-only">{`${hour}h`}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {WEEKDAYS.map((weekday, dayOfWeek) => (
            <tr key={weekday}>
              <th scope="row" className="pr-2 text-right font-normal text-muted-foreground">
                {weekday}
              </th>
              {Array.from({ length: 24 }, (_, hour) => {
                const value = byKey.get(`${dayOfWeek}-${hour}`) ?? 0;
                const label = `${weekday}, ${String(hour).padStart(2, '0')}h: ${number.format(value)} ${unitLabel}`;
                return (
                  <td
                    key={hour}
                    title={label}
                    className={cn('h-6 rounded-sm', HEAT_STEPS[step(value)])}
                  >
                    <span className="sr-only">{label}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <span>0</span>
        {HEAT_STEPS.map((className, index) => (
          <span
            key={className}
            aria-hidden="true"
            className={cn('size-4 rounded-sm border border-border', className)}
            title={
              index === 0
                ? `Nenhum registro de ${unitLabel}`
                : `Até ${number.format(Math.ceil((index * max) / 5))} ${unitLabel}`
            }
          />
        ))}
        <span>
          {number.format(max)} {unitLabel} por hora
        </span>
      </p>
    </ChartCard>
  );
}

const APPROVAL_LABELS: Record<string, string> = {
  AUTO_APPROVED: 'Liberado automaticamente',
  PENDING_REVIEW: 'Aguardando revisão do CREF',
  HUMAN_APPROVED: 'Assinado por profissional',
  BLOCKED_PENDING_CLEARANCE: 'Bloqueado até liberação',
};

export function ProtocolStatusBreakdown({
  slices,
}: {
  slices: readonly { status: string; count: number }[];
}) {
  if (!slices.length) return null;
  const max = Math.max(...slices.map((slice) => slice.count), 1);
  const total = slices.reduce((sum, slice) => sum + slice.count, 0);

  return (
    <ChartCard
      title="Protocolos por estado de liberação"
      description="Como os protocolos gerados se distribuem entre liberação automática e revisão humana."
      headline={`${number.format(total)} protocolos`}
      minWidth="min-w-[20rem]"
    >
      <ul className="space-y-4">
        {slices.map((slice) => (
          <li key={slice.status}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-label font-semibold">
                {APPROVAL_LABELS[slice.status] ?? slice.status}
              </span>
              <span className="font-mono text-label font-semibold tabular-nums">
                {number.format(slice.count)}
              </span>
            </div>
            <div className="mt-1.5 h-3 rounded-sm bg-secondary">
              <div
                className="h-3 rounded-r-sm bg-chart-1"
                style={{ width: `${Math.max((slice.count / max) * 100, 1)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}
