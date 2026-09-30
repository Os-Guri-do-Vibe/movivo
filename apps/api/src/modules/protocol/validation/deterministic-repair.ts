/**
 * Reparo determinístico da ÚLTIMA saída bloqueada (redução de fallback, 2026-09-29).
 *
 * Medição do Victor (pipeline real, 83 execuções): boa parte dos bloqueios que chegavam ao
 * template de fallback eram violações MECÂNICAS — técnica marcada num iniciante, RIR um
 * ponto abaixo do piso do PAR-Q, duração do mesociclo uma semana fora da faixa, uma frase
 * proibida numa observação. Todas têm uma correção única, óbvia e que não exige julgamento
 * clínico. Só isto já levou o fallback de 9,6% para 3,6% sobre as saídas reais.
 *
 * Contrato (inegociável):
 *  - roda só DEPOIS das rodadas de correção com feedback, sobre a última saída;
 *  - devolve `null` se QUALQUER violação BLOCK não estiver na lista de reparáveis — o
 *    protocolo inteiro vai para o template, nunca um reparo parcial;
 *  - nunca acrescenta/remove exercício, nunca troca `exerciseId`, séries, repetições,
 *    duração, fase nem divisão — só remove `technique`, sobe `rir` ao piso, faz clamp de
 *    `phaseDurationWeeks`, redistribui `weekday` por posição e remove frase proibida;
 *  - NÃO substitui o validador: quem chama revalida o resultado no `ValidationService`
 *    inteiro e só aceita se não houver mais BLOCK;
 *  - idempotente: reaplicar sobre a própria saída não muda nada.
 *
 * Fica FORA de propósito (exige julgamento ou é regra de segurança): exercício
 * contraindicado/acima do nível/inexistente, teto de fase do PAR-Q, fase FORCA com PAR-Q,
 * contagem de sessões, divisão × nível/frequência, isolado como base e qualquer regra que
 * não esteja listada em `REPAIRABLE_RULES`.
 */
import type { ProtocolStructure, Weekday } from '@movivo/shared';

import type { ContraindicationTag } from '../exercise-catalog';
import type { ExerciseCatalogProvider } from '../exercise-catalog-provider.service';
import { PHASE_DURATION_WEEKS_RANGE } from '../protocol-timeline';
import { isLanguageRule, languageRuleMatches, protocolTextFields } from './text-fields';
import { MAX_TECHNIQUES_PER_SESSION } from './validation-rules';
import { parqRirFloor, type ValidationViolation } from './validation.service';

/** O que foi efetivamente ajustado — vai para o rastro do protocolo (selo "ajustado automaticamente"). */
export type DeterministicRepairCode =
  | 'STRIP_ALL_TECHNIQUES'
  | 'CAP_TECHNIQUES_PER_SESSION'
  | 'RAISE_RIR_TO_PARQ_FLOOR'
  | 'CLAMP_PHASE_DURATION'
  | 'ASSIGN_WEEKDAYS_BY_POSITION'
  | 'DROP_FORBIDDEN_SENTENCES'
  | 'RESTORE_CATALOG_EXERCISE_NAME';

/**
 * Regras BLOCK com correção mecânica. `PARQ_VIOLATION` só na variante "técnica com PAR-Q"
 * — a variante "fase FORCA com PAR-Q" é recusada à parte (mudar fase exige juízo).
 */
export const REPAIRABLE_RULES: ReadonlySet<string> = new Set([
  'TECHNIQUE_LEVEL_NOT_ALLOWED',
  'TECHNIQUE_OVERUSE',
  'PARQ_VIOLATION',
  'PARQ_RIR_TOO_LOW',
  'PHASE_DURATION_OUT_OF_RANGE',
  'WEEKDAY_MISMATCH',
  'MED_PRESCRIPTION',
  'PROMISE',
  'DIAGNOSIS',
  'HANDOFF_SLA_PROMISE',
  'PROMPT_LEAK',
]);

export interface DeterministicRepairContext {
  preferredDays: readonly Weekday[];
  /** Flags de PAR-Q (mesmo valor que o planner passa ao validador como `parqFlags`). */
  parqFlags: readonly ContraindicationTag[];
  catalog: Pick<ExerciseCatalogProvider, 'getById'>;
}

export interface DeterministicRepairResult {
  structure: ProtocolStructure;
  repairs: DeterministicRepairCode[];
}

type Exercise = ProtocolStructure['sessions'][number]['exercises'][number];

/** Separa em frases (ponto, exclamação, interrogação, ponto e vírgula ou quebra de linha). */
const SENTENCE_BOUNDARY = /(?<=[.!?;])\s+|\n+/;

function stripTechnique(exercise: Exercise): void {
  delete exercise.technique;
}

export function deterministicRepair(
  structure: ProtocolStructure,
  violations: readonly ValidationViolation[],
  ctx: DeterministicRepairContext,
): DeterministicRepairResult | null {
  const blockRules = new Set(violations.filter((v) => v.action === 'BLOCK').map((v) => v.rule));
  if (blockRules.size === 0) return null;
  for (const rule of blockRules) if (!REPAIRABLE_RULES.has(rule)) return null;

  // Variante "fase FORCA com PAR-Q" do `PARQ_VIOLATION` — recalculada da estrutura (mesma
  // condição do `checkParq`), nunca inferida do texto do `detail`.
  if (blockRules.has('PARQ_VIOLATION') && ctx.parqFlags.length > 0 && structure.phase === 'FORCA') {
    return null;
  }
  if (
    blockRules.has('WEEKDAY_MISMATCH') &&
    (ctx.preferredDays.length === 0 || structure.sessions.length !== ctx.preferredDays.length)
  ) {
    return null;
  }

  const languageRules = [...blockRules].filter(isLanguageRule);
  const hitsLanguage = (text: string): boolean =>
    languageRules.some((rule) => languageRuleMatches(rule, text));
  // `focus`/`dayLabel` são o rótulo da sessão — reescrever exige julgamento.
  if (
    protocolTextFields(structure).some(
      (f) => (f.kind === 'focus' || f.kind === 'dayLabel') && hitsLanguage(f.text),
    )
  ) {
    return null;
  }
  // `name` só é reparável se o exercício existe no catálogo (o nome canônico é o reparo).
  for (const session of structure.sessions) {
    for (const exercise of session.exercises) {
      if (hitsLanguage(exercise.name) && !ctx.catalog.getById(exercise.exerciseId)) return null;
    }
  }

  const out = structuredClone(structure);
  const repairs: DeterministicRepairCode[] = [];

  if (blockRules.has('TECHNIQUE_LEVEL_NOT_ALLOWED') || blockRules.has('PARQ_VIOLATION')) {
    for (const session of out.sessions) session.exercises.forEach(stripTechnique);
    repairs.push('STRIP_ALL_TECHNIQUES');
  }

  if (blockRules.has('TECHNIQUE_OVERUSE')) {
    // Mantém as primeiras N técnicas de cada sessão (ordem do próprio protocolo).
    for (const session of out.sessions) {
      let kept = 0;
      for (const exercise of session.exercises) {
        if (!exercise.technique) continue;
        kept++;
        if (kept > MAX_TECHNIQUES_PER_SESSION) stripTechnique(exercise);
      }
    }
    // Com 2+ sessões, ao menos uma limpa: limpa a de MENOS técnicas (empate → a primeira).
    const count = (s: (typeof out.sessions)[number]): number =>
      s.exercises.filter((e) => e.technique).length;
    if (out.sessions.length > 1 && out.sessions.every((s) => count(s) > 0)) {
      const fewest = out.sessions.reduce((best, s) => (count(s) < count(best) ? s : best));
      fewest.exercises.forEach(stripTechnique);
    }
    repairs.push('CAP_TECHNIQUES_PER_SESSION');
  }

  if (blockRules.has('PARQ_RIR_TOO_LOW')) {
    const floor = parqRirFloor(ctx.parqFlags);
    for (const session of out.sessions) {
      for (const exercise of session.exercises) {
        if (exercise.rir !== undefined && exercise.rir < floor) exercise.rir = floor;
      }
    }
    repairs.push('RAISE_RIR_TO_PARQ_FLOOR');
  }

  if (blockRules.has('PHASE_DURATION_OUT_OF_RANGE')) {
    const range = PHASE_DURATION_WEEKS_RANGE[out.phase];
    out.phaseDurationWeeks = Math.min(
      range.maxWeeks,
      Math.max(range.minWeeks, out.phaseDurationWeeks),
    );
    repairs.push('CLAMP_PHASE_DURATION');
  }

  if (blockRules.has('WEEKDAY_MISMATCH')) {
    out.sessions.forEach((session, i) => {
      session.weekday = ctx.preferredDays[i];
    });
    repairs.push('ASSIGN_WEEKDAYS_BY_POSITION');
  }

  if (languageRules.length > 0) {
    const matchesAny = (text: string): boolean =>
      languageRules.some((rule) => languageRuleMatches(rule, text));
    const dropSentences = (text: string): string =>
      text
        .split(SENTENCE_BOUNDARY)
        .filter((sentence) => sentence.trim() && !matchesAny(sentence))
        .join(' ')
        .trim();

    let dropped = false;
    let renamed = false;
    if (out.generalNotes && matchesAny(out.generalNotes)) {
      const cleaned = dropSentences(out.generalNotes);
      if (cleaned) out.generalNotes = cleaned;
      else delete out.generalNotes;
      dropped = true;
    }
    for (const session of out.sessions) {
      for (const exercise of session.exercises) {
        if (exercise.notes && matchesAny(exercise.notes)) {
          const cleaned = dropSentences(exercise.notes);
          if (cleaned) exercise.notes = cleaned;
          else delete exercise.notes;
          dropped = true;
        }
        const catalogName = ctx.catalog.getById(exercise.exerciseId)?.name;
        if (catalogName && matchesAny(exercise.name)) {
          exercise.name = catalogName;
          renamed = true;
        }
      }
    }
    if (dropped) repairs.push('DROP_FORBIDDEN_SENTENCES');
    if (renamed) repairs.push('RESTORE_CATALOG_EXERCISE_NAME');
  }

  return { structure: out, repairs };
}
