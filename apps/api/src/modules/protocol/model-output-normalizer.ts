/**
 * Normalização determinística da saída do LLM ANTES do parse estrito do schema.
 *
 * Achado 2026-10-14 (produção, 6 reexecuções do perfil 7 dias/30 min/LOSE_FAT, 4 caíram em
 * `FALLBACK_TEMPLATE`): o parse rejeitava o protocolo INTEIRO por falhas de FORMA que não
 * exigem julgamento clínico nenhum e que o código já resolve (ou pode resolver) sozinho:
 *  - `promptVersion` ausente — campo NOSSO, injetado depois do parse; a rodada de correção
 *    ainda mostra ao modelo o JSON sem ele (`previousAsModelOutput`), então o modelo imitava;
 *  - `sets` ausente em exercício de duração (cardio no fim da sessão, pedido pelo prompt de
 *    LOSE_FAT) — cardio contínuo é 1 série de tempo corrido;
 *  - texto livre acima do limite do schema (`focus` da 7ª sessão com mais de 120 caracteres).
 *
 * O que NÃO entra aqui, de propósito: qualquer coisa que mude o treino (exercício, séries
 * de musculação, repetições, descanso, fase). Isso continua passando pelo validador.
 */

/** Valor provisório: sobrescrito por `promptVersion` real logo após o parse. */
export const MODEL_OUTPUT_PROMPT_VERSION_PLACEHOLDER = 'model-output';

/** Espelham os `.max()` de `protocol.schema.ts` (`@movivo/shared`). */
const TEXT_LIMITS = {
  dayLabel: 60,
  focus: 120,
  name: 120,
  notes: 400,
  generalNotes: 1000,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clamp(value: unknown, max: number): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max).trimEnd() : value;
}

function normalizeExercise(exercise: unknown): unknown {
  if (!isRecord(exercise)) return exercise;
  const next: Record<string, unknown> = {
    ...exercise,
    name: clamp(exercise.name, TEXT_LIMITS.name),
  };
  if ('notes' in exercise) next.notes = clamp(exercise.notes, TEXT_LIMITS.notes);
  // Só exercício de DURAÇÃO: `sets` ausente em exercício de repetições segue inválido.
  if (exercise.sets === undefined && typeof exercise.durationSeconds === 'number') {
    next.sets = 1;
  }
  return next;
}

function normalizeSession(session: unknown): unknown {
  if (!isRecord(session)) return session;
  return {
    ...session,
    dayLabel: clamp(session.dayLabel, TEXT_LIMITS.dayLabel),
    focus: clamp(session.focus, TEXT_LIMITS.focus),
    ...(Array.isArray(session.exercises)
      ? { exercises: session.exercises.map(normalizeExercise) }
      : {}),
  };
}

export function normalizeModelOutput(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const promptVersion =
    typeof raw.promptVersion === 'string' && raw.promptVersion.trim()
      ? raw.promptVersion
      : MODEL_OUTPUT_PROMPT_VERSION_PLACEHOLDER;
  return {
    ...raw,
    promptVersion,
    ...(Array.isArray(raw.sessions) ? { sessions: raw.sessions.map(normalizeSession) } : {}),
    ...('generalNotes' in raw
      ? { generalNotes: clamp(raw.generalNotes, TEXT_LIMITS.generalNotes) }
      : {}),
  };
}
