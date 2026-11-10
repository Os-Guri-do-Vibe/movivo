/**
 * Tradução do protocolo (treino e alimentar) para leitura rápida na revisão: dias da semana,
 * turnos, tipos de sessão, trechos de corrida, estações HYROX, técnicas, estratégias de carga,
 * grupos musculares, equipamento e unidades. Nada de enum cru ou SNAKE_CASE na tela: o que não
 * tiver rótulo conhecido vira frase legível (`humanizeCode`). Nada aqui decide.
 */
import {
  EXTERNAL_SPORT_LABELS,
  HYROX_STATION_LABELS,
  MEAL_SLOT_LABELS,
  MESOCYCLE_LABELS,
  runningSessionLabel,
  SESSION_MODALITY_LABELS,
  SESSION_PRIORITY_LABELS,
  type DailyTargets,
  type DaySlot,
  type EnduranceTarget,
  type HyroxBlock,
  type MealSlot,
  type PlanSession,
  type ProtocolWeekPreview,
  type RunningSegment,
  type SessionModality,
  type StrengthExercise,
  type TrainingPlanStructure,
} from '@movivo/shared';

/* -------------------------------------------------------------------------- */
/* Texto                                                                      */
/* -------------------------------------------------------------------------- */

/** Primeira letra maiúscula ("costas" → "Costas"), sem mexer no resto. */
export function capitalize(text: string): string {
  const trimmed = text.trim();
  return trimmed.charAt(0).toLocaleUpperCase('pt-BR') + trimmed.slice(1);
}

/** Código sem rótulo conhecido ("SLED_PUSH") → texto legível ("Sled push"); texto comum passa. */
export function humanizeCode(value: string): string {
  if (!/^[A-Z][A-Z0-9_]*$/.test(value)) return value;
  return capitalize(value.toLocaleLowerCase('pt-BR').replace(/_+/g, ' '));
}

function label<T extends string>(map: Readonly<Partial<Record<T, string>>>, value: T): string {
  return map[value] ?? humanizeCode(value);
}

/** Busca sem acento e sem caixa ("Glúteo" casa com "gluteo"). */
export function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .trim();
}

/* -------------------------------------------------------------------------- */
/* Números e unidades                                                         */
/* -------------------------------------------------------------------------- */

const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

/** Duração curta: "45 s", "1 min 30 s", "2 min", "1 h 10 min". */
export function durationLabel(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds} s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return `${hours} h${minutes ? ` ${minutes} min` : ''}`;
  return `${minutes} min${rest ? ` ${rest} s` : ''}`;
}

/** Descanso entre séries; zero vira texto, não "0 s". */
export function restLabel(seconds: number): string {
  return seconds === 0 ? 'Sem pausa' : durationLabel(seconds);
}

/** Distância: "800 m", "5 km", "1,5 km". */
export function distanceLabel(meters: number): string {
  return meters < 1000 ? `${meters} m` : `${decimal.format(meters / 1000)} km`;
}

/** Ritmo em segundos por km → "5:30". */
export function paceLabel(secondsPerKm: number): string {
  const total = Math.round(secondsPerKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function range(min: number | string, max: number | string, unit = ''): string {
  return min === max ? `${min}${unit}` : `${min}–${max}${unit}`;
}

/** Alvo de intensidade de um trecho de endurance. */
export function targetLabel(target: EnduranceTarget): string {
  switch (target.by) {
    case 'ZONE':
      return `Zona ${target.zone.slice(1)}`;
    case 'PACE':
      return `${range(paceLabel(target.secondsPerKm.min), paceLabel(target.secondsPerKm.max))}/km`;
    case 'HEART_RATE':
      return `${range(target.bpm.min, target.bpm.max)} bpm`;
    case 'RPE':
      return `PSE ${range(target.rpe.min, target.rpe.max)}`;
  }
}

/** Vezes por semana: "1×/semana", "3×/semana". */
export function frequencyLabel(times: number): string {
  return `${times}×/semana`;
}

/* -------------------------------------------------------------------------- */
/* Agenda                                                                     */
/* -------------------------------------------------------------------------- */

/** Domingo = 0, como `Date.getUTCDay()`. */
export const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;
export const WEEKDAY_LONG = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
] as const;

export const SLOT_LABEL: Readonly<Record<DaySlot, string | null>> = {
  MORNING: 'manhã',
  AFTERNOON: 'tarde',
  EVENING: 'noite',
  ANY: null,
};

function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function addDays(iso: string, days: number): string {
  const date = utcDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** "04/11". */
export function dayMonth(iso: string): string {
  const date = utcDate(iso);
  return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** "04/11/2026". */
export function shortDate(iso: string): string {
  return `${dayMonth(iso)}/${iso.slice(0, 4)}`;
}

/**
 * Mesociclo(s) do plano: "Hipertrofia"; em planos antigos ou de corrida sem mesociclo, o nome da
 * fase. Várias fases ficam em sequência ("Adaptação → Hipertrofia").
 */
export function mesocycleLabel(phases: TrainingPlanStructure['phases']): string {
  return phases
    .map((phase) => (phase.mesocycle ? MESOCYCLE_LABELS[phase.mesocycle] : phase.name))
    .join(' → ');
}

/** Fim do protocolo: o início somado às semanas de todas as fases (06/11 + 5 semanas = 11/12). */
export function protocolEnd(startsOn: string, phases: TrainingPlanStructure['phases']): string {
  return addDays(startsOn, 7 * phases.reduce((total, phase) => total + phase.weeks, 0));
}

export interface WeekDayEntry {
  title: string;
  sessionKey: string;
  modality: SessionModality;
  /** "noite"; `null` quando qualquer horário serve. */
  slot: string | null;
}

export interface WeekDay {
  date: string;
  /** "Seg". */
  short: string;
  /** "segunda-feira". */
  long: string;
  /** "04/11". */
  dayMonth: string;
  /** Dia antes do início do protocolo (a primeira semana começa no meio). */
  beforeStart: boolean;
  sessions: WeekDayEntry[];
}

/** A primeira semana simulada, de segunda a domingo, com as sessões e os dias de descanso. */
export function weekDays(preview: ProtocolWeekPreview): WeekDay[] {
  return Array.from({ length: 7 }, (_, offset) => {
    const date = addDays(preview.weekStart, offset);
    const weekday = utcDate(date).getUTCDay();
    return {
      date,
      short: WEEKDAY_SHORT[weekday] ?? '',
      long: WEEKDAY_LONG[weekday] ?? '',
      dayMonth: dayMonth(date),
      beforeStart: date < preview.startsOn,
      sessions: preview.sessions
        .filter((session) => session.date === date)
        .map((session) => ({
          title: session.title,
          sessionKey: session.sessionKey,
          modality: session.modality,
          slot: SLOT_LABEL[session.slot],
        })),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Sessões                                                                    */
/* -------------------------------------------------------------------------- */

export const MODALITY_LABEL = SESSION_MODALITY_LABELS;
export const PRIORITY_LABEL = SESSION_PRIORITY_LABELS;

export const LOAD_STRATEGY_LABEL: Readonly<Record<StrengthExercise['loadStrategy'], string>> = {
  BODYWEIGHT: 'Peso do corpo',
  FIXED_LOAD: 'Carga fixa',
  DOUBLE_PROGRESSION: 'Dupla progressão',
  RIR: 'Por reserva (RIR)',
};

export const TECHNIQUE_LABEL: Readonly<Record<NonNullable<StrengthExercise['technique']>, string>> =
  {
    DROP_SET: 'Drop set',
    REST_PAUSE: 'Rest-pause',
    CLUSTER_SET: 'Cluster set',
    SUPERSET: 'Bi-set',
    ISOMETRIC_HOLD: 'Isometria',
    CONTROLLED_TEMPO: 'Cadência controlada',
    PYRAMID: 'Pirâmide',
  };

export const SEGMENT_LABEL: Readonly<Record<RunningSegment['type'], string>> = {
  WARMUP: 'Aquecimento',
  STEADY: 'Contínuo',
  WORK: 'Estímulo',
  RECOVERY: 'Recuperação',
  STRIDES: 'Acelerações',
  COOLDOWN: 'Desaquecimento',
};

const TERRAIN_LABEL: Readonly<Record<string, string | null>> = {
  ANY: null,
  FLAT: 'terreno plano',
  HILLS: 'com subidas',
  TRACK: 'pista',
  TREADMILL: 'esteira',
  TRAIL: 'trilha',
  SAND: 'areia',
};

const HYROX_KIND_LABEL: Readonly<Record<string, string>> = {
  STATION_SKILL: 'Técnica das estações',
  STATION_STRENGTH: 'Força para as estações',
  COMPROMISED_RUNNING: 'Corrida comprometida',
  ENGINE: 'Condicionamento',
  SIMULATION: 'Simulado',
};

/** Letra da sessão na ordem do plano (A, B, C…); depois de Z, número. */
export function sessionLetter(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
}

/** O tipo da sessão numa linha: "Musculação · Corpo inteiro", "Corrida · Rodagem leve". */
export function sessionTypeLabel(session: PlanSession): string {
  const { content } = session;
  const modality = label(MODALITY_LABEL, content.modality);
  switch (content.modality) {
    case 'STRENGTH':
      return `${modality} · ${content.focus}`;
    case 'RUNNING': {
      const terrain = TERRAIN_LABEL[content.terrain ?? 'ANY'];
      return `${modality} · ${runningSessionLabel(content)}${terrain ? `, ${terrain}` : ''}`;
    }
    case 'HYROX':
      return `${modality} · ${HYROX_KIND_LABEL[content.kind] ?? humanizeCode(content.kind)}${content.rounds > 1 ? ` · ${content.rounds} voltas` : ''}`;
    case 'EXTERNAL_SPORT':
      return `${label(EXTERNAL_SPORT_LABELS, content.sport)} · ${content.label}`;
  }
}

/** Metadados da sessão, na ordem fixa do cabeçalho do cartão. */
export function sessionMeta(session: PlanSession): string {
  return [
    frequencyLabel(session.weeklyFrequency),
    `${session.estimatedMinutes} min`,
    `PSE ${decimal.format(session.estimatedRpe)}`,
  ].join(' · ');
}

/** Repetições ou tempo da série: "8–10", "12", "45 s". */
export function repsLabel(exercise: Pick<StrengthExercise, 'reps' | 'durationSeconds'>): string {
  if (exercise.durationSeconds !== undefined) return durationLabel(exercise.durationSeconds);
  return exercise.reps ? range(exercise.reps.min, exercise.reps.max) : '—';
}

/** Carga: a reserva quando há ("RIR 2"), senão a estratégia ("Carga fixa"). */
export function loadLabel(exercise: Pick<StrengthExercise, 'rir' | 'loadStrategy'>): string {
  if (exercise.rir !== undefined) return `RIR ${exercise.rir}`;
  return LOAD_STRATEGY_LABEL[exercise.loadStrategy];
}

/** Uma linha do exercício para leitores de tela e telas estreitas: "3 × 8–10 · descanso 90 s · RIR 2". */
export function exerciseLine(exercise: StrengthExercise): string {
  return [
    `${exercise.sets} × ${repsLabel(exercise)}`,
    `descanso ${restLabel(exercise.restSeconds).toLocaleLowerCase('pt-BR')}`,
    loadLabel(exercise),
  ].join(' · ');
}

/** Detalhes extras do exercício (técnica, aquecimento, bi-set), em ordem fixa. */
export function exerciseExtras(exercise: StrengthExercise): string[] {
  const extras: string[] = [];
  if (exercise.technique) extras.push(TECHNIQUE_LABEL[exercise.technique]);
  if (exercise.group) extras.push(`Grupo ${exercise.group}`);
  if (exercise.warmup?.length) {
    extras.push(
      `Aquecimento: ${exercise.warmup.map((block) => `${block.sets} × ${repsLabel(block)}`).join(', ')}`,
    );
  }
  return extras;
}

export interface SegmentRow {
  label: string;
  volume: string;
  target: string;
  notes?: string;
}

export function segmentRow(segment: RunningSegment): SegmentRow {
  const amount =
    segment.distanceMeters !== undefined
      ? distanceLabel(segment.distanceMeters)
      : durationLabel(segment.durationSeconds ?? 0);
  return {
    label: SEGMENT_LABEL[segment.type] ?? humanizeCode(segment.type),
    volume: segment.repeat && segment.repeat > 1 ? `${segment.repeat} × ${amount}` : amount,
    target: targetLabel(segment.target),
    notes: segment.notes,
  };
}

export function hyroxRow(block: HyroxBlock): SegmentRow {
  if (block.type === 'RUN') {
    return {
      label: 'Corrida',
      volume: distanceLabel(block.distanceMeters),
      target: targetLabel(block.target),
    };
  }
  if (block.type === 'REST') {
    return { label: 'Pausa', volume: durationLabel(block.durationSeconds), target: '—' };
  }
  const volume =
    block.distanceMeters !== undefined
      ? distanceLabel(block.distanceMeters)
      : block.reps !== undefined
        ? `${block.reps} rep.`
        : durationLabel(block.durationSeconds ?? 0);
  return {
    label: label(HYROX_STATION_LABELS, block.station),
    volume: block.loadKg !== undefined ? `${volume} · ${decimal.format(block.loadKg)} kg` : volume,
    target: block.target ? targetLabel(block.target) : '—',
  };
}

/** Resumo do plano no cabeçalho: sessões por semana e duração total das fases. */
export function planOverview(structure: TrainingPlanStructure): string {
  const perWeek = structure.sessions.reduce((sum, s) => sum + s.weeklyFrequency, 0);
  const weeks = structure.phases.reduce((sum, p) => sum + p.weeks, 0);
  return [
    `${perWeek} ${perWeek === 1 ? 'sessão' : 'sessões'} por semana`,
    `${structure.phases.length} ${structure.phases.length === 1 ? 'fase' : 'fases'}`,
    `${weeks} ${weeks === 1 ? 'semana' : 'semanas'}`,
  ].join(' · ');
}

/* -------------------------------------------------------------------------- */
/* Catálogo                                                                   */
/* -------------------------------------------------------------------------- */

/** Equipamento do catálogo para leitura ("[]" é peso do corpo). */
export function equipmentLabel(equipment: readonly string[] | undefined): string {
  return equipment && equipment.length > 0 ? equipment.map(capitalize).join(', ') : 'Peso do corpo';
}

export function muscleLabel(muscles: readonly string[] | undefined): string {
  return muscles && muscles.length > 0 ? muscles.map(capitalize).join(', ') : '—';
}

/* -------------------------------------------------------------------------- */
/* Alimentação                                                                */
/* -------------------------------------------------------------------------- */

export function mealLabel(slot: MealSlot): string {
  return label(MEAL_SLOT_LABELS, slot);
}

const ENERGY_STRATEGY_LABEL: Readonly<Record<string, string>> = {
  DEFICIT: 'Déficit calórico',
  MAINTENANCE: 'Manutenção',
  SURPLUS: 'Superávit calórico',
  RECOMPOSITION: 'Recomposição corporal',
  PERFORMANCE_FUELING: 'Calorias para o desempenho',
};

export function energyStrategyLabel(strategy: string): string {
  return ENERGY_STRATEGY_LABEL[strategy] ?? humanizeCode(strategy);
}

export interface TargetCell {
  label: string;
  value: string;
}

/** Metas do dia em células de mesma ordem (a grade fica simétrica entre treino e descanso). */
export function targetCells(targets: DailyTargets): TargetCell[] {
  return [
    { label: 'Caloria', value: `${range(targets.energyKcal.min, targets.energyKcal.max)} kcal` },
    { label: 'Proteína', value: `${targets.proteinG} g` },
    { label: 'Carboidrato', value: `${targets.carbsG} g` },
    { label: 'Gordura', value: `${targets.fatG} g` },
    { label: 'Fibras', value: `${targets.fiberG} g` },
    { label: 'Água', value: `${decimal.format(targets.waterMl / 1000)} L` },
  ];
}

export function percentLabel(share: number): string {
  return `${Math.round(share * 100)}%`;
}
