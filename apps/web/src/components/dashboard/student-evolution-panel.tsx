'use client';

/**
 * Evolução do aluno na ficha da Base de Alunos: o que os agentes veem (carga, razão aguda:crônica,
 * monotonia, strain, prontidão, medidas, força, dor e memória) para a equipe auditar o
 * acompanhamento. Dado de saúde: só abre para quem tem a capability e a leitura fica auditada.
 */
import type { StudentEvolution } from '@movivo/shared';
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { useCallback } from 'react';

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { getStudentEvolution } from '@/lib/control-center-api';

import { useControlCenterResource } from './control-center-ui';

const MEASURE_LABEL: Record<string, string> = {
  WEIGHT: 'Peso (kg)',
  WAIST: 'Cintura (cm)',
  HIP: 'Glúteos (cm)',
  CHEST: 'Peitoral (cm)',
  ARM: 'Braço (cm)',
  THIGH: 'Coxa (cm)',
  CALF: 'Panturrilha (cm)',
  BODY_FAT_PERCENT: '% de gordura',
};

const RISK_LABEL: Record<string, string> = {
  ACWR_HIGH: 'Carga subiu rápido demais',
  ACWR_ELEVATED: 'Carga em alta',
  ACWR_LOW: 'Carga abaixo do habitual',
  LOAD_SPIKE: 'Salto de carga semanal',
  MONOTONY_HIGH: 'Treinos muito parecidos',
  READINESS_LOW: 'Prontidão baixa',
  SLEEP_LOW: 'Sono baixo',
  STRESS_HIGH: 'Estresse alto',
  PLANNED_UNDERDONE: 'Menos da metade do planejado',
};

const MEMORY_LABEL: Record<string, string> = {
  ROUTINE: 'Rotina',
  MOTIVATION: 'Motivação',
  BARRIER: 'Barreira',
  PREFERENCE: 'Preferência',
  PERSONAL: 'Contexto de vida',
  HEALTH_CONTEXT: 'Saúde',
  COMMUNICATION: 'Conversa',
  MILESTONE: 'Marco',
};

const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const num = (value: number | null, digits = 1) =>
  value === null ? '—' : value.toLocaleString('pt-BR', { maximumFractionDigits: digits });

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-mono text-h3 font-bold">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function LineCard({
  title,
  data,
  dataKey,
  label,
  xKey = 'date',
}: {
  title: string;
  data: ReadonlyArray<Record<string, string | number | null>>;
  dataKey: string;
  label: string;
  xKey?: string;
}) {
  const config = { [dataKey]: { label, color: 'var(--color-chart-1)' } } satisfies ChartConfig;
  return (
    <figure className="rounded-lg border border-border p-3">
      <figcaption className="text-label font-semibold">{title}</figcaption>
      <ChartContainer config={config} className="mt-2 aspect-auto h-[150px] w-full">
        <LineChart data={data as Array<Record<string, string | number | null>>} accessibilityLayer>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey={xKey}
            tickLine={false}
            axisLine={false}
            tickMargin={6}
            minTickGap={24}
            tickFormatter={(v: string) => shortDate(String(v))}
          />
          <YAxis width={36} tickLine={false} axisLine={false} className="font-mono" />
          <ChartTooltip
            content={
              <ChartTooltipContent
                className="font-mono"
                labelFormatter={(l) => shortDate(String(l))}
              />
            }
          />
          <Line
            dataKey={dataKey}
            type="monotone"
            stroke={`var(--color-${dataKey})`}
            strokeWidth={2}
            dot={data.length < 12}
            connectNulls
          />
        </LineChart>
      </ChartContainer>
    </figure>
  );
}

function WeeklyLoad({ weeks }: { weeks: StudentEvolution['weeks'] }) {
  const config = {
    plannedLoad: { label: 'Planejada', color: 'var(--color-chart-4)' },
    realizedLoad: { label: 'Realizada', color: 'var(--color-chart-1)' },
  } satisfies ChartConfig;
  return (
    <figure className="rounded-lg border border-border p-3">
      <figcaption className="text-label font-semibold">Carga por semana (sRPE)</figcaption>
      <ChartContainer config={config} className="mt-2 aspect-auto h-[170px] w-full">
        <BarChart data={weeks as StudentEvolution['weeks']} accessibilityLayer>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="weekStart"
            tickLine={false}
            axisLine={false}
            tickMargin={6}
            minTickGap={16}
            tickFormatter={(v: string) => shortDate(String(v))}
          />
          <YAxis width={40} tickLine={false} axisLine={false} className="font-mono" />
          <ChartTooltip
            content={
              <ChartTooltipContent
                className="font-mono"
                labelFormatter={(l) => `Semana de ${shortDate(String(l))}`}
              />
            }
          />
          <Bar dataKey="plannedLoad" fill="var(--color-plannedLoad)" radius={2} />
          <Bar dataKey="realizedLoad" fill="var(--color-realizedLoad)" radius={2} />
        </BarChart>
      </ChartContainer>
    </figure>
  );
}

export function StudentEvolutionPanel({ studentId }: { studentId: string }) {
  const load = useCallback(
    (signal?: AbortSignal) => getStudentEvolution(studentId, signal),
    [studentId],
  );
  const { data, error, loading } = useControlCenterResource(load);

  if (!data) {
    return (
      <p className="text-xs text-muted-foreground" role={error ? 'alert' : 'status'}>
        {loading ? 'Carregando a evolução…' : (error ?? 'Evolução indisponível.')}
      </p>
    );
  }
  const evolution: StudentEvolution = data;
  const { load: metrics } = evolution;
  const readinessDays = evolution.days.filter((d) => d.readiness !== null);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Tile
          label="Carga da semana"
          value={num(metrics.weeklyLoad, 0)}
          hint={`anterior ${num(metrics.previousWeeklyLoad, 0)}`}
        />
        <Tile label="Aguda:crônica" value={num(metrics.acwr, 2)} hint="ideal 0,8 a 1,3" />
        <Tile label="Monotonia" value={num(metrics.monotony, 2)} hint="acima de 2 = alerta" />
        <Tile label="Strain" value={num(metrics.strain, 0)} />
        <Tile
          label="Prontidão"
          value={num(metrics.readiness.score, 0)}
          hint={
            metrics.readiness.delta === null
              ? undefined
              : `${metrics.readiness.delta > 0 ? '+' : ''}${metrics.readiness.delta} sobre o normal dele`
          }
        />
      </div>

      {metrics.risks.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Sinais de atenção">
          {metrics.risks.map((risk) => (
            <li
              key={risk.kind}
              title={risk.detail}
              className="rounded-full border border-border px-3 py-1 text-xs"
            >
              {RISK_LABEL[risk.kind] ?? risk.kind}: {risk.detail}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">Nenhum sinal de atenção na carga agora.</p>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <WeeklyLoad weeks={evolution.weeks} />
        {readinessDays.length > 1 ? (
          <LineCard
            title="Prontidão diária (0 a 100)"
            data={readinessDays}
            dataKey="readiness"
            label="Prontidão"
          />
        ) : (
          <p className="rounded-lg border border-border p-3 text-xs text-muted-foreground">
            Poucos check-ins para desenhar a prontidão (o aluno responde no treino e nos dias de
            descanso).
          </p>
        )}
        {evolution.nutritionDays.length > 1 ? (
          <>
            <LineCard
              title="Calorias registradas por dia (kcal)"
              data={evolution.nutritionDays}
              dataKey="energyKcal"
              label="Calorias"
            />
            <LineCard
              title="Proteína registrada por dia (g)"
              data={evolution.nutritionDays}
              dataKey="proteinG"
              label="Proteína"
            />
          </>
        ) : (
          <p className="rounded-lg border border-border p-3 text-xs text-muted-foreground">
            Poucos registros alimentares para desenhar o consumo (o aluno registra pelo WhatsApp:
            texto, áudio ou foto).
          </p>
        )}
        {evolution.nutritionDays.filter((d) => d.waterMl !== null).length > 1 ? (
          <LineCard
            title="Água registrada por dia (ml)"
            data={evolution.nutritionDays.filter((d) => d.waterMl !== null)}
            dataKey="waterMl"
            label="Água"
          />
        ) : null}
        {evolution.measurements
          .filter((m) => m.points.length > 1)
          .map((m) => (
            <LineCard
              key={m.kind}
              title={MEASURE_LABEL[m.kind] ?? m.kind}
              data={m.points}
              dataKey="value"
              label={MEASURE_LABEL[m.kind] ?? m.kind}
              xKey="date"
            />
          ))}
        {evolution.strength
          .filter((s) => s.points.length > 1)
          .map((s) => (
            <LineCard
              key={s.exerciseId}
              title={`Carga de topo · ${s.exerciseId.replaceAll('_', ' ')} (kg)`}
              data={s.points}
              dataKey="topLoadKg"
              label="Carga de topo (kg)"
            />
          ))}
      </div>

      {evolution.pain.length > 0 ? (
        <div>
          <h3 className="text-label font-semibold">Dor nos últimos 90 dias</h3>
          <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
            {evolution.pain.map((p) => (
              <li key={p.region}>
                <span className="text-foreground">{p.region}</span> · {p.reports} relato(s) ·
                intensidade máxima {p.maxIntensity}/10 · último em {shortDate(p.lastOn)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <h3 className="text-label font-semibold">O que os agentes sabem do aluno</h3>
        {evolution.memory.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">Memória ainda vazia.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-xs">
            {evolution.memory.map((item) => (
              <li key={`${item.kind}-${item.text}`} className="text-muted-foreground">
                <span className="text-foreground">{MEMORY_LABEL[item.kind] ?? item.kind}</span> ·{' '}
                {item.text}
              </li>
            ))}
          </ul>
        )}
      </div>

      {evolution.reassessments.length > 0 ? (
        <div>
          <h3 className="text-label font-semibold">Reavaliações de ciclo</h3>
          <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
            {evolution.reassessments.map((r) => (
              <li key={r.cycleEndedOn}>
                Ciclo até {shortDate(r.cycleEndedOn)} · {r.status}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
