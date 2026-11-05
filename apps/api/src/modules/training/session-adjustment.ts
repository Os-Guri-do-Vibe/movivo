/**
 * Aplica o ajuste pontual de uma ocorrência (encurtar, trocar exercício) sobre o conteúdo do
 * plano. Função pura: o plano nunca é alterado, só o que o aluno vê e executa naquele dia.
 */
import type { SessionAdjustment, SessionContent } from '@movivo/shared';

/** Fração do conteúdo que cabe em `targetMinutes` quando a sessão prevista dura `plannedMinutes`. */
export function shortenFactor(plannedMinutes: number, targetMinutes: number): number {
  if (plannedMinutes <= 0) return 1;
  return Math.min(1, Math.max(0.2, targetMinutes / plannedMinutes));
}

const KEEP_WHOLE = ['WARMUP', 'COOLDOWN'];

export function applyAdjustment(
  content: SessionContent,
  adjustment: SessionAdjustment | null | undefined,
): SessionContent {
  if (!adjustment) return content;
  let result = content;

  if (result.modality === 'STRENGTH' && adjustment.substitutions?.length) {
    const swaps = new Map(adjustment.substitutions.map((s) => [s.fromExerciseId, s]));
    result = {
      ...result,
      exercises: result.exercises.map((exercise) => {
        const swap = swaps.get(exercise.exerciseId);
        return swap ? { ...exercise, exerciseId: swap.toExerciseId, name: swap.toName } : exercise;
      }),
    };
  }

  const factor = adjustment.shorten?.factor;
  if (factor === undefined || factor >= 1) return result;

  switch (result.modality) {
    case 'STRENGTH': {
      // Mantém os primeiros exercícios (os principais) e enxuga as séries do que fica.
      const keep = Math.max(1, Math.ceil(result.exercises.length * Math.sqrt(factor)));
      return {
        ...result,
        exercises: result.exercises.slice(0, keep).map((exercise) => ({
          ...exercise,
          sets: Math.max(1, Math.round(exercise.sets * Math.sqrt(factor))),
        })),
      };
    }
    case 'RUNNING':
      return {
        ...result,
        segments: result.segments.map((segment) => {
          if (KEEP_WHOLE.includes(segment.type)) return segment;
          if (segment.repeat && segment.repeat > 1) {
            return { ...segment, repeat: Math.max(1, Math.round(segment.repeat * factor)) };
          }
          return segment.distanceMeters !== undefined
            ? {
                ...segment,
                distanceMeters: Math.max(
                  50,
                  Math.round((segment.distanceMeters * factor) / 50) * 50,
                ),
              }
            : {
                ...segment,
                durationSeconds: Math.max(10, Math.round((segment.durationSeconds ?? 0) * factor)),
              };
        }),
      };
    case 'HYROX':
      return {
        ...result,
        rounds: Math.max(1, Math.round(result.rounds * factor)),
        blocks:
          result.rounds === 1
            ? result.blocks.slice(0, Math.max(2, Math.ceil(result.blocks.length * factor)))
            : result.blocks,
      };
    case 'EXTERNAL_SPORT':
      return {
        ...result,
        plannedMinutes: Math.max(10, Math.round(result.plannedMinutes * factor)),
      };
  }
}
