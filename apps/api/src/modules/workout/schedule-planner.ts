/**
 * Calendário efetivo e planejador de ajustes de agenda — funções puras, sem I/O.
 *
 * O aluno pede ao Coach ("hoje consigo treinar o A", "amanhã quero descansar") e o servidor
 * decide o novo arranjo da semana. Nenhuma parte disso passa por IA: a IA só extrai o pedido
 * (`AdjustmentRequest`); o arranjo sai daqui, o mesmo para a mesma entrada.
 *
 * ## Semana
 * Segunda a domingo, a mesma ordem de `WEEK_ORDER` do protocolo. Um ajuste só mexe em datas
 * da semana corrente e de hoje em diante; o que não couber fica de fora, por escolha do aluno.
 *
 * ## Limites físicos (as únicas recusas)
 *  - um treino por dia (o diário guarda uma sessão por data);
 *  - a semana não passa dos treinos contratados (`quota`): reorganizar é livre, criar treino extra não;
 *  - dia já treinado ou em andamento não muda;
 *  - nada de datas passadas nem de semanas futuras.
 * Não há limite de quantos ajustes por semana, nem regra de recuperação ou de ordem das
 * sessões (orientação do RT: distribuição e ordem não pesam para este público).
 *
 * ## Movimentos
 *  - `TRAIN_ON` (antecipar/trazer): põe uma sessão no dia pedido. Quem estava lá vai para o lugar
 *    da sessão trazida (troca); se o lugar era um dia que já passou, vai para o próximo descanso.
 *  - `REST_ON` (descansar): o dia vira descanso e as sessões seguintes andam um dia para frente
 *    até consumir o primeiro descanso da semana, preservando ordem e quantidade.
 *  - `REORGANIZE`: o aluno diz onde fica cada sessão (ou que ela fica de fora). Vale qualquer
 *    arranjo que respeite os limites acima.
 * Quando um movimento não cabe (semana sem descanso para absorver o empurrão), o resultado é
 * `FULL_WEEK`: o Coach pergunta qual treino fica de fora e o pedido é refeito com `leaveOut`.
 */
import type { ProtocolSession, ProtocolStructure } from '@movivo/shared';

import { dayKey, sessionForWeekday } from './workout-schedule';

const DAY_MS = 86_400_000;

/** Quantos dias para trás o aluno ainda pode registrar um treino que já fez (ontem e anteontem). */
export const LATE_LOG_WINDOW_DAYS = 2;

export function dateAtNoon(date: string): Date {
  return new Date(`${date}T12:00:00.000Z`);
}

export function addDays(date: string, days: number): string {
  return new Date(dateAtNoon(date).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = domingo … 6 = sábado, do dia civil `YYYY-MM-DD` (mesma convenção de `EXTRACT(dow)`). */
export function weekdayOfDate(date: string): number {
  return dateAtNoon(date).getUTCDay();
}

export function weekStartMonday(date: string): string {
  return addDays(date, -((weekdayOfDate(date) + 6) % 7));
}

/** Os sete dias da semana (segunda a domingo) que contém `date`. */
export function weekDates(date: string): string[] {
  const start = weekStartMonday(date);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

/** Data → sessão que vale no dia (`null` = descanso). Só as datas ajustadas aparecem. */
export type ScheduleOverrides = ReadonlyMap<string, string | null>;

/**
 * Sessão que vale em `date`: a do último ajuste ativo que cita o dia, ou o calendário padrão do
 * protocolo. Uma chave que não existe mais na estrutura (protocolo reescrito no meio da semana)
 * cai no calendário padrão em vez de quebrar.
 */
export function effectiveSessionForDate(
  date: string,
  structure: ProtocolStructure,
  overrides?: ScheduleOverrides,
): ProtocolSession | null {
  if (overrides?.has(date)) {
    const key = overrides.get(date) ?? null;
    if (key === null) return null;
    const session = structure.sessions.find((candidate) => candidate.dayLabel === key);
    if (session) return session;
  }
  return sessionForWeekday(weekdayOfDate(date), structure);
}

/** Ajustes ativos, do mais antigo ao mais novo: o último que cita a data vence. */
export function overridesFromAdjustments(
  adjustments: ReadonlyArray<{
    assignments: ReadonlyArray<{ date: string; sessionKey: string | null }>;
  }>,
): Map<string, string | null> {
  const overrides = new Map<string, string | null>();
  for (const adjustment of adjustments) {
    for (const assignment of adjustment.assignments) {
      overrides.set(assignment.date, assignment.sessionKey);
    }
  }
  return overrides;
}

export interface WeekSlot {
  date: string;
  /** Sessão do dia (`null` = descanso). */
  sessionKey: string | null;
  /** Dia já treinado ou em andamento: não muda. */
  locked: boolean;
}

export interface SessionRowSummary {
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED';
  sessionKey: string;
}

/**
 * Monta os sete dias da semana de `today` com o calendário efetivo. Treino concluído ou em
 * andamento prevalece sobre o calendário e trava o dia. Dias até a entrega do primeiro protocolo
 * (e já passados) não tinham treino prescrito: ficam vazios e travados.
 */
export function buildWeekSlots(input: {
  today: string;
  /** Semana a montar: a que contém esta data (padrão: a de `today`). Registro tardio usa uma data passada. */
  anchor?: string;
  firstProtocolDate: string;
  structure: ProtocolStructure;
  overrides?: ScheduleOverrides;
  sessionsByDate: ReadonlyMap<string, SessionRowSummary>;
}): WeekSlot[] {
  return weekDates(input.anchor ?? input.today).map((date) => {
    const row = input.sessionsByDate.get(date);
    if (row && row.status !== 'PLANNED') {
      return { date, sessionKey: row.sessionKey, locked: true };
    }
    if (date <= input.firstProtocolDate && date < input.today) {
      return { date, sessionKey: null, locked: true };
    }
    const session = effectiveSessionForDate(date, input.structure, input.overrides);
    return { date, sessionKey: session?.dayLabel ?? null, locked: false };
  });
}

export interface SessionSelector {
  date?: string;
  sessionKey?: string;
}

export type AdjustmentRequest =
  | {
      kind: 'TRAIN_ON';
      date: string;
      /** Ausente: o treino do dia, se houver, senão o próximo pendente da semana. */
      sessionKey?: string;
      leaveOut?: SessionSelector[];
    }
  | { kind: 'REST_ON'; date: string; leaveOut?: SessionSelector[] }
  | {
      kind: 'REORGANIZE';
      /** `date = null`: a sessão fica de fora da semana. */
      placements: ReadonlyArray<{ sessionKey: string; date: string | null }>;
    };

export interface PlanInput {
  today: string;
  /**
   * Data mais antiga que o pedido pode citar (padrão: hoje). Só o registro tardio a recua: o
   * aluno treinou num dia que já passou e o calendário precisa concordar com o histórico.
   */
  earliestDate?: string;
  /** Os sete dias da semana (ver `buildWeekSlots`). */
  slots: readonly WeekSlot[];
  /** Treinos por semana contratados. */
  quota: number;
  /** Todas as chaves de sessão do protocolo vigente. */
  sessionKeys: readonly string[];
  request: AdjustmentRequest;
}

export type PlanFailure =
  | {
      ok: false;
      reason:
        | 'PAST_DATE'
        | 'OUT_OF_WEEK'
        | 'DAY_LOCKED'
        | 'UNKNOWN_SESSION'
        | 'ALREADY_DONE'
        | 'QUOTA_REACHED'
        | 'NOTHING_PENDING'
        | 'DATE_TAKEN'
        | 'DUPLICATE_DATE'
        | 'DUPLICATE_SESSION';
      date?: string;
      sessionKey?: string;
    }
  | {
      ok: false;
      reason: 'FULL_WEEK';
      /** Treinos que o aluno pode deixar de fora para o pedido caber. */
      candidates: Array<{ date: string; sessionKey: string }>;
    };

export interface PlanSuccess {
  ok: true;
  /** Nada mudou (o aluno já estava onde pediu). */
  noop: boolean;
  changes: Array<{ date: string; from: string | null; to: string | null }>;
  /** Chaves de sessão que o aluno escolheu deixar de fora da semana. */
  dropped: string[];
  slots: WeekSlot[];
}

export type PlanResult = PlanSuccess | PlanFailure;

const fail = (
  reason: Exclude<PlanFailure, { reason: 'FULL_WEEK' }>['reason'],
  extra: { date?: string; sessionKey?: string } = {},
): PlanFailure => ({ ok: false, reason, ...extra });

interface State {
  slots: WeekSlot[];
  dropped: string[];
}

function slotAt(state: State, date: string): WeekSlot | undefined {
  return state.slots.find((slot) => slot.date === date);
}

/** Sessões que ainda podem ser feitas: com chave e sem treino registrado (inclui as de dias passados sem registro). */
function pendingSlots(state: State): WeekSlot[] {
  return state.slots.filter((slot) => slot.sessionKey !== null && !slot.locked);
}

function countAssigned(state: State): number {
  return state.slots.filter((slot) => slot.sessionKey !== null).length;
}

/** Primeiro descanso livre depois de `date`, de hoje em diante. */
function freeAfter(state: State, date: string, today: string): WeekSlot | undefined {
  return state.slots.find(
    (slot) => slot.date > date && slot.date >= today && slot.sessionKey === null && !slot.locked,
  );
}

function fullWeek(state: State, from: string): PlanFailure {
  return {
    ok: false,
    reason: 'FULL_WEEK',
    candidates: pendingSlots(state)
      .filter((slot) => slot.date >= from)
      .map((slot) => ({ date: slot.date, sessionKey: slot.sessionKey as string })),
  };
}

function applyLeaveOut(state: State, selectors: readonly SessionSelector[]): PlanFailure | null {
  for (const selector of selectors) {
    const slot =
      pendingSlots(state).find(
        (candidate) =>
          (selector.date === undefined || candidate.date === selector.date) &&
          (selector.sessionKey === undefined || candidate.sessionKey === selector.sessionKey),
      ) ?? undefined;
    if (!slot) return fail('UNKNOWN_SESSION', { ...selector });
    state.dropped.push(slot.sessionKey as string);
    slot.sessionKey = null;
  }
  return null;
}

function checkWindow(input: PlanInput, date: string): PlanFailure | null {
  if (date < (input.earliestDate ?? input.today)) return fail('PAST_DATE', { date });
  const sunday = input.slots[input.slots.length - 1]?.date;
  if (!sunday || date > sunday) return fail('OUT_OF_WEEK', { date });
  return null;
}

function trainOn(
  input: PlanInput,
  state: State,
  request: Extract<AdjustmentRequest, { kind: 'TRAIN_ON' }>,
): PlanFailure | null {
  const window = checkWindow(input, request.date);
  if (window) return window;
  const leftOut = applyLeaveOut(state, request.leaveOut ?? []);
  if (leftOut) return leftOut;

  const target = slotAt(state, request.date) as WeekSlot;
  if (target.locked) return fail('DAY_LOCKED', { date: request.date });

  let key = request.sessionKey;
  let source: WeekSlot | undefined;
  if (key !== undefined) {
    if (!input.sessionKeys.includes(key)) return fail('UNKNOWN_SESSION', { sessionKey: key });
    source = pendingSlots(state).find((slot) => slot.sessionKey === key);
    if (!source) {
      if (state.slots.some((slot) => slot.locked && slot.sessionKey === key)) {
        return fail('ALREADY_DONE', { sessionKey: key });
      }
      if (countAssigned(state) >= input.quota) return fail('QUOTA_REACHED', { sessionKey: key });
    }
  } else if (target.sessionKey !== null) {
    source = target;
    key = target.sessionKey;
  } else {
    source = pendingSlots(state)[0];
    if (source) {
      key = source.sessionKey as string;
    } else {
      const missing = input.sessionKeys.find(
        (candidate) => !state.slots.some((slot) => slot.sessionKey === candidate),
      );
      if (!missing || countAssigned(state) >= input.quota) return fail('NOTHING_PENDING');
      key = missing;
    }
  }

  if (source && source.date === request.date) return null;

  const displaced = target.sessionKey;
  if (displaced !== null) {
    if (source && source.date >= input.today) {
      source.sessionKey = displaced;
    } else {
      const free = freeAfter(state, request.date, input.today);
      if (!free) return fullWeek(state, input.today);
      free.sessionKey = displaced;
      if (source) source.sessionKey = null;
    }
  } else if (source) {
    source.sessionKey = null;
  }
  target.sessionKey = key as string;
  return null;
}

function restOn(
  input: PlanInput,
  state: State,
  request: Extract<AdjustmentRequest, { kind: 'REST_ON' }>,
): PlanFailure | null {
  const window = checkWindow(input, request.date);
  if (window) return window;
  const leftOut = applyLeaveOut(state, request.leaveOut ?? []);
  if (leftOut) return leftOut;

  const target = slotAt(state, request.date) as WeekSlot;
  if (target.locked) return fail('DAY_LOCKED', { date: request.date });
  if (target.sessionKey === null) return null;

  const free = freeAfter(state, request.date, input.today);
  if (!free) return fullWeek(state, request.date);
  const from = state.slots.indexOf(target);
  for (let index = state.slots.indexOf(free); index > from; index -= 1) {
    (state.slots[index] as WeekSlot).sessionKey = (state.slots[index - 1] as WeekSlot).sessionKey;
  }
  target.sessionKey = null;
  return null;
}

function reorganize(
  input: PlanInput,
  state: State,
  request: Extract<AdjustmentRequest, { kind: 'REORGANIZE' }>,
): PlanFailure | null {
  // Cada sessão entra tantas vezes quantas ela tem na semana (uma; protocolos antigos repetem a
  // letra), ou uma vez se foi deixada de fora e volta. Repetir a mesma sessão trocaria a
  // distribuição prescrita pelo profissional.
  const placed = new Map<string, number>();
  for (const placement of request.placements) {
    if (placement.date === null) continue;
    const count = (placed.get(placement.sessionKey) ?? 0) + 1;
    placed.set(placement.sessionKey, count);
    const allowed = Math.max(
      1,
      pendingSlots(state).filter((slot) => slot.sessionKey === placement.sessionKey).length,
    );
    if (count > allowed) return fail('DUPLICATE_SESSION', { sessionKey: placement.sessionKey });
  }
  const usedDates = new Set<string>();
  const sources: Array<{
    placement: (typeof request.placements)[number];
    slot: WeekSlot | undefined;
  }> = [];
  const taken = new Set<WeekSlot>();
  for (const placement of request.placements) {
    if (!input.sessionKeys.includes(placement.sessionKey)) {
      return fail('UNKNOWN_SESSION', { sessionKey: placement.sessionKey });
    }
    if (placement.date !== null) {
      const window = checkWindow(input, placement.date);
      if (window) return window;
      if (usedDates.has(placement.date)) return fail('DUPLICATE_DATE', { date: placement.date });
      usedDates.add(placement.date);
    }
    const slot = pendingSlots(state).find(
      (candidate) => candidate.sessionKey === placement.sessionKey && !taken.has(candidate),
    );
    if (
      !slot &&
      state.slots.some(
        (candidate) => candidate.locked && candidate.sessionKey === placement.sessionKey,
      )
    ) {
      return fail('ALREADY_DONE', { sessionKey: placement.sessionKey });
    }
    if (slot) taken.add(slot);
    sources.push({ placement, slot });
  }

  for (const { slot } of sources) if (slot) slot.sessionKey = null;
  for (const { placement } of sources) {
    if (placement.date === null) {
      state.dropped.push(placement.sessionKey);
      continue;
    }
    const target = slotAt(state, placement.date) as WeekSlot;
    if (target.locked) return fail('DAY_LOCKED', { date: placement.date });
    if (target.sessionKey !== null) {
      return fail('DATE_TAKEN', { date: placement.date, sessionKey: target.sessionKey });
    }
    target.sessionKey = placement.sessionKey;
  }
  if (countAssigned(state) > input.quota) return fail('QUOTA_REACHED');
  return null;
}

export function planScheduleChange(input: PlanInput): PlanResult {
  const state: State = {
    slots: input.slots.map((slot) => ({ ...slot })),
    dropped: [],
  };
  const request = input.request;
  const failure =
    request.kind === 'TRAIN_ON'
      ? trainOn(input, state, request)
      : request.kind === 'REST_ON'
        ? restOn(input, state, request)
        : reorganize(input, state, request);
  if (failure) return failure;

  const changes = state.slots.flatMap((slot, index) => {
    const before = input.slots[index] as WeekSlot;
    return before.sessionKey === slot.sessionKey
      ? []
      : [{ date: slot.date, from: before.sessionKey, to: slot.sessionKey }];
  });
  return {
    ok: true,
    noop: changes.length === 0,
    changes,
    dropped: state.dropped,
    slots: state.slots,
  };
}

export interface PlannedDay {
  readonly completedAt: string;
  readonly sessionKey: string;
}

/**
 * Dias de treino previstos nos `days` dias que antecedem `reference` (exclusive), do mais antigo
 * ao mais recente, pelo calendário efetivo (padrão + ajustes do aluno). É o que o fallback do
 * check-in semanal usa para atribuir as conclusões ao dia previsto, nunca ao da resposta.
 */
export function plannedDaysBeforeEffective(
  reference: Date,
  days: number,
  structure: ProtocolStructure,
  overrides?: ScheduleOverrides,
): PlannedDay[] {
  const planned: PlannedDay[] = [];
  for (let back = days; back >= 1; back -= 1) {
    const completedAt = dayKey(new Date(reference.getTime() - back * DAY_MS));
    const session = effectiveSessionForDate(completedAt, structure, overrides);
    if (session) planned.push({ completedAt, sessionKey: session.dayLabel });
  }
  return planned;
}
