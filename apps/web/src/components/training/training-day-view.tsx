'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type { TrainingDay } from '@movivo/shared';

import { TrainingApiError } from '@/lib/training-api';

import { DailyCheckInStep } from './daily-check-in-step';
import { ExternalLogForm } from './external-log-form';
import { FinishForm } from './finish-form';
import { dateLabel } from './format';
import { SessionCard } from './session-card';
import { StudentAlert, StudentGreeting, StudentShell } from './student-nav';
import { useTrainingApi } from './training-api-context';

const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** "Quarta-feira, 4 de novembro de 2026": a data do dia escolhido, por extenso. */
function longDate(date: string): string {
  const label = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Mesma data, uma semana antes (-7) ou depois (+7). */
function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** "Semana atual", "Semana passada", "3 semanas atrás", "Próxima semana". */
function weekContext(weekStart: string, todayWeekStart: string): string {
  const offset = Math.round(
    (Date.parse(`${weekStart}T12:00:00Z`) - Date.parse(`${todayWeekStart}T12:00:00Z`)) /
      604_800_000,
  );
  if (offset === 0) return 'Semana atual';
  if (offset === -1) return 'Semana passada';
  if (offset === 1) return 'Próxima semana';
  return offset < 0 ? `${-offset} semanas atrás` : `Daqui a ${offset} semanas`;
}

/** Segunda-feira da semana de uma data (a semana do diário vai de segunda a domingo). */
function mondayOf(date: string): string {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addDays(date, day === 0 ? -6 : 1 - day);
}

const weekdayOf = (date: string) => WEEKDAY_SHORT[new Date(`${date}T12:00:00Z`).getUTCDay()] ?? '';

/**
 * O check-in diário, em etapas (o acesso pelo link vem antes, em `/hoje/acessar`):
 *  2. perguntas de disposição e do dia, uma vez por dia;
 *  3. o treino: "Iniciar", registros da sessão e "Finalizar treino";
 *  4. o questionário pós-treino (PSE, como se sentiu, dor);
 *  5. treino concluído, com o cartão para o Story.
 */
export function TrainingDayView({ date }: { date?: string }) {
  const api = useTrainingApi();
  const [day, setDay] = useState<TrainingDay | null>(null);
  const [selected, setSelected] = useState<string | undefined>(date);
  const [error, setError] = useState('');
  const [showExternal, setShowExternal] = useState(false);
  const [finishing, setFinishing] = useState<string | null>(null);
  const [checkInLater, setCheckInLater] = useState(false);

  const load = useCallback(
    async (target?: string) => {
      try {
        setDay(await api.getTrainingDay(target));
        setError('');
      } catch (caught) {
        setError(
          caught instanceof TrainingApiError && caught.status === 401
            ? 'Abra o link mais recente enviado no seu WhatsApp.'
            : 'Não foi possível carregar o treino agora.',
        );
      }
    },
    [api],
  );

  useEffect(() => {
    void load(selected);
  }, [load, selected]);

  if (error) {
    return (
      <StudentShell current="/hoje">
        <StudentAlert>{error}</StudentAlert>
      </StudentShell>
    );
  }
  if (!day) {
    return (
      <StudentShell current="/hoje" busy>
        <p className="py-10 text-center text-muted-foreground">Carregando seu treino…</p>
      </StudentShell>
    );
  }

  const viewingToday = day.date === day.today;
  const running = day.selected.find((s) => s.execution?.status === 'IN_PROGRESS');

  // Etapa 4: o questionário ocupa a tela inteira, como no check-in de sempre.
  const closing = finishing ? day.selected.find((s) => s.scheduledSessionId === finishing) : null;
  if (closing?.execution) {
    return (
      <StudentShell current="/hoje">
        <FinishForm
          session={closing}
          execution={closing.execution}
          onBack={() => setFinishing(null)}
          onFinished={() => {
            setFinishing(null);
            void load(selected).then(() => window.scrollTo(0, 0));
          }}
        />
      </StudentShell>
    );
  }

  // Etapa 2: as perguntas do dia vêm antes do treino (uma vez por dia).
  if (viewingToday && day.hasPlan && day.checkedInToday === false && !checkInLater && !running) {
    return (
      <StudentShell current="/hoje">
        <StudentGreeting firstName={day.firstName} title="seu check-in de hoje" />
        <DailyCheckInStep
          training={day.selected.length > 0}
          onDone={() => void load(selected)}
          onSkip={() => setCheckInLater(true)}
        />
      </StudentShell>
    );
  }

  // Treino em andamento trava a navegação entre dias, como antes.
  const locked = Boolean(running);
  const weekStart = day.week[0]?.date ?? day.date;
  // Antes do primeiro treino agendado não há nada para ver; depois de hoje, só a semana atual.
  const canGoBack = !locked && (!day.firstScheduledOn || weekStart > day.firstScheduledOn);
  const canGoForward = !locked && addDays(day.date, 7) <= day.today;
  const context = weekContext(weekStart, mondayOf(day.today));
  return (
    <StudentShell current="/hoje">
      <StudentGreeting firstName={day.firstName} title="seu treino" />

      <section aria-label="Semana">
        <p className="mb-2 text-center text-label font-bold tracking-widest text-muted-foreground uppercase">
          {context}
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Semana anterior"
            disabled={!canGoBack}
            onClick={() => setSelected(addDays(day.date, -7))}
            className="grid size-11 shrink-0 place-items-center rounded-full text-verde-pulso transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:text-muted-foreground disabled:opacity-40"
          >
            <ChevronLeft size={24} aria-hidden="true" />
          </button>
          <div className="grid flex-1 grid-cols-7 gap-1">
            {day.week.map((d) => {
              const selectedDay = d.date === day.date;
              const isToday = d.date === day.today;
              const done = d.sessions.length > 0 && d.sessions.every((x) => x.status === 'DONE');
              return (
                <button
                  key={d.date}
                  type="button"
                  disabled={locked}
                  aria-current={selectedDay ? 'date' : undefined}
                  aria-label={`${dateLabel(d.date)}${d.sessions.length === 0 ? ', sem treino' : done ? ', treino concluído' : ', com treino'}`}
                  onClick={() => setSelected(d.date)}
                  className="mx-auto flex min-w-8 flex-col items-center gap-1.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                >
                  <span
                    className={`grid size-8 place-items-center rounded-full text-label font-extrabold ${isToday ? 'bg-primary text-primary-foreground' : selectedDay ? 'bg-destructive text-destructive-foreground' : 'bg-muted text-muted-foreground'} ${selectedDay && isToday ? 'ring-2 ring-petroleo ring-offset-2 ring-offset-background' : ''}`}
                  >
                    {Number(d.date.slice(-2))}
                  </span>
                  <span className="text-[0.68rem] font-bold text-muted-foreground uppercase">
                    {weekdayOf(d.date)}
                  </span>
                  <span
                    aria-hidden="true"
                    className={`h-1.5 w-1.5 rounded-full ${d.sessions.length === 0 ? 'bg-transparent' : done ? 'bg-verde-pulso' : 'bg-petroleo/40'}`}
                  />
                </button>
              );
            })}
          </div>
          <button
            type="button"
            aria-label="Próxima semana"
            disabled={!canGoForward}
            onClick={() => setSelected(addDays(day.date, 7))}
            className="grid size-11 shrink-0 place-items-center rounded-full text-verde-pulso transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:text-muted-foreground disabled:opacity-40"
          >
            <ChevronRight size={24} aria-hidden="true" />
          </button>
        </div>
        <p className="mt-3 text-center text-label font-bold text-foreground">
          {longDate(day.date)}
        </p>
        {!viewingToday ? (
          <button
            type="button"
            onClick={() => setSelected(day.today)}
            className="mx-auto mt-3 block rounded-full bg-petroleo px-4 py-2 text-label font-bold text-white"
          >
            Voltar para hoje
          </button>
        ) : null}
      </section>

      {day.selected.length === 0 ? (
        <section className="rounded-3xl bg-card p-8 text-center shadow-sm">
          <p aria-hidden="true" className="text-h2">
            {day.hasPlan ? '🌿' : '⏳'}
          </p>
          <p className="mt-3 text-h3 font-extrabold text-foreground">
            {day.hasPlan ? 'Dia de recuperação' : 'Plano em preparo'}
          </p>
          <p className="mt-2 text-muted-foreground">
            {day.hasPlan
              ? 'Não há treino prescrito para este dia. Recuperar também é parte do plano.'
              : 'Seu plano ainda está sendo preparado. Assim que ficar pronto, avisamos por aqui.'}
          </p>
          {viewingToday && day.checkedInToday ? (
            <p role="status" className="mt-4 text-label font-bold text-petroleo">
              ✓ Check-in do dia registrado.
            </p>
          ) : null}
        </section>
      ) : (
        day.selected.map((session) => (
          <SessionCard
            key={session.scheduledSessionId}
            session={session}
            isToday={viewingToday}
            onChanged={() => load(selected)}
            onFinish={async () => {
              // Os registros mais recentes (séries, números do relógio) entram no questionário.
              await load(selected);
              setFinishing(session.scheduledSessionId);
              window.scrollTo(0, 0);
            }}
          />
        ))
      )}

      {locked ? null : showExternal ? (
        <ExternalLogForm
          today={day.today}
          onLogged={() => {
            setShowExternal(false);
            void load(selected);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowExternal(true)}
          className="min-h-12 w-full rounded-2xl border border-verde-pulso bg-card px-4 font-bold text-petroleo transition-colors hover:bg-muted"
        >
          Registrar outro treino
        </button>
      )}
    </StudentShell>
  );
}
