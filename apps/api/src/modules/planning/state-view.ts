/**
 * Visão tipada do Estado do Aluno para o planejamento.
 *
 * O `StudentStateReader` devolve fatias genéricas (JSON compacto para o prompt). Aqui elas viram
 * uma estrutura com tipo, lida de forma defensiva: dado ausente vira `null`/vazio e o
 * planejador decide se dá para seguir ou se abre um caso para a equipe.
 */
import type {
  AvailabilityWindow,
  DeclaredGoal,
  ExternalSportPractice,
  LifeContext,
  MealSlot,
  ModalityExperience,
  TrainingVenue,
} from '@movivo/shared';

export interface PreferenceRow {
  domain: string;
  key: string;
  value: string | number;
  strength: string;
}

export interface ExecutionRow {
  performedOn: string;
  modality: string;
  status: string;
  load: number | null;
}

export interface StateView {
  identity: {
    ageYears: number | null;
    biologicalSex: 'MALE' | 'FEMALE' | null;
    heightCm: number | null;
    lifeContext: LifeContext | null;
  };
  goal: { goalId: string; declared: DeclaredGoal } | null;
  availability: {
    windows: AvailabilityWindow[];
    variesWeekly: boolean;
    /** Sessões próprias (da MOVIVO) por semana, sem o esporte externo. */
    maxSessionsPerWeek: number;
  } | null;
  dietaryRestrictions: string[];
  preferences: PreferenceRow[];
  training: {
    modalities: ModalityExperience[];
    externalSports: ExternalSportPractice[];
    venues: TrainingVenue[];
    executions: ExecutionRow[];
  };
  body: Record<string, { latest: number; on: string }>;
  /** Leitura visual por foto (faixa de gordura corporal em %), quando o aluno enviou fotos. */
  bodyComposition: {
    assessedOn: string;
    bodyFatRange: { min: number; max: number } | null;
    confidence: string;
    comparison: string | null;
    observations: string[];
    /** Grupos musculares lidos na foto: pontos fortes e a desenvolver. */
    muscleGroups: { region: string; status: string; note: string }[];
    /** Alterações de alinhamento observadas (só as visíveis); para o profissional confirmar. */
    posture: { region: string; finding: string; degree: string }[];
    symmetry: string | null;
    strengths: string[];
    attentionPoints: string[];
  } | null;
  safety: {
    signals: { kind: string; severity: string; scope: string }[];
    records: { kind: string; summary: string; movementTags?: string[] }[];
  };
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function bodyCompositionOf(raw: unknown): StateView['bodyComposition'] {
  const slice = record(raw);
  const range = record(slice.bodyFatRangePercent);
  const min = num(range.min);
  const max = num(range.max);
  if (typeof slice.assessedOn !== 'string') return null;
  return {
    assessedOn: slice.assessedOn,
    bodyFatRange: min !== null && max !== null ? { min, max } : null,
    confidence: typeof slice.confidence === 'string' ? slice.confidence : 'LOW',
    comparison:
      typeof slice.comparisonWithPrevious === 'string' ? slice.comparisonWithPrevious : null,
    observations: list<string>(slice.observations).filter((o) => typeof o === 'string'),
    muscleGroups: list<{ region: string; status: string; note: string }>(slice.muscleGroups),
    posture: list<{ region: string; finding: string; degree: string }>(slice.posture),
    symmetry: typeof slice.symmetry === 'string' ? slice.symmetry : null,
    strengths: list<string>(slice.strengths).filter((o) => typeof o === 'string'),
    attentionPoints: list<string>(slice.attentionPoints).filter((o) => typeof o === 'string'),
  };
}

export function parseStateView(slices: Record<string, unknown>): StateView {
  const identity = record(slices.identity);
  const goals = record(slices.goals);
  const constraints = list<Record<string, unknown>>(slices.availability);
  const availability = constraints.find((c) => c.kind === 'AVAILABILITY');
  const restrictions = list<Record<string, unknown>>(slices.restrictions);
  const training = record(slices.training);
  const safety = record(slices.safety);
  const sex = identity.biologicalSex;

  return {
    identity: {
      ageYears: num(identity.ageYears),
      biologicalSex: sex === 'MALE' || sex === 'FEMALE' ? sex : null,
      heightCm: num(identity.heightCm),
      lifeContext: (identity.lifeContext as LifeContext | null) ?? null,
    },
    goal:
      typeof goals.goalId === 'string' && goals.declared
        ? { goalId: goals.goalId, declared: goals.declared as DeclaredGoal }
        : null,
    availability: availability
      ? {
          windows: list<AvailabilityWindow>(availability.windows),
          variesWeekly: availability.variesWeekly === true,
          maxSessionsPerWeek: num(availability.maxSessionsPerWeek) ?? 3,
        }
      : null,
    dietaryRestrictions: restrictions
      .filter((c) => c.kind === 'DIETARY_RESTRICTION' && typeof c.restriction === 'string')
      .map((c) => c.restriction as string),
    preferences: list<PreferenceRow>(slices.preferences),
    training: {
      modalities: list<ModalityExperience>(training.modalities),
      externalSports: list<ExternalSportPractice>(training.externalSports),
      venues: list<TrainingVenue>(training.venues),
      executions: list<ExecutionRow>(training.last21Days),
    },
    body: Object.fromEntries(
      Object.entries(record(slices.body)).flatMap(([kind, entry]) => {
        const latest = num(record(entry).latest);
        return latest === null ? [] : [[kind, { latest, on: String(record(entry).on ?? '') }]];
      }),
    ),
    bodyComposition: bodyCompositionOf(slices.bodyComposition),
    safety: {
      signals: list(safety.activeSignals),
      records: list(safety.healthRecords),
    },
  };
}

/** Preferência declarada de um domínio/chave (ex.: `FOOD`/`meals_per_day`). */
export function preferenceOf(view: StateView, domain: string, key: string) {
  return view.preferences.find((p) => p.domain === domain && p.key === key)?.value;
}

export function usualMealsOf(view: StateView): MealSlot[] {
  const raw = preferenceOf(view, 'FOOD', 'usual_meals');
  return typeof raw === 'string' && raw.length > 0 ? (raw.split(',') as MealSlot[]) : [];
}
