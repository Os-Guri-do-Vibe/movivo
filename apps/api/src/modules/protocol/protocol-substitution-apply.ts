/**
 * Aplicação pura da troca de exercício ao conteúdo do protocolo (achado 2026-09-02).
 *
 * Sem I/O, sem chamada a LLM — só transforma `ProtocolStructure`. Quem chama SEMPRE revalida
 * o resultado inteiro via `ValidationService.validate()` antes de persistir: trocar um
 * exercício pode, em tese, quebrar uma regra de sessão (ex.: um isolado virar base) mesmo
 * quando o substituto em si é seguro — esta função não tem esse julgamento, só aplica.
 */
import type { ProtocolExercise, ProtocolStructure } from '@movivo/shared';

import type { CatalogExercise } from './exercise-catalog';

/** Exercícios distintos do protocolo (por `exerciseId`), na ordem em que aparecem. */
export interface ProtocolExerciseRef {
  readonly id: string;
  readonly name: string;
}

export function collectProtocolExercises(content: ProtocolStructure): ProtocolExerciseRef[] {
  const seen = new Map<string, ProtocolExerciseRef>();
  for (const session of content.sessions) {
    for (const ex of session.exercises) {
      if (!seen.has(ex.exerciseId)) seen.set(ex.exerciseId, { id: ex.exerciseId, name: ex.name });
    }
  }
  return [...seen.values()];
}

/** Default conservador quando a troca muda o tipo de medida (raro: mesmo `pattern` costuma
 * significar mesma medida) — a revalidação da estrutura inteira barra qualquer valor ruim. */
const FALLBACK_DURATION_SECONDS = 30;
const FALLBACK_REPS = { min: 10, max: 15 };

/** Ajusta um exercício da sessão para o substituto — preserva volume/descanso/RIR/técnica. */
function withSubstitutedExercise(ex: ProtocolExercise, to: CatalogExercise): ProtocolExercise {
  const next: ProtocolExercise = { ...ex, exerciseId: to.id, name: to.name };
  if (to.measurement === 'DURATION') {
    if (ex.durationSeconds === undefined) {
      next.durationSeconds = FALLBACK_DURATION_SECONDS;
      next.reps = undefined;
      next.warmupBlocks = undefined;
    }
  } else if (ex.reps === undefined) {
    next.reps = FALLBACK_REPS;
    next.durationSeconds = undefined;
    next.warmupBlocks = undefined;
  }
  return next;
}

export interface ApplySubstitutionResult {
  content: ProtocolStructure;
  /** `dayLabel` de cada sessão onde a troca foi aplicada — para o `diff`. */
  sessionsAffected: string[];
}

/** Substitui TODAS as ocorrências de `fromExerciseId` por `to`, em toda sessão da semana —
 * um aluno que não gosta de um exercício não gosta dele em nenhum dia, só no que reclamou. */
export function applySubstitution(
  content: ProtocolStructure,
  fromExerciseId: string,
  to: CatalogExercise,
): ApplySubstitutionResult {
  const sessionsAffected: string[] = [];
  const sessions = content.sessions.map((session) => {
    let changed = false;
    const exercises = session.exercises.map((ex) => {
      if (ex.exerciseId !== fromExerciseId) return ex;
      changed = true;
      return withSubstitutedExercise(ex, to);
    });
    if (changed) sessionsAffected.push(session.dayLabel);
    return changed ? { ...session, exercises } : session;
  });
  return { content: { ...content, sessions }, sessionsAffected };
}
