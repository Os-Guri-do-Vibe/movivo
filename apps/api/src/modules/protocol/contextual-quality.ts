import type { ProtocolStructure } from '@movivo/shared';
import { z } from 'zod';

import type { CatalogExercise } from './exercise-catalog';
import { measureProtocol } from './protocol-measurements';
import type { UserConstraints } from './user-constraints';

export const CONTEXTUAL_QUALITY_VERSION = 'contextual-quality-2026-10-v2';
/** Versões já gravadas em `constraints.contextualQuality` — continuam legíveis no painel. */
const KNOWN_QUALITY_VERSIONS = [
  'contextual-quality-2026-10-v1',
  CONTEXTUAL_QUALITY_VERSION,
] as const;

export const QUALITY_CRITERIA = [
  'METHODOLOGY_FIT',
  'GOAL_STRATEGY',
  'PREFERENCES',
  'WEEKLY_BALANCE',
  'FEASIBILITY',
  'PROGRESSION_RECOVERY',
  'CONTENT_COHERENCE',
  'SESSION_SEQUENCING',
] as const;

export const QUALITY_LABELS: Record<(typeof QUALITY_CRITERIA)[number], string> = {
  METHODOLOGY_FIT: 'Aplicação da metodologia vigente ao perfil do aluno',
  GOAL_STRATEGY: 'Estratégia compatível com o objetivo',
  PREFERENCES: 'Ênfases e preferências conciliadas com as restrições',
  WEEKLY_BALANCE: 'Distribuição semanal e cobertura muscular',
  FEASIBILITY: 'Viabilidade no tempo, local e rotina disponíveis',
  PROGRESSION_RECOVERY: 'Progressão e recuperação individualizadas',
  CONTENT_COHERENCE: 'Coerência entre o foco anunciado e os exercícios',
  SESSION_SEQUENCING: 'Ordem e agrupamento dos exercícios dentro de cada sessão',
};

const checkSchema = z
  .object({
    status: z.enum(['MET', 'ADAPTED', 'GAP']),
    methodologyExcerpt: z.string().trim().min(20).max(800),
    observation: z.string().trim().min(1).max(700),
    adjustment: z.string().trim().min(1).max(700).nullable(),
  })
  .strict()
  .refine((check) => check.status !== 'GAP' || check.adjustment !== null);

export const qualityReviewSchema = z
  .object({
    METHODOLOGY_FIT: checkSchema,
    GOAL_STRATEGY: checkSchema,
    PREFERENCES: checkSchema,
    WEEKLY_BALANCE: checkSchema,
    FEASIBILITY: checkSchema,
    PROGRESSION_RECOVERY: checkSchema,
    CONTENT_COHERENCE: checkSchema,
    SESSION_SEQUENCING: checkSchema,
  })
  .strict();

export type QualityReview = z.infer<typeof qualityReviewSchema>;

/** Persistência/telemetria: só códigos e contagens, nunca o texto livre do avaliador. */
export const contextualQualitySummarySchema = z.object({
  version: z.enum(KNOWN_QUALITY_VERSIONS),
  status: z.enum(['PASS', 'GAPS', 'UNAVAILABLE']),
  checks: z.array(
    z.object({ criterion: z.enum(QUALITY_CRITERIA), status: z.enum(['MET', 'ADAPTED', 'GAP']) }),
  ),
  missingEmphasisCount: z.number().int().nonnegative(),
  unavailableReason: z
    .enum(['LLM_UNAVAILABLE', 'LLM_LIMIT', 'INVALID_REVIEW', 'METHODOLOGY_CHANGED'])
    .optional(),
});

export type ContextualQualitySummary = z.infer<typeof contextualQualitySummarySchema>;
export interface ContextualQualityAssessment {
  summary: ContextualQualitySummary;
  /** Só em memória, para a correção. Não vai ao aluno, ao log nem ao banco. */
  review?: QualityReview;
}

const normalized = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();

export function qualityFacts(
  structure: ProtocolStructure,
  constraints: UserConstraints,
  catalog: readonly CatalogExercise[],
  eligible: readonly CatalogExercise[],
) {
  const byId = new Map(catalog.map((exercise) => [exercise.id, exercise]));
  const selected = structure.sessions.flatMap((session) => session.exercises);
  const matches = (exercise: CatalogExercise, group: string): boolean =>
    normalized(group) === 'core'
      ? exercise.pattern === 'CORE'
      : exercise.muscleGroups.some((muscle) => normalized(muscle) === normalized(group));
  return {
    // Achado 2026-10-21: o juiz só via contagem por PADRÃO e, sem números por grupo, aprovava
    // "bíceps 3 / tríceps 3 séries na semana" como "equilibrado". Estas são medições (nunca
    // regras): o critério de bom ou ruim continua sendo a metodologia publicada.
    measurements: measureProtocol(
      structure,
      { getById: (id) => byId.get(id) },
      { emphasis: constraints.emphasis, sessionMinutes: constraints.sessionMinutes },
    ),
    patternDistribution: [...new Set(catalog.map((exercise) => exercise.pattern))].map(
      (pattern) => {
        const slots = selected.filter(
          (exercise) => byId.get(exercise.exerciseId)?.pattern === pattern,
        );
        return {
          pattern,
          eligibleOptions: eligible.filter((exercise) => exercise.pattern === pattern).length,
          selectedSlots: slots.length,
          sessionArraySets: slots.reduce((sum, exercise) => sum + exercise.sets, 0),
        };
      },
    ),
    emphasisCoverage: constraints.emphasis.map((group) => ({
      group,
      selectedSlots: selected.filter((exercise) => {
        const entry = byId.get(exercise.exerciseId);
        return entry !== undefined && matches(entry, group);
      }).length,
      eligibleOptions: eligible.filter((exercise) => matches(exercise, group)).length,
    })),
    sessions: structure.sessions.map((session, index) => ({
      index,
      weekday: session.weekday,
      exercises: session.exercises.map((exercise) => {
        const entry = byId.get(exercise.exerciseId);
        return {
          exerciseId: exercise.exerciseId,
          pattern: entry?.pattern ?? 'UNKNOWN',
          muscleGroups: entry?.muscleGroups ?? [],
          sets: exercise.sets,
        };
      }),
    })),
  };
}

export function qualityUnavailable(
  reason: NonNullable<ContextualQualitySummary['unavailableReason']>,
): ContextualQualityAssessment {
  return {
    summary: {
      version: CONTEXTUAL_QUALITY_VERSION,
      status: 'UNAVAILABLE',
      checks: [],
      missingEmphasisCount: 0,
      unavailableReason: reason,
    },
  };
}

export function assessQualityReview(
  review: QualityReview,
  facts: ReturnType<typeof qualityFacts>,
): ContextualQualityAssessment {
  const missingEmphasisCount = facts.emphasisCoverage.filter(
    (coverage) => coverage.selectedSlots === 0,
  ).length;
  // Nem o parecer do LLM pode esconder uma ênfase ausente. Sem opção elegível, o RT
  // precisa decidir a limitação; não se reabilita exercício vetado para completar a lista.
  return {
    review,
    summary: {
      version: CONTEXTUAL_QUALITY_VERSION,
      status:
        missingEmphasisCount > 0 ||
        QUALITY_CRITERIA.some((criterion) => review[criterion].status === 'GAP')
          ? 'GAPS'
          : 'PASS',
      checks: QUALITY_CRITERIA.map((criterion) => ({
        criterion,
        status:
          criterion === 'PREFERENCES' && missingEmphasisCount > 0
            ? 'GAP'
            : review[criterion].status,
      })),
      missingEmphasisCount,
    },
  };
}

/** Forma comparável: sem acento, caixa ou pontuação — o modelo cita a metodologia de memória. */
const groundingForm = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * O trecho citado pelo juiz está na metodologia publicada? Achado 2026-10-21 (produção e
 * laboratório): a checagem era `includes` literal, e UMA citação com a maiúscula trocada ("A
 * progressão…" onde o texto tem "…e a progressão…") invalidava o parecer inteiro — 27 de 28
 * execuções do laboratório ficaram sem avaliação. Cabe diferença de caixa, acento, espaço e
 * pontuação, e reticências emendando dois pedaços literais; paráfrase continua reprovando.
 */
export function isGroundedInMethodology(excerpt: string, methodology: string): boolean {
  const haystack = groundingForm(methodology);
  const needle = groundingForm(excerpt);
  if (needle.length >= 20 && haystack.includes(needle)) return true;
  const parts = excerpt
    .split(/\s*(?:\.\.\.|…|\[\.\.\.\])\s*/)
    .map(groundingForm)
    .filter((part) => part.length >= 12);
  return parts.length > 1 && parts.every((part) => haystack.includes(part));
}

export function qualityCorrectionMessage(
  quality: ContextualQualityAssessment,
  measurementsText?: string,
): string {
  return [
    'CORREÇÃO DE QUALIDADE CONTEXTUAL: concilie a metodologia publicada com o contexto integral do aluno, sem enfraquecer as restrições.',
    ...quality.summary.checks
      .filter((check) => check.status === 'GAP')
      .map((check) => {
        const finding = quality.review?.[check.criterion];
        return `${QUALITY_LABELS[check.criterion]}: ${
          finding?.status === 'GAP'
            ? `${finding.observation} Ajuste: ${finding.adjustment}`
            : 'Há ênfase solicitada sem exercício correspondente. Confira a cobertura real no catálogo elegível.'
        }`;
      }),
    ...(measurementsText
      ? [
          'MEDIÇÕES DO SEU RASCUNHO (fatos calculados, não regras — a regra é a metodologia publicada):',
          measurementsText,
        ]
      : []),
    'Corrija o conteúdo real, não apenas títulos e justificativas. Preserve escolhas válidas; não acrescente exercício contraindicado nem invente opção fora da base. Não abandone os demais grupos para cumprir uma ênfase.',
    'Se não houver solução elegível, preserve o melhor rascunho possível para decisão do profissional CREF. Retorne somente o protocolo completo no schema original.',
  ].join('\n');
}

export function qualityNotices(value: unknown): string[] {
  if (value === undefined) return [];
  const parsed = contextualQualitySummarySchema.safeParse(value);
  if (!parsed.success || parsed.data.status === 'UNAVAILABLE') {
    return [
      'A avaliação contextual não foi concluída; o profissional CREF deve conferir a aderência à metodologia e ao perfil do aluno.',
    ];
  }
  const quality = parsed.data;
  return [
    ...quality.checks
      .filter((check) => check.status !== 'MET')
      .map((check) =>
        check.status === 'GAP'
          ? `Revisar: ${QUALITY_LABELS[check.criterion]}.`
          : `Adaptação contextual identificada: ${QUALITY_LABELS[check.criterion]}.`,
      ),
    ...(quality.missingEmphasisCount > 0
      ? [
          `Há ${quality.missingEmphasisCount} ênfase(s) sem exercício correspondente no rascunho. Confira as opções elegíveis e as limitações do catálogo.`,
        ]
      : []),
  ];
}
