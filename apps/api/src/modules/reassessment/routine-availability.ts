/**
 * A rotina que o aluno conta na reavaliação passa a ser a disponibilidade dele: o plano do próximo
 * ciclo é montado em cima dos dias, do período e do tempo de agora, não só de um texto de contexto.
 * Função pura: recebe a disponibilidade atual e devolve a nova (ou `null` se nada muda).
 */
import type {
  AvailabilityWindow,
  CycleReassessmentAnswers,
  StudentConstraint,
} from '@movivo/shared';

type Availability = Extract<StudentConstraint, { kind: 'AVAILABILITY' }>;

const DEFAULT_MINUTES = 60;

export interface RoutineAvailability {
  constraint: Availability;
  /** Aviso para quem audita: pedido que a disponibilidade registrada não comporta. */
  note: string | null;
}

export function availabilityFromRoutine(
  routine: CycleReassessmentAnswers['routine'],
  current: Availability | null,
): RoutineAvailability | null {
  if (!routine.changed) return null;
  const { weekdays, sessionMinutes, slot, daysPerWeek } = routine;
  const byDay = new Map<string, AvailabilityWindow>();
  for (const window of current?.windows ?? []) {
    if (!byDay.has(window.weekday)) byDay.set(window.weekday, window);
  }
  const longestBefore = Math.max(0, ...[...byDay.values()].map((window) => window.maxMinutes));
  const minutesOr = (previous: number | undefined) =>
    sessionMinutes ?? previous ?? (longestBefore > 0 ? longestBefore : DEFAULT_MINUTES);

  // 1) O aluno disse os dias: eles são a nova disponibilidade.
  if (weekdays.length > 0) {
    const windows: AvailabilityWindow[] = weekdays.map((weekday) => ({
      weekday,
      slot: slot ?? byDay.get(weekday)?.slot ?? 'ANY',
      maxMinutes: minutesOr(byDay.get(weekday)?.maxMinutes),
    }));
    return {
      constraint: {
        kind: 'AVAILABILITY',
        windows,
        variesWeekly: current?.variesWeekly ?? false,
        maxSessionsPerWeek: Math.min(14, weekdays.length),
      },
      note: null,
    };
  }

  // 2) Sem os dias: só dá para ajustar o que já existe (período, tempo, quantidade).
  if (!current) return null;
  const windows = current.windows.map((window) => ({
    ...window,
    slot: slot ?? window.slot,
    maxMinutes: sessionMinutes ?? window.maxMinutes,
  }));
  const distinctDays = new Set(windows.map((window) => window.weekday)).size;
  const wanted = daysPerWeek ?? current.maxSessionsPerWeek;
  const maxSessionsPerWeek = Math.min(wanted, distinctDays);
  const unchanged =
    maxSessionsPerWeek === current.maxSessionsPerWeek &&
    windows.every((window, i) => {
      const before = current.windows[i];
      return before?.slot === window.slot && before.maxMinutes === window.maxMinutes;
    });
  if (unchanged && wanted <= distinctDays) return null;
  return {
    constraint: { ...current, windows, maxSessionsPerWeek },
    note:
      wanted > distinctDays
        ? `O aluno quer treinar ${wanted} dias por semana, mas só há janela cadastrada em ${distinctDays}: o plano usa ${distinctDays}. Vale confirmar os dias com ele.`
        : null,
  };
}
