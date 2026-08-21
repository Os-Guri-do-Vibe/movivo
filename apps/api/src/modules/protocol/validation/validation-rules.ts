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
import type { GenerationGoal, WorkoutSplit } from '@movivo/shared';

import type { ExerciseLevel } from '../exercise-catalog';

export const VALIDATION_RULES_VERSION = 'validation-rules-2026-08-v3';

export type ValidationActionCode = 'PASS' | 'FLAG' | 'BLOCK';

export interface NumericRange {
  min: number;
  max: number;
}

/** Faixa plausível de séries e descanso (comum a todos os objetivos). */
export const SETS_RANGE: NumericRange = { min: 1, max: 6 };
export const REST_SECONDS_RANGE: NumericRange = { min: 15, max: 240 };

/**
 * Faixa padrão de segundos por série/intervalo para exercício de medida `DURATION`
 * (achado 2026-08-18, `CatalogExercise.measurement`). É o default de HOLD ISOMÉTRICO (prancha);
 * cardio contínuo/intervalado tem faixa própria em `durationSecondsRange` no próprio catálogo,
 * porque a escala de tempo (minutos, não segundos) é outra.
 */
export const DURATION_SECONDS_RANGE: NumericRange = { min: 15, max: 120 };

/**
 * Faixa de repetições plausível por objetivo (a validar pelo RT CREF).
 *
 * v3 (Sprint 6): passou de 3 para os **8 objetivos de geração** da anamnese v2. Cada faixa é
 * própria, não um alias das antigas — foi justamente o atalho que o fundador rejeitou:
 *  - `GAIN_STRENGTH` é a única faixa que desce abaixo de 4 reps (trabalho neural, séries curtas);
 *  - `SPORT_EVENT` cobre de força a resistência específica, então é ampla nos dois extremos;
 *  - `HEALTH_ENERGY`, `BUILD_ROUTINE` e `RETURN_TO_TRAINING` são objetivos de adesão e
 *    reentrada: teto moderado, sem faixa de baixa repetição/alta carga.
 * `OTHER` não aparece porque não é objetivo de geração (`toGenerationGoal` o traduz antes).
 */
export const REPS_RANGE_BY_GOAL: Record<GenerationGoal, NumericRange> = {
  GAIN_MUSCLE: { min: 6, max: 15 },
  GAIN_STRENGTH: { min: 3, max: 10 },
  LOSE_FAT: { min: 8, max: 25 },
  CONDITIONING: { min: 8, max: 30 },
  HEALTH_ENERGY: { min: 8, max: 20 },
  BUILD_ROUTINE: { min: 8, max: 20 },
  RETURN_TO_TRAINING: { min: 8, max: 20 },
  SPORT_EVENT: { min: 4, max: 25 },
};

/**
 * Padrões de movimento priorizados por objetivo — o gerador recebe isto como orientação
 * explícita no prompt. Sem ele, "Ganhar força" e "Melhorar o condicionamento físico"
 * produziriam o mesmo treino, que é o problema que a ampliação dos 9 objetivos existe
 * para resolver. Vazio = sem prioridade declarada (a metodologia do RT decide).
 */
export const PRIORITY_PATTERNS_BY_GOAL: Record<GenerationGoal, readonly string[]> = {
  GAIN_MUSCLE: ['HORIZONTAL_PUSH', 'VERTICAL_PULL', 'SQUAT', 'HINGE', 'ISOLATION'],
  GAIN_STRENGTH: ['SQUAT', 'HINGE', 'HORIZONTAL_PUSH', 'VERTICAL_PULL'],
  LOSE_FAT: ['SQUAT', 'HINGE', 'LUNGE', 'HORIZONTAL_PUSH', 'CARDIO'],
  CONDITIONING: ['CARDIO', 'SQUAT', 'LUNGE', 'CORE'],
  HEALTH_ENERGY: ['CARDIO', 'CORE', 'SQUAT', 'HORIZONTAL_PULL'],
  BUILD_ROUTINE: ['SQUAT', 'HORIZONTAL_PUSH', 'HORIZONTAL_PULL', 'CORE'],
  RETURN_TO_TRAINING: ['SQUAT', 'HORIZONTAL_PUSH', 'HORIZONTAL_PULL', 'CORE'],
  SPORT_EVENT: ['SQUAT', 'HINGE', 'LUNGE', 'CORE', 'CARDIO'],
};

/**
 * Divisões permitidas por nível (metodologia v2 do RT, item 1).
 *
 * Iniciante/adaptação só recebe as três divisões que o RT lista para esse nível; ABC/ABCD/
 * ABCDE/PPL/FOCO_MUSCULAR pressupõem volume e frequência que o RT reserva a intermediário e
 * avançado. Violação é **BLOCK**, não FLAG: o `level` chega hoje como default `INICIANTE`
 * (a anamnese v1 não captura nível), então o caminho seguro é regenerar/rever, não entregar.
 */
export const SPLITS_BY_LEVEL: Record<ExerciseLevel, readonly WorkoutSplit[]> = {
  INICIANTE: ['FULL_BODY', 'CIRCUITO', 'UPPER_LOWER'],
  INTERMEDIARIO: [
    'FULL_BODY',
    'CIRCUITO',
    'UPPER_LOWER',
    'ABC',
    'ABCD',
    'ABCDE',
    'PUSH_PULL_LEGS',
    'FOCO_MUSCULAR',
  ],
  AVANCADO: [
    'FULL_BODY',
    'CIRCUITO',
    'UPPER_LOWER',
    'ABC',
    'ABCD',
    'ABCDE',
    'PUSH_PULL_LEGS',
    'FOCO_MUSCULAR',
  ],
};

/**
 * Frequência semanal MÍNIMA que cada divisão exige (RT: "sempre respeitando recuperação
 * muscular e frequência disponível"). ABCDE em 2 dias treinaria cada grupo a cada ~2,5
 * semanas — é incoerente, não individualização.
 */
export const MIN_FREQUENCY_BY_SPLIT: Record<WorkoutSplit, number> = {
  FULL_BODY: 1,
  CIRCUITO: 1,
  UPPER_LOWER: 2,
  ABC: 3,
  PUSH_PULL_LEGS: 3,
  ABCD: 4,
  ABCDE: 5,
  FOCO_MUSCULAR: 5,
};

/**
 * Teto de técnicas avançadas por sessão (RT, item 4: "não precisam aparecer em todos os
 * exercícios ou em todos os treinos"). 2 por sessão + pelo menos uma sessão da semana sem
 * nenhuma técnica, quando há mais de uma sessão. ponytail: números escolhidos por engenharia
 * a partir do "recurso pontual" do RT — se ele quiser outro teto, muda aqui e sobe a versão.
 */
export const MAX_TECHNIQUES_PER_SESSION = 2;

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
    pattern:
      /diagn[óo]stic|tratament|\bcura\b|\bcurar\b|tendinite|artrose|h[ée]rnia de disco|voc[êe] (est[áa]|tem) com/i,
    action: 'BLOCK',
  },
  {
    id: 'HANDOFF_SLA_PROMISE',
    pattern:
      /\b(?:garanto|prometo|responderei|responderemos|retornarei|retornaremos|entrarei|entraremos|vou|vamos|iremos)\b.{0,60}\b(?:em|dentro de|at[ée]|imediatamente|agora|na mesma hora)\b/i,
    action: 'BLOCK',
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
