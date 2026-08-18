/**
 * Constraints que alimentam a geração do protocolo (US-2.1, ampliadas na US-6.9).
 *
 * Derivadas da anamnese v2. O mapeamento a partir da sessão cifrada é responsabilidade do
 * Worker (US-2.4); aqui definimos o CONTRATO de entrada do gerador e as normalizações
 * determinísticas (lesão/dor livre → tag de contraindicação, experiência → nível).
 *
 * O que a Sprint 6 fecha (lacuna apontada por Victor): `level` deixa de ser `INICIANTE`
 * hardcoded, e `emphasis`/`avoid` passam a existir. **Preferência nunca sobrepõe
 * segurança**: `avoid` só remove exercício; quem remove por contraindicação é o
 * `injuryTags` + o `ValidationService`, e nada em `avoid` reabilita um exercício vetado.
 */
import type {
  EmphasisRegion,
  GenerationGoal,
  PainAssessment,
  TrainingExperience,
  TrainingLocation,
  Weekday,
} from '@movivo/shared';
import { EMPHASIS_MUSCLE_GROUPS, PAIN_REGION_LABELS } from '@movivo/shared';

import type { ContraindicationTag, ExerciseLevel } from './exercise-catalog';

export interface UserConstraints {
  /** Objetivo já traduzido por `toGenerationGoal` — "Outro" nunca chega aqui. */
  goal: GenerationGoal;
  /** Nível REAL, vindo da experiência com musculação declarada na anamnese v2. */
  level: ExerciseLevel;
  daysPerWeek: number;
  /** Dias reais da semana declarados na anamnese (achado 2026-08-18) — uma sessão do
   *  protocolo por dia aqui, nunca menos/mais (ver `ValidationService`). */
  preferredDays: Weekday[];
  sessionMinutes?: number;
  location: TrainingLocation;
  /** Equipamentos que o usuário informou ter (texto livre normalizado pelo prompt). */
  equipment: string[];
  /** Até 2 grupos musculares priorizados (US-6.9). Vazio = sem preferência. */
  emphasis: string[];
  /** Exercícios/movimentos que o usuário pediu para evitar. **Preferência, não segurança.** */
  avoid: string[];
  /** Lesões e dores já normalizadas para tags (via `mapInjuriesToTags`). */
  injuryTags: ContraindicationTag[];
  /** Lesões/dores em texto livre, para contexto do prompt (o scrubber do router pseudonimiza). */
  injuriesRaw: string[];
}

/** Experiência declarada → nível do catálogo. É o fim do default hardcoded. */
const LEVEL_BY_EXPERIENCE: Record<TrainingExperience, ExerciseLevel> = {
  BEGINNER: 'INICIANTE',
  INTERMEDIATE: 'INTERMEDIARIO',
  ADVANCED: 'AVANCADO',
};

export function levelFromExperience(experience: TrainingExperience): ExerciseLevel {
  return LEVEL_BY_EXPERIENCE[experience];
}

/** Regiões de ênfase → grupos musculares do catálogo. `FULL_BODY` = sem ênfase. */
export function emphasisToMuscleGroups(regions: readonly EmphasisRegion[]): string[] {
  const groups = new Set<string>();
  for (const region of regions) {
    for (const group of EMPHASIS_MUSCLE_GROUPS[region]) groups.add(group);
  }
  return [...groups];
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

/**
 * Região de dor (vocabulário fechado da seção 4) → tag de contraindicação.
 *
 * Mapeamento **direto**, sem heurística de texto: a seção 4 já pergunta a região num
 * enum, então derivar a contraindicação por keyword aqui seria perder informação que o
 * formulário entrega estruturada. `OTHER` cai na heurística de texto livre.
 */
const TAG_BY_PAIN_REGION: Partial<
  Record<PainAssessment['points'][number]['region'], ContraindicationTag>
> = {
  NECK: 'NECK',
  SHOULDER: 'SHOULDER',
  ELBOW: 'ELBOW',
  WRIST: 'WRIST',
  LOWER_BACK: 'LOWER_BACK',
  UPPER_BACK: 'LOWER_BACK',
  HIP: 'HIP',
  KNEE: 'KNEE',
  ANKLE_FOOT: 'ANKLE',
};

/** Seção 4 → tags de contraindicação + texto livre para o contexto do prompt. */
export function painToConstraints(pain: PainAssessment | null | undefined): {
  tags: ContraindicationTag[];
  raw: string[];
} {
  if (!pain?.hasPain) return { tags: [], raw: [] };

  const tags = new Set<ContraindicationTag>();
  const raw: string[] = [];

  for (const point of pain.points) {
    const tag = TAG_BY_PAIN_REGION[point.region];
    if (tag) tags.add(tag);
    const label =
      point.region === 'OTHER'
        ? (point.regionOther ?? 'outra região')
        : PAIN_REGION_LABELS[point.region];
    raw.push(`Dor em ${label} (intensidade ${point.intensity}/10)`);
  }
  // "Outra região" e a recomendação profissional de evitação são texto livre: passam
  // pela heurística de keyword para virar tag quando possível, e seguem visíveis ao RT.
  const freeText = [
    ...pain.points.filter((p) => p.region === 'OTHER').map((p) => p.regionOther ?? ''),
    pain.trigger ?? '',
    pain.professionalExplanation ?? '',
    pain.avoidanceRecommendation ?? '',
  ].filter(Boolean);
  for (const tag of mapInjuriesToTags(freeText)) tags.add(tag);

  if (pain.trend) raw.push(`Tendência da dor: ${pain.trend}`);
  if (pain.trigger) raw.push(`O que provoca: ${pain.trigger}`);
  if (pain.avoidanceRecommendation) {
    raw.push(`Orientação profissional de evitar: ${pain.avoidanceRecommendation}`);
  }

  return { tags: [...tags], raw };
}
