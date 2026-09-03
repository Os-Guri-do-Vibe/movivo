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
  ParqAnswer,
  ParqQuestionId,
  TrainingExperience,
  TrainingLocation,
  Weekday,
} from '@movivo/shared';
import { EMPHASIS_MUSCLE_GROUPS, PAIN_REGION_LABELS } from '@movivo/shared';

import type { ParqEvaluation } from '../anamnesis/parq';
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
  /**
   * PAR-Q do titular bloqueou (decisão do fundador, 2026-08-24). Deixou de ser TRAVA de
   * geração e virou **modo conservador + revisão humana obrigatória**: o protocolo é
   * gerado, nasce `reviewUrgency: MANDATORY` e só sai da fila por assinatura humana.
   */
  requiresProfessionalReview: boolean;
  /** Contraindicações derivadas do PAR-Q (`parqToConstraints`) — separadas de `injuryTags`. */
  parqTags: ContraindicationTag[];
  /** Perguntas do PAR-Q que dispararam, para rastreabilidade da geração. */
  parqTriggered: ParqQuestionId[];
  /** Teto de fase de periodização. Presente = nada além de `ADAPTACAO` é aceitável. */
  maxPhase?: 'ADAPTACAO';
  /**
   * Evento/meta com prazo real declarado na anamnese (Seção 1, "Data-alvo") — achado
   * 2026-09-02, correção do fundador: até aqui esse dado só existia pra calcular
   * `total_weeks`/`end_date` (lógica removida — quem decide isso agora é
   * `phaseDurationWeeks`, dentro da faixa de evidência da fase, ver `protocol-timeline.ts`)
   * e depois disso não influenciava a geração NENHUMA. É contexto de OTIMIZAÇÃO, não de
   * prazo do bloco: "casamento em 8 semanas" não estica o mesociclo pra 8 semanas — dá à
   * IA o prazo real do aluno para escolher fase/ênfase/progressão que rendam o melhor
   * resultado cientificamente plausível NESSE tempo, sem prometer o resultado que o aluno
   * descreveu (ex.: perder 19kg até o Natal não é saudável nem garantível — o protocolo
   * ainda assim deve ser o mais eficiente possível dentro do prazo real).
   *
   * Ausente quando o aluno não declarou evento importante, ou quando a data já passou
   * (nada a otimizar para um prazo que não existe mais).
   */
  importantEvent?: {
    /** `YYYY-MM-DD`, igual ao que veio da anamnese. */
    date: string;
    /** Dias entre agora e a data-alvo, arredondado pra cima — sempre > 0 quando presente. */
    daysUntil: number;
    /** Texto livre do usuário (evento/objetivo numérico, ex.: "chegar a 70kg") — nunca instrução. */
    description?: string;
  };
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

/**
 * `importantEvent` de `UserConstraints` a partir do evento-alvo declarado na anamnese.
 * `from` é parâmetro (não `new Date()` direto no corpo) para o teste controlar o "agora"
 * sem mockar relógio global — mesmo padrão de `protocol-timeline.ts` antes desta mudança.
 *
 * Sem evento, sem data, data mal formada ou data já passada → `undefined` (nada a
 * otimizar para um prazo que não existe ou já passou — mesma regra que valia para
 * `resolveTotalWeeks`, só que agora alimenta contexto de prompt, não `total_weeks`).
 */
export function importantEventForPrompt(
  event: { hasImportantEvent: boolean; importantEventDate?: string },
  description: string | undefined,
  from: Date = new Date(),
): UserConstraints['importantEvent'] {
  if (!event.hasImportantEvent || !event.importantEventDate) return undefined;

  const target = new Date(`${event.importantEventDate}T00:00:00Z`);
  const msUntilTarget = target.getTime() - from.getTime();
  if (!Number.isFinite(msUntilTarget) || msUntilTarget <= 0) return undefined;

  const daysUntil = Math.ceil(msUntilTarget / (24 * 60 * 60 * 1000));
  return {
    date: event.importantEventDate,
    daysUntil,
    ...(description ? { description } : {}),
  };
}

/** Um degrau abaixo, com piso em `INICIANTE`. Usado quando o PAR-Q bloqueia. */
const DEMOTED_LEVEL: Record<ExerciseLevel, ExerciseLevel> = {
  AVANCADO: 'INTERMEDIARIO',
  INTERMEDIARIO: 'INICIANTE',
  INICIANTE: 'INICIANTE',
};

export function demoteLevel(level: ExerciseLevel): ExerciseLevel {
  return DEMOTED_LEVEL[level];
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
  BALANCE_FALL_RISK: [
    'tontura',
    'tonteira',
    'vertigem',
    'desmaio',
    'labirintite',
    'equilibrio',
    'equilíbrio',
  ],
  PREGNANCY: [
    'gravid',
    'gestant',
    'gestacao',
    'gestação',
    'pos-parto',
    'pós-parto',
    'posparto',
    'puerp',
  ],
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
 * PAR-Q → contraindicações estruturadas (decisão do fundador, 2026-08-24).
 *
 * Enquanto o PAR-Q era TRAVA de geração, um "Sim" só precisava produzir um booleano. Agora
 * que o protocolo é gerado mesmo com PAR-Q bloqueado, cada gatilho precisa virar restrição
 * concreta — senão "gerar com cuidado" seria só uma etiqueta, sem efeito nenhum no treino.
 *
 * Mapa por pergunta (texto verbatim conferido em `PARQ_QUESTION_TEXT`, não pela ordem):
 *  - Q1 (problema no coração/pressão alta) → `CARDIAC`
 *  - Q2 (dor no peito em esforço)          → `CARDIAC`
 *  - Q3 (dor no peito em repouso)          → `CARDIAC`
 *  - Q4 (perdeu equilíbrio/desmaiou)       → `BALANCE_FALL_RISK` + teto de fase `ADAPTACAO`
 *  - Q5 (medicação contínua pressão/coração) → `CARDIAC`
 *  - Q6 (osso/articulação/coluna)          → sem tag fixa; o `detail` passa pela heurística
 *  - Q7 (gravidez/pós-parto)               → `PREGNANCY`
 *  - Q8 (cirurgia < 6 meses)               → `detail` pela heurística
 *  - Q9 (outro motivo)                     → `detail` pela heurística
 *
 * Q6/Q8/Q9 não têm tag fixa de propósito: "problema em articulação" sem dizer QUAL não
 * identifica região nenhuma, e inventar uma seria pior que deixar o texto livre visível ao
 * RT. O `detail` (follow-up "Conta um pouco mais?") é o único sinal estruturável ali, e
 * passa pelo MESMO `mapInjuriesToTags` que já trata o texto livre de dor.
 */
const PARQ_FIXED_TAGS: Partial<Record<ParqQuestionId, ContraindicationTag>> = {
  Q1: 'CARDIAC',
  Q2: 'CARDIAC',
  Q3: 'CARDIAC',
  Q4: 'BALANCE_FALL_RISK',
  Q5: 'CARDIAC',
  Q7: 'PREGNANCY',
};

/** Perguntas cujo `detail` (texto livre) é a única fonte de tag possível. */
const PARQ_FREE_TEXT_QUESTIONS: readonly ParqQuestionId[] = ['Q6', 'Q8', 'Q9'];

/** Tontura/desmaio é o único gatilho que, sozinho, trava a periodização em `ADAPTACAO`. */
const PARQ_PHASE_CAP_QUESTIONS: readonly ParqQuestionId[] = ['Q4'];

export function parqToConstraints(
  evaluation: ParqEvaluation,
  answers: readonly ParqAnswer[],
): { tags: ContraindicationTag[]; maxPhase?: 'ADAPTACAO' } {
  const triggered = new Set<ParqQuestionId>(evaluation.triggeredQuestions);
  if (triggered.size === 0) return { tags: [] };

  const tags = new Set<ContraindicationTag>();
  const freeText: string[] = [];

  for (const questionId of triggered) {
    const fixed = PARQ_FIXED_TAGS[questionId];
    if (fixed) tags.add(fixed);
    if (PARQ_FREE_TEXT_QUESTIONS.includes(questionId)) {
      const detail = answers.find((a) => a.questionId === questionId)?.detail;
      if (detail) freeText.push(detail);
    }
  }
  for (const tag of mapInjuriesToTags(freeText)) tags.add(tag);

  const capped = PARQ_PHASE_CAP_QUESTIONS.some((q) => triggered.has(q));
  return { tags: [...tags], ...(capped ? { maxPhase: 'ADAPTACAO' as const } : {}) };
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
