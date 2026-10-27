/**
 * Avisos de cautela por dor relatada para o profissional CREF (achado 2026-10-21).
 *
 * Dor sem veto (`UserConstraints.cautionTags`) deixou de apagar exercícios da base: eles podem
 * ser prescritos com ressalvas de carga, volume e estabilidade. Como não geram mais violação no
 * validador, o profissional precisa ENXERGAR quais exercícios do rascunho carregam a região —
 * é isto que o painel mostra junto dos avisos de qualidade. Texto para o profissional, sem
 * nome de condição de saúde, diagnóstico ou promessa.
 */
import type { ProtocolStructure } from '@movivo/shared';

import type { CatalogExercise, ContraindicationTag } from '../catalog/exercises/exercise-catalog';

const REGION_LABEL: Partial<Record<ContraindicationTag, string>> = {
  NECK: 'pescoço',
  SHOULDER: 'ombro',
  ELBOW: 'cotovelo',
  WRIST: 'punho',
  LOWER_BACK: 'lombar',
  HIP: 'quadril',
  KNEE: 'joelho',
  ANKLE: 'tornozelo ou pé',
};

const MAX_LISTED = 6;

export function cautionNotices(
  structure: ProtocolStructure,
  cautionTags: readonly ContraindicationTag[] | undefined,
  catalog: { getById(id: string): CatalogExercise | undefined },
): string[] {
  if (!cautionTags || cautionTags.length === 0) return [];
  const notices: string[] = [];
  for (const tag of cautionTags) {
    const names = new Set<string>();
    for (const session of structure.sessions) {
      for (const exercise of session.exercises) {
        const entry = catalog.getById(exercise.exerciseId);
        if (entry?.contraindicatedFor.includes(tag)) names.add(entry.name);
      }
    }
    if (names.size === 0) continue;
    const listed = [...names].slice(0, MAX_LISTED).join(', ');
    const rest = names.size > MAX_LISTED ? ` e mais ${names.size - MAX_LISTED}` : '';
    notices.push(
      `Dor relatada em ${REGION_LABEL[tag] ?? tag.toLowerCase()} sem orientação de evitar: ${names.size} exercício(s) do rascunho carregam essa região (${listed}${rest}). Confira carga, amplitude, volume e a escolha de variações estáveis.`,
    );
  }
  return notices;
}

/**
 * Quantos exercícios do protocolo carregam uma região de cautela. Decide a urgência de revisão
 * (`CAUTION_PROTOCOL_REVIEW_URGENCY`): antes da política de cautela esses exercícios nem
 * chegavam ao rascunho, então nada com a região doída saía sem o profissional.
 */
export function countCautionExercises(
  structure: ProtocolStructure,
  cautionTags: readonly ContraindicationTag[] | undefined,
  catalog: { getById(id: string): CatalogExercise | undefined },
): number {
  if (!cautionTags || cautionTags.length === 0) return 0;
  return structure.sessions
    .flatMap((session) => session.exercises)
    .filter((exercise) =>
      catalog
        .getById(exercise.exerciseId)
        ?.contraindicatedFor.some((tag) => cautionTags.includes(tag)),
    ).length;
}
