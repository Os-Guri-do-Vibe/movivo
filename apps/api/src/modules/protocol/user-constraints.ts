/**
 * Constraints que alimentam a geração do protocolo (US-2.1).
 *
 * Derivadas da anamnese (US-1.3). O mapeamento a partir da sessão cifrada é
 * responsabilidade do Worker (US-2.4); aqui definimos só o CONTRATO de entrada do
 * gerador e a normalização de lesão livre → tag de contraindicação.
 */
import type { PrimaryGoal } from '@movivo/shared';

import type { ContraindicationTag, ExerciseLevel, ExerciseLocation } from './exercise-catalog';

export interface UserConstraints {
  goal: PrimaryGoal;
  /**
   * Nível de experiência. A anamnese v1 ainda não captura este campo, então o Worker
   * passa o default `INICIANTE` (mais seguro). ponytail: adicionar captura de nível
   * na anamnese v2 e remover o default.
   */
  level: ExerciseLevel;
  daysPerWeek: number;
  sessionMinutes?: number;
  location: ExerciseLocation;
  /** Equipamentos que o usuário informou ter (texto livre normalizado pelo prompt). */
  equipment: string[];
  /** Lesões já normalizadas para tags (via `mapInjuriesToTags`). */
  injuryTags: ContraindicationTag[];
  /** Lesões em texto livre, para contexto do prompt (o scrubber do router pseudonimiza). */
  injuriesRaw: string[];
}

/**
 * Normaliza lesões em texto livre para tags de contraindicação, por palavra-chave.
 *
 * ponytail: heurística de keyword, sem NLP — o teto é reconhecido. É "melhor esforço"
 * que alimenta tanto o prompt quanto o gabarito do validador (US-2.3); a GARANTIA de
 * segurança é do validador, não deste mapa. Palavra desconhecida é ignorada aqui e
 * fica visível no texto livre para revisão humana.
 */
const INJURY_KEYWORDS: Record<ContraindicationTag, string[]> = {
  SHOULDER: ['ombro', 'manguito', 'rotador'],
  ELBOW: ['cotovelo', 'epicondilite'],
  WRIST: ['punho', 'pulso', 'tunel do carpo', 'túnel do carpo'],
  LOWER_BACK: ['lombar', 'coluna', 'hernia', 'hérnia', 'costas', 'ciatico', 'ciático'],
  HIP: ['quadril', 'bacia'],
  KNEE: ['joelho', 'menisco', 'ligamento', 'patela'],
  ANKLE: ['tornozelo', 'pe', 'pé'],
  NECK: ['pescoco', 'pescoço', 'cervical'],
  CARDIAC: ['coracao', 'coração', 'cardiaco', 'cardíaco', 'pressao', 'pressão', 'hipertens'],
};

export function mapInjuriesToTags(injuries: readonly string[]): ContraindicationTag[] {
  const tags = new Set<ContraindicationTag>();
  for (const injury of injuries) {
    const normalized = injury.toLowerCase();
    for (const [tag, keywords] of Object.entries(INJURY_KEYWORDS) as [
      ContraindicationTag,
      string[],
    ][]) {
      if (keywords.some((kw) => normalized.includes(kw))) tags.add(tag);
    }
  }
  return [...tags];
}
