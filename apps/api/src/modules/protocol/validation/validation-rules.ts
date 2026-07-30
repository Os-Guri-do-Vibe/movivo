/**
 * Regras versionadas do ValidationService (US-2.3 / TASK-2.3.1/2.3.2).
 *
 * ⚠️ RASCUNHO — A VALIDAR PELO RT CREF / ALEXANDRE. As faixas plausíveis de carga/volume,
 * a lista de termos proibidos e o mapeamento de ações são o ponto de partida do MVP para
 * destravar o desenvolvimento; o Responsável Técnico (CREF) e o jurídico precisam ratificar
 * cada faixa/termo antes de qualquer uso com pessoas reais. Mudou a regra, muda a versão.
 *
 * Determinístico, sem I/O. É o gabarito de segurança do produto (a segurança mora aqui).
 */
import type { PrimaryGoal } from '@movivo/shared';

export const VALIDATION_RULES_VERSION = 'validation-rules-2026-07-draft-v1';

export type ValidationActionCode = 'PASS' | 'FLAG' | 'BLOCK';

export interface NumericRange {
  min: number;
  max: number;
}

/** Faixa plausível de séries e descanso (comum a todos os objetivos). */
export const SETS_RANGE: NumericRange = { min: 1, max: 6 };
export const REST_SECONDS_RANGE: NumericRange = { min: 15, max: 240 };

/** Faixa de repetições plausível por objetivo (a validar pelo RT CREF). */
export const REPS_RANGE_BY_GOAL: Record<PrimaryGoal, NumericRange> = {
  GAIN_MUSCLE: { min: 4, max: 15 },
  LOSE_WEIGHT: { min: 8, max: 25 },
  CONDITIONING: { min: 8, max: 30 },
};

/** `value` está dentro de `[min, max]`? */
export function inRange(value: number, range: NumericRange): boolean {
  return value >= range.min && value <= range.max;
}

/**
 * Regra de compliance de linguagem: um padrão + a ação que ele dispara.
 * `BLOCK` bloqueia e cai no fallback; `FLAG` roteia à revisão humana sem bloquear.
 */
export interface LanguageRule {
  id: string;
  pattern: RegExp;
  action: Extract<ValidationActionCode, 'BLOCK' | 'FLAG'>;
}

/** Termos proibidos hard-coded (Sofia §13 + nomes de medicamento comuns). A validar. */
export const LANGUAGE_RULES: readonly LanguageRule[] = [
  {
    id: 'MED_PRESCRIPTION',
    pattern:
      /prescrev|prescri[çc][ãa]o|medicament|rem[ée]dio|analg[ée]sic|anti-?inflamat[óo]ri|\btome\b|\bdose\b|ibuprofeno|dipirona|paracetamol|nimesulida|diclofenaco|omeprazol/i,
    action: 'BLOCK',
  },
  {
    id: 'PROMISE',
    pattern: /garantid|garantia de resultado|\bcura\b|\bcurar\b|resultado garantido/i,
    action: 'BLOCK',
  },
  {
    id: 'DIAGNOSIS',
    pattern: /diagn[óo]stic|tendinite|artrose|h[ée]rnia de disco|voc[êe] (est[áa]|tem) com/i,
    action: 'FLAG',
  },
];

/**
 * Sentinelas do system prompt (US-2.1): se aparecerem na SAÍDA, houve vazamento do prompt
 * (PROMPT_LEAK). São trechos que só existem no prefixo estável, nunca num treino legítimo.
 */
export const SYSTEM_PROMPT_SENTINELS: readonly string[] = [
  'BASE DE REFERÊNCIA',
  'SCHEMA DO JSON',
  'metodologia de um profissional',
  'mensagem_usuario',
];

/**
 * Padrões conhecidos de prompt injection (TASK-2.3.4). Sinalizam/sanitizam sem bloquear
 * silenciosamente. Cobre o caso do campo de lesão com instrução maliciosa (Sato §8.2).
 */
export const INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(as\s+|todas\s+as\s+)?instru[çc]/i,
  /voc[êe]\s+agora\s+[ée]|aja\s+como|you\s+are\s+now|act\s+as/i,
  /revele\s+(o|seu)\s+(prompt|system)|mostre\s+o\s+(prompt|system)|reveal.*prompt|system\s+prompt/i,
  /(dados|informa[çc]\w+)\s+de\s+outr[oa]\s+(usu[áa]rio|pessoa)/i,
];
