/**
 * Regras determinísticas da sentinela de segurança.
 *
 * Transformam fatos estruturados (relato de dor, PAR-Q, sinal detectado em texto livre) em
 * `SafetySignal` com gravidade e escopo. A gravidade e o escopo de cada tipo de sinal vêm do
 * documento SAFETY publicado; enquanto não houver, valem os padrões conservadores abaixo.
 * O detector sobre texto livre (LLM) só ACRESCENTA tipos de sinal — nunca remove nem rebaixa.
 */
import type {
  PainReport,
  SafetyScope,
  SafetySeverity,
  SafetySignal,
  SafetySignalKind,
} from '@movivo/shared';

export interface SentinelParams {
  pain: { stopExerciseAt: number; escalateAt: number; persistentDays: number };
  bySignal: Partial<Record<SafetySignalKind, { severity: SafetySeverity; scope: SafetyScope }>>;
}

/** Padrões conservadores (sem documento SAFETY publicado). */
export const DEFAULT_SIGNAL_RULES: Readonly<
  Record<SafetySignalKind, { severity: SafetySeverity; scope: SafetyScope }>
> = {
  CHEST_PAIN: { severity: 'EMERGENCY', scope: 'ALL' },
  FAINTING_OR_DIZZINESS: { severity: 'EMERGENCY', scope: 'ALL' },
  SHORTNESS_OF_BREATH: { severity: 'EMERGENCY', scope: 'ALL' },
  SEVERE_PAIN: { severity: 'URGENT', scope: 'TRAINING' },
  NEW_INJURY: { severity: 'URGENT', scope: 'TRAINING' },
  PARQ_POSITIVE: { severity: 'URGENT', scope: 'ALL' },
  PREGNANCY: { severity: 'URGENT', scope: 'ALL' },
  RECENT_SURGERY: { severity: 'URGENT', scope: 'TRAINING' },
  EATING_DISORDER_SIGNS: { severity: 'URGENT', scope: 'ALL' },
  MENTAL_DISTRESS: { severity: 'URGENT', scope: 'ALL' },
  PERSISTENT_PAIN: { severity: 'ATTENTION', scope: 'TRAINING' },
  MEDICATION_CHANGE: { severity: 'ATTENTION', scope: 'ALL' },
  RAPID_WEIGHT_CHANGE: { severity: 'ATTENTION', scope: 'NUTRITION' },
  OTHER: { severity: 'ATTENTION', scope: 'ALL' },
};

export const DEFAULT_PAIN_RULES: SentinelParams['pain'] = {
  stopExerciseAt: 5,
  escalateAt: 7,
  persistentDays: 7,
};

const SEVERITY_RANK: Readonly<Record<SafetySeverity, number>> = {
  ATTENTION: 1,
  URGENT: 2,
  EMERGENCY: 3,
};

/** Gravidade e escopo de um tipo de sinal. A tabela publicada nunca rebaixa uma EMERGÊNCIA. */
export function ruleFor(
  kind: SafetySignalKind,
  params: SentinelParams | null,
): { severity: SafetySeverity; scope: SafetyScope } {
  const fallback = DEFAULT_SIGNAL_RULES[kind];
  const configured = params?.bySignal[kind];
  if (!configured) return fallback;
  if (fallback.severity === 'EMERGENCY' && configured.severity !== 'EMERGENCY') return fallback;
  return configured;
}

export function signalOf(
  kind: SafetySignalKind,
  evidence: string,
  params: SentinelParams | null,
): SafetySignal {
  return { kind, ...ruleFor(kind, params), evidence: evidence.slice(0, 400) };
}

export interface PainHistoryEntry {
  region: string;
  /** Dia civil (`YYYY-MM-DD`) do relato. */
  day: string;
}

/**
 * Sinais a partir dos relatos de dor de uma sessão, considerando o histórico da mesma região.
 * Dor ≥ `escalateAt` → dor forte; mesma região relatada em dias distintos cobrindo
 * `persistentDays` → dor persistente.
 */
export function painSignals(
  reports: readonly PainReport[],
  history: readonly PainHistoryEntry[],
  today: string,
  params: SentinelParams | null,
): SafetySignal[] {
  const rules = params?.pain ?? DEFAULT_PAIN_RULES;
  const signals: SafetySignal[] = [];
  for (const report of reports) {
    if (report.intensity >= rules.escalateAt) {
      signals.push(
        signalOf(
          'SEVERE_PAIN',
          `dor ${report.intensity}/10 em ${report.region} (${report.during})`,
          params,
        ),
      );
      continue;
    }
    if (report.intensity < rules.stopExerciseAt) continue;
    const days = new Set(
      history
        .filter((h) => h.region === report.region)
        .map((h) => h.day)
        .concat(today),
    );
    const sorted = [...days].sort();
    const spanDays =
      (Date.parse(`${sorted.at(-1)}T00:00:00Z`) - Date.parse(`${sorted[0]}T00:00:00Z`)) /
        86_400_000 +
      1;
    if (days.size >= 2 && spanDays >= rules.persistentDays) {
      signals.push(
        signalOf(
          'PERSISTENT_PAIN',
          `dor em ${report.region} relatada em ${days.size} dias ao longo de ${spanDays} dias`,
          params,
        ),
      );
    }
  }
  return dedupeByKind(signals);
}

/** Um sinal por tipo, ficando o mais grave. */
export function dedupeByKind(signals: readonly SafetySignal[]): SafetySignal[] {
  const byKind = new Map<SafetySignalKind, SafetySignal>();
  for (const signal of signals) {
    const current = byKind.get(signal.kind);
    if (!current || SEVERITY_RANK[signal.severity] > SEVERITY_RANK[current.severity]) {
      byKind.set(signal.kind, signal);
    }
  }
  return [...byKind.values()];
}

/** Converte os parâmetros publicados do documento SAFETY. */
export function sentinelParamsFrom(
  parameters: Record<string, Record<string, unknown>>,
): SentinelParams {
  const pain = (parameters.pain ?? {}) as Partial<SentinelParams['pain']>;
  return {
    pain: { ...DEFAULT_PAIN_RULES, ...pain },
    bySignal: (parameters.signals?.bySignal ?? {}) as SentinelParams['bySignal'],
  };
}
