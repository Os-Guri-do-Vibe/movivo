'use client';

import {
  ArrowUpRight,
  Bot,
  CircleGauge,
  Landmark,
  Megaphone,
  ServerCog,
  ShieldAlert,
  ShieldCheck,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';
import type {
  ControlCenterMetric,
  ControlCenterOverviewResponse,
  ControlCenterPillar,
  ControlCenterPillarSignal,
  ControlCenterPillarState,
  ControlCenterPillarSummary,
} from '@movivo/shared';

import { getOverview } from '@/lib/control-center-api';
import { cn } from '@/lib/utils';

import {
  DataQuality,
  formatMetric,
  ResourceState,
  SectorHeader,
  useControlCenterResource,
} from './control-center-ui';

/** Monitoramento contínuo: a tela se atualiza sozinha enquanto a aba está visível. */
const REFRESH_INTERVAL_MS = 60_000;

/** Mesmo ícone de cada pilar na sidebar, para o fundador reconhecer o setor sem ler. */
const PILLAR_ICON: Record<ControlCenterPillar, LucideIcon> = {
  STUDENTS: UsersRound,
  FINANCE: Landmark,
  MARKETING: Megaphone,
  AI: Bot,
  SYSTEM: ServerCog,
};

/**
 * Semáforo. A cor nunca vem sozinha: o texto do estado acompanha o ponto em todo lugar
 * onde ele aparece, e o estado crítico ainda ganha borda própria.
 */
const STATE_TONE: Record<
  ControlCenterPillarState,
  { dot: string; label: string; border: string; pill: string }
> = {
  OK: {
    dot: 'bg-emerald-500',
    label: 'Tudo certo',
    border: 'border-border',
    pill: 'bg-accent text-accent-foreground',
  },
  ATTENTION: {
    dot: 'bg-amber-500',
    label: 'Atenção',
    border: 'border-amber-500/50',
    pill: 'bg-amber-500/15 text-foreground',
  },
  CRITICAL: {
    dot: 'bg-coral',
    label: 'Crítico',
    border: 'border-coral',
    pill: 'bg-coral/15 text-foreground',
  },
};

const STATE_ORDER: Record<ControlCenterPillarState, number> = { CRITICAL: 0, ATTENTION: 1, OK: 2 };

/** Rótulo que o backend dá ao orçamento de erro do pilar Sistema (vira o anel). */
const ERROR_BUDGET_LABEL = 'Orçamento de erro consumido';

/** Em moeda, a fração (",00") recua: o olho lê o valor inteiro primeiro. */
function splitValue(metric: ControlCenterMetric): { main: string; fraction: string | null } {
  const text = formatMetric(metric);
  if (metric.unit !== 'BRL' || metric.value === null || metric.status === 'UNAVAILABLE') {
    return { main: text, fraction: null };
  }
  const comma = text.lastIndexOf(',');
  return comma === -1
    ? { main: text, fraction: null }
    : { main: text.slice(0, comma), fraction: text.slice(comma) };
}

function BigValue({
  label,
  metric,
  className,
  fractionClassName,
}: {
  label: string;
  metric: ControlCenterMetric;
  className: string;
  fractionClassName: string;
}) {
  const { main, fraction } = splitValue(metric);
  return (
    <p
      className={cn('font-mono font-bold leading-none tracking-tight', className)}
      aria-label={`${label}: ${formatMetric(metric)}`}
      title={metric.status === 'UNAVAILABLE' ? metric.definition : undefined}
    >
      {main}
      {fraction ? <span className={fractionClassName}>{fraction}</span> : null}
    </p>
  );
}

function StatePill({
  state,
  onDark = false,
}: {
  state: ControlCenterPillarState;
  onDark?: boolean;
}) {
  const tone = STATE_TONE[state];
  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold',
        onDark ? 'bg-nevoa/10 text-nevoa' : tone.pill,
      )}
    >
      <span aria-hidden="true" className={cn('size-2 rounded-full', tone.dot)} />
      {tone.label}
    </span>
  );
}

/**
 * Cabeçalho de todo cartão de pilar. O link estica sobre o cartão inteiro (`after:inset-0`),
 * então o cartão todo é clicável sem aninhar elementos interativos.
 */
function PillarHeader({
  pillar,
  onDark = false,
}: {
  pillar: ControlCenterPillarSummary;
  onDark?: boolean;
}) {
  const Icon = PILLAR_ICON[pillar.pillar];
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            'grid size-8 shrink-0 place-items-center rounded-full',
            onDark ? 'bg-verde-pulso/15 text-verde-pulso' : 'bg-accent text-accent-foreground',
          )}
        >
          <Icon aria-hidden="true" className="size-4" />
        </span>
        <Link
          href={pillar.href}
          className="text-label font-semibold after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none"
        >
          {pillar.label}
        </Link>
      </div>
      <StatePill state={pillar.state} onDark={onDark} />
    </div>
  );
}

function SignalRow({
  signal,
  onDark = false,
}: {
  signal: ControlCenterPillarSignal;
  onDark?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <dt className={onDark ? 'text-nevoa/70' : 'text-muted-foreground'}>{signal.label}</dt>
      <dd className="flex items-center gap-1.5 text-right font-semibold">
        <span
          aria-hidden="true"
          className={cn('size-2 shrink-0 rounded-full', STATE_TONE[signal.state].dot)}
        />
        {signal.text}
      </dd>
    </div>
  );
}

/** Números de apoio de um pilar, mais os sinais que não são número (ex.: WhatsApp). */
function PillarFacts({ pillar }: { pillar: ControlCenterPillarSummary }) {
  if (pillar.details.length === 0 && pillar.signals.length === 0) return null;
  return (
    <dl className="mt-auto divide-y divide-border border-t border-border pt-0 text-xs">
      {pillar.details.map((detail) => (
        <div
          key={detail.label}
          className="flex items-baseline justify-between gap-3 py-2"
          title={detail.metric.definition}
        >
          <dt className="text-muted-foreground">{detail.label}</dt>
          <dd className="font-mono font-semibold text-foreground">{formatMetric(detail.metric)}</dd>
        </div>
      ))}
      {pillar.signals.map((signal) => (
        <SignalRow key={signal.label} signal={signal} />
      ))}
    </dl>
  );
}

const CARD_FOCUS = 'has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring';

/**
 * Cartão de destaque, escuro como o "saldo total" da referência. É o número que paga a
 * conta (MRR), com os três que o ameaçam logo abaixo.
 */
function HeroCard({ pillar }: { pillar: ControlCenterPillarSummary }) {
  return (
    <section
      aria-label={pillar.label}
      className={cn(
        'relative flex flex-col overflow-hidden rounded-2xl border bg-petroleo p-6 text-nevoa shadow-sm transition-colors hover:border-verde-pulso dark:bg-[var(--petroleo-superficie)]',
        pillar.state === 'OK'
          ? 'border-petroleo dark:border-[var(--petroleo-borda)]'
          : STATE_TONE[pillar.state].border,
        CARD_FOCUS,
      )}
    >
      <PillarHeader pillar={pillar} onDark />
      <p className="mt-8 text-label text-nevoa/75">{pillar.headline.label}</p>
      <BigValue
        label={pillar.headline.label}
        metric={pillar.headline.metric}
        className="mt-2 text-4xl sm:text-5xl"
        fractionClassName="text-2xl text-nevoa/60"
      />
      {pillar.details.length > 0 ? (
        <dl className="mt-8 divide-y divide-nevoa/10 rounded-xl bg-nevoa/10 px-4 text-sm">
          {pillar.details.map((detail) => (
            <div
              key={detail.label}
              className="flex items-baseline justify-between gap-3 py-2.5"
              title={detail.metric.definition}
            >
              <dt className="text-nevoa/75">{detail.label}</dt>
              <dd className="font-mono font-bold">{formatMetric(detail.metric)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}

/** Cartão-KPI de um pilar: um número âncora, os de apoio e, se houver, o motivo do alerta. */
function PillarCard({ pillar }: { pillar: ControlCenterPillarSummary }) {
  return (
    <section
      aria-label={pillar.label}
      className={cn(
        'relative flex flex-col rounded-2xl border bg-card p-5 transition-colors hover:border-verde-pulso',
        STATE_TONE[pillar.state].border,
        CARD_FOCUS,
      )}
    >
      <PillarHeader pillar={pillar} />
      <p className="mt-6 min-h-8 text-xs text-muted-foreground">{pillar.headline.label}</p>
      <BigValue
        label={pillar.headline.label}
        metric={pillar.headline.metric}
        className="mt-1.5 text-3xl"
        fractionClassName="text-lg text-muted-foreground"
      />
      <div className="mt-5 flex flex-1 flex-col justify-end">
        <PillarFacts pillar={pillar} />
      </div>
    </section>
  );
}

const BUDGET_RING = { size: 176, stroke: 18 } as const;

/**
 * Anel do orçamento de erro, no lugar do donut da referência. Passou de 70% da margem já
 * pede cuidado; acima de 100% a meta estourou.
 */
function ErrorBudgetRing({ metric }: { metric: ControlCenterMetric }) {
  const radius = (BUDGET_RING.size - BUDGET_RING.stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const available = metric.status !== 'UNAVAILABLE' && metric.value !== null;
  const consumed = available ? (metric.value as number) : 0;
  const ratio = Math.min(Math.max(consumed, 0), 100) / 100;
  const stroke =
    consumed >= 100 ? 'stroke-coral' : consumed >= 70 ? 'stroke-amber-500' : 'stroke-emerald-500';
  const text = available ? formatMetric(metric) : '—';
  return (
    <div
      className="relative mx-auto size-44 shrink-0"
      role="img"
      aria-label={
        available
          ? `Margem de erro consumida: ${formatMetric(metric)}`
          : 'Margem de erro sem dados no período'
      }
      title={metric.definition}
    >
      <svg viewBox={`0 0 ${BUDGET_RING.size} ${BUDGET_RING.size}`} className="size-full -rotate-90">
        <circle
          cx={BUDGET_RING.size / 2}
          cy={BUDGET_RING.size / 2}
          r={radius}
          fill="none"
          strokeWidth={BUDGET_RING.stroke}
          className="stroke-muted"
        />
        {available ? (
          <circle
            cx={BUDGET_RING.size / 2}
            cy={BUDGET_RING.size / 2}
            r={radius}
            fill="none"
            strokeWidth={BUDGET_RING.stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - ratio)}
            className={stroke}
          />
        ) : null}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="font-mono text-2xl font-bold" aria-hidden="true">
          {text}
        </span>
        <span
          className="mt-1 max-w-[7rem] text-xs leading-tight text-muted-foreground"
          aria-hidden="true"
        >
          da margem de erro usada
        </span>
      </div>
    </div>
  );
}

/**
 * Sistema é o cartão largo (a "visão de gastos" da referência): o pior objetivo de serviço
 * como número, o anel de margem de erro e a conexão do WhatsApp ao lado.
 */
function SystemCard({ pillar }: { pillar: ControlCenterPillarSummary }) {
  const budget = pillar.details.find((detail) => detail.label === ERROR_BUDGET_LABEL);
  return (
    <section
      aria-label={pillar.label}
      className={cn(
        'relative flex flex-col rounded-2xl border bg-card p-6 transition-colors hover:border-verde-pulso',
        STATE_TONE[pillar.state].border,
        CARD_FOCUS,
      )}
    >
      <PillarHeader pillar={pillar} />
      <div className="my-auto grid items-center gap-8 py-6 md:grid-cols-[auto_1fr]">
        {budget ? <ErrorBudgetRing metric={budget.metric} /> : null}
        <div className="min-w-0">
          <p className="text-label text-muted-foreground">{pillar.headline.label}</p>
          <BigValue
            label={pillar.headline.label}
            metric={pillar.headline.metric}
            className="mt-2 text-4xl"
            fractionClassName="text-xl text-muted-foreground"
          />
          <div className="mt-5 flex flex-col">
            <PillarFacts pillar={pillar} />
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * "Atenção agora": o equivalente do insight da referência. Só lista pilares fora do
 * `OK`, críticos primeiro, com o motivo que o próprio backend já escreveu.
 */
function AttentionCard({ pillars }: { pillars: readonly ControlCenterPillarSummary[] }) {
  const items = pillars
    .filter((pillar) => pillar.state !== 'OK')
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state]);
  const first = items[0];
  const Icon = first ? ShieldAlert : ShieldCheck;
  return (
    <section
      aria-label="Atenção agora"
      className="relative overflow-hidden rounded-2xl border border-petroleo bg-petroleo p-6 text-nevoa dark:border-[var(--petroleo-borda)] dark:bg-[var(--petroleo-superficie)]"
    >
      <Icon aria-hidden="true" className="absolute -bottom-5 -right-4 size-32 text-nevoa/10" />
      <h2 className="relative flex items-center gap-2 text-label font-semibold text-nevoa/80">
        <Icon aria-hidden="true" className="size-4 text-verde-pulso" />
        Atenção agora
      </h2>
      {first ? (
        <div className="relative">
          <p className="mt-3 text-h3 font-semibold leading-snug">
            {items.length === 1 ? '1 pilar pede ação' : `${items.length} pilares pedem ação`}
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {items.map((pillar) => (
              <li key={pillar.pillar} className="flex gap-2.5">
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-1.5 size-2 shrink-0 rounded-full',
                    STATE_TONE[pillar.state].dot,
                  )}
                />
                <span>
                  <span className="font-semibold">{pillar.label}:</span>{' '}
                  <span className="text-nevoa/85">
                    {pillar.reason ?? STATE_TONE[pillar.state].label}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <Link
            href={first.href}
            className="mt-5 inline-flex h-11 items-center gap-2 rounded-lg bg-verde-pulso px-4 text-label font-semibold text-petroleo transition-colors hover:bg-verde-pulso/90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
          >
            Ver {first.label}
            <ArrowUpRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
      ) : (
        <p className="relative mt-3 max-w-[16rem] text-h3 font-semibold leading-snug">
          Tudo certo por aqui. Nenhum pilar pede ação agora.
        </p>
      )}
    </section>
  );
}

/**
 * Visão Geral (US-7.8): resume os pilares, nenhum número nasce aqui. Um pilar sem
 * capability não chega no payload, então a composição se adapta a quantos vierem:
 * o Financeiro vira o destaque (ou o primeiro disponível), Sistema ganha o cartão largo
 * e os demais viram cartões-KPI.
 */
function OverviewSections({ data }: { data: ControlCenterOverviewResponse['data'] }) {
  const { pillars } = data;
  const system = pillars.find((pillar) => pillar.pillar === 'SYSTEM');
  const hero =
    pillars.find((pillar) => pillar.pillar === 'FINANCE') ??
    pillars.find((pillar) => pillar.pillar !== 'SYSTEM');
  const tiles = pillars.filter((pillar) => pillar !== hero && pillar !== system);

  return (
    <div className="mt-8 space-y-4">
      {hero ? (
        <div
          className={cn(
            'grid gap-4',
            tiles.length > 0 && 'xl:grid-cols-[minmax(0,1.35fr)_minmax(0,3fr)]',
          )}
        >
          <HeroCard pillar={hero} />
          {tiles.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-[repeat(auto-fit,minmax(14rem,1fr))]">
              {tiles.map((pillar) => (
                <PillarCard key={pillar.pillar} pillar={pillar} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className={cn('grid gap-4', system && 'xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]')}>
        {system ? <SystemCard pillar={system} /> : null}
        <div className="grid gap-4 content-start">
          <AttentionCard pillars={pillars} />
        </div>
      </div>
    </div>
  );
}

export function OverviewDashboard() {
  const state = useControlCenterResource(getOverview);
  const { refresh } = state;

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  if (!state.data) {
    return (
      <ResourceState
        loading={state.loading}
        error={state.error}
        forbidden={state.forbidden}
        onRetry={() => void state.refresh()}
      />
    );
  }
  return (
    <div>
      <SectorHeader
        title="Visão Geral"
        icon={CircleGauge}
        meta={state.data.meta}
        refreshing={state.loading}
        onRefresh={() => void state.refresh()}
      />
      <p className="mt-2 max-w-3xl text-label text-muted-foreground">
        O essencial de cada pilar, para olhar de relance. Atualiza sozinha a cada minuto.
      </p>
      {state.error ? (
        <p
          role="alert"
          className="mt-4 rounded-lg bg-destructive p-3 text-label text-destructive-foreground"
        >
          A última atualização falhou: {state.error}
        </p>
      ) : null}
      <OverviewSections data={state.data.data} />
      <DataQuality notes={state.data.meta.dataQuality} />
    </div>
  );
}
