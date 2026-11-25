/**
 * Qualidade das mensagens que os agentes enviam, medida em produção. Duas camadas:
 *  · checagens do código, em TODA mensagem (repetição, tamanho, culpa, promessa, dado clínico);
 *  · juiz por rubrica (modelo), em uma amostra e sempre que o código desconfia.
 * O resultado alimenta a auditoria humana: mensagem fraca vira alerta para a equipe.
 */
import { fold } from '../planning/tasks/common';

export interface QualityChecks {
  repeated: boolean;
  /** Maior similaridade (0 a 1) com as últimas mensagens da MOVIVO ao aluno. */
  maxSimilarity: number;
  tooLong: boolean;
  guilt: boolean;
  promise: boolean;
  clinical: boolean;
  /** Mensagem sem nenhum ponto concreto do aluno (nome, número ou dia): pode ser genérica. */
  noAnchor: boolean;
}

export const QUALITY_CRITERIA = [
  'specificity',
  'warmth',
  'clarity',
  'actionability',
  'safety',
  'novelty',
] as const;
export type QualityCriterion = (typeof QUALITY_CRITERIA)[number];

/** Média mínima e nota mínima por critério para a mensagem passar sem olhar humano. */
export const MIN_OVERALL = 3.5;
export const MIN_CRITERION = 3;
/** Fração das mensagens sem desconfiança que o juiz também lê. */
export const JUDGE_SAMPLE_RATE = 0.2;

const GUILT =
  /\b(voce sumiu|voce abandon|desistiu|decepcion|preguic|falhou|nao cumpriu|cade voce|ja era hora|nao esta se esforcando|voce nao registr)/;
const PROMISE = /\b(garant|com certeza vai|resultado certo|100% de resultado)/;
const CLINICAL = /\b(diagnostic|depress|ansiedade|transtorno|remedio|medicamento|tratamento)/;

const words = (text: string): Set<string> =>
  new Set(
    fold(text)
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3),
  );

/** Similaridade de Jaccard entre os conjuntos de palavras (0 = nada em comum, 1 = idênticas). */
export function similarity(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common += 1;
  return common / (wa.size + wb.size - common);
}

export function qualityChecks(input: {
  text: string;
  firstName: string | null;
  previous: readonly string[];
}): QualityChecks {
  const folded = fold(input.text);
  const maxSimilarity = input.previous.reduce(
    (top, p) => Math.max(top, similarity(input.text, p)),
    0,
  );
  const named = input.firstName ? folded.includes(fold(input.firstName)) : false;
  return {
    repeated: maxSimilarity >= 0.6,
    maxSimilarity: Math.round(maxSimilarity * 100) / 100,
    tooLong: input.text.length > 1_100,
    guilt: GUILT.test(folded),
    promise: PROMISE.test(folded),
    clinical: CLINICAL.test(folded),
    noAnchor: !named && !/\d/.test(input.text),
  };
}

/** O código desconfia: a mensagem vai ao juiz mesmo fora da amostra. */
export function suspicious(c: QualityChecks): boolean {
  return c.repeated || c.tooLong || c.guilt || c.promise || c.clinical;
}

export function shouldJudge(c: QualityChecks, roll: number, rate = JUDGE_SAMPLE_RATE): boolean {
  return suspicious(c) || roll < rate;
}

export function overallOf(scores: Partial<Record<QualityCriterion, number>>): number | null {
  const values = Object.values(scores).filter((v): v is number => typeof v === 'number');
  return values.length > 0
    ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100
    : null;
}

/** Veredito final: o código reprova sozinho culpa, promessa e rótulo clínico; o juiz, notas baixas. */
export function verdictOf(
  checks: QualityChecks,
  scores: Partial<Record<QualityCriterion, number>> | null,
): 'OK' | 'REVIEW' {
  if (checks.guilt || checks.promise || checks.clinical) return 'REVIEW';
  if (checks.repeated && checks.tooLong) return 'REVIEW';
  if (scores) {
    const overall = overallOf(scores);
    if (overall !== null && overall < MIN_OVERALL) return 'REVIEW';
    if (Object.values(scores).some((v) => typeof v === 'number' && v < MIN_CRITERION)) {
      return 'REVIEW';
    }
  }
  return 'OK';
}
