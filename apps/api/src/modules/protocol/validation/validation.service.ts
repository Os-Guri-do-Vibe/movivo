/**
 * ValidationService — veto determinístico sobre o TREINO INTEIRO (US-2.3, pedra angular).
 *
 * Com a rejeição do motor determinístico, a segurança do produto mora aqui. Duas camadas,
 * <100ms, sem I/O:
 *  1. **Estrutural** (gabarito = base de referência + constraints): todo exercício existe;
 *     nenhum contraindicado pela lesão/PAR-Q; carga/volume/descanso em faixa plausível.
 *  2. **Linguagem/compliance**: sem prescrição/diagnóstico/promessa/violação-PAR-Q/leak.
 *
 * Falha dura → `BLOCK_FALLBACK` (o Worker regenera com fallback de modelo e, persistindo,
 * cai no template pré-aprovado). Falha leve → `FLAG_HUMAN_REVIEW` (roteia sem bloquear).
 * O `code` alimenta `ai_jobs.validation_action` (PASS|FLAG|BLOCK).
 */
import { Injectable } from '@nestjs/common';
import type { ProtocolStructure } from '@movivo/shared';

import { type ContraindicationTag, EXERCISE_BY_ID, EXERCISE_CATALOG } from '../exercise-catalog';
import type { UserConstraints } from '../user-constraints';
import { containsPromptLeak } from './prompt-injection';
import {
  inRange,
  LANGUAGE_RULES,
  REPS_RANGE_BY_GOAL,
  REST_SECONDS_RANGE,
  SETS_RANGE,
  type ValidationActionCode,
} from './validation-rules';

export type ValidationAction = 'PASS' | 'FLAG_HUMAN_REVIEW' | 'BLOCK_FALLBACK';

export interface ValidationViolation {
  rule: string;
  detail: string;
  action: Extract<ValidationActionCode, 'BLOCK' | 'FLAG'>;
}

export interface ValidationVerdict {
  action: ValidationAction;
  /** Valor para `ai_jobs.validation_action`. */
  code: ValidationActionCode;
  /** O Worker (US-2.4) marca o protocolo e roteia ao painel CREF quando `true`. */
  humanReviewRequired: boolean;
  violations: ValidationViolation[];
}

export interface ValidateProtocolInput {
  structure: ProtocolStructure;
  constraints: Pick<UserConstraints, 'goal' | 'injuryTags'>;
  /** Flags de PAR-Q extras (defesa; sessão de risco já é travada no Worker). */
  parqFlags?: ContraindicationTag[];
}

export interface ValidateResponseOptions {
  /**
   * SUBSTITUICAO_EXERCICIO (US-3.5): nomes/ids de exercícios que a RESPOSTA pode citar (o
   * original + o substituto aprovado da base). Qualquer OUTRO exercício do catálogo citado
   * → BLOCK (a IA saiu do trilho). `undefined` = intenção sem restrição de exercício.
   */
  allowedExercises?: readonly string[];
}

@Injectable()
export class ValidationService {
  /** Veredito determinístico sobre o protocolo inteiro. Nunca lança — sempre devolve. */
  validate(input: ValidateProtocolInput): ValidationVerdict {
    const violations: ValidationViolation[] = [];
    const excluded = new Set<ContraindicationTag>([
      ...input.constraints.injuryTags,
      ...(input.parqFlags ?? []),
    ]);

    this.checkStructure(input.structure, input.constraints.goal, excluded, violations);
    this.checkParq(input.structure, input.parqFlags ?? [], violations);
    this.checkLanguage(collectText(input.structure), violations);

    return aggregate(violations);
  }

  /**
   * Veta uma RESPOSTA conversacional em TEXTO livre (US-3.5). REUSA as regras de
   * linguagem/compliance/leak da validação de protocolo (não reimplementa) e, para
   * substituição de exercício, confirma que a resposta só cita exercícios autorizados da base.
   * Nunca lança — sempre devolve um veredito.
   */
  validateResponse(text: string, opts: ValidateResponseOptions = {}): ValidationVerdict {
    const violations: ValidationViolation[] = [];
    this.checkLanguage(text, violations);
    this.checkAllowedExercises(text, opts.allowedExercises, violations);
    return aggregate(violations);
  }

  /** Substituição: a resposta não pode empurrar um exercício da base fora do autorizado. */
  private checkAllowedExercises(
    text: string,
    allowed: readonly string[] | undefined,
    out: ValidationViolation[],
  ): void {
    if (!allowed) return; // só a substituição restringe o vocabulário de exercícios
    const lower = text.toLowerCase();
    const allowedSet = new Set(allowed.map((a) => a.toLowerCase()));
    for (const ex of EXERCISE_CATALOG) {
      if (allowedSet.has(ex.name.toLowerCase()) || allowedSet.has(ex.id)) continue;
      if (lower.includes(ex.name.toLowerCase())) {
        out.push({
          rule: 'EXERCISE_NOT_ALLOWED',
          detail: `resposta cita exercício não autorizado: ${ex.id}`,
          action: 'BLOCK',
        });
      }
    }
  }

  private checkStructure(
    structure: ProtocolStructure,
    goal: ValidateProtocolInput['constraints']['goal'],
    excluded: Set<ContraindicationTag>,
    out: ValidationViolation[],
  ): void {
    const repsRange = REPS_RANGE_BY_GOAL[goal];
    for (const session of structure.sessions) {
      for (const ex of session.exercises) {
        const catalog = EXERCISE_BY_ID.get(ex.exerciseId);
        if (!catalog) {
          out.push({
            rule: 'EXERCISE_UNKNOWN',
            detail: `exercício fora da base: ${ex.exerciseId}`,
            action: 'BLOCK',
          });
          continue; // sem entrada na base, não há como checar contraindicação
        }
        const clash = catalog.contraindicatedFor.filter((t) => excluded.has(t));
        if (clash.length > 0) {
          out.push({
            rule: 'EXERCISE_CONTRAINDICATED',
            detail: `${ex.exerciseId} contraindicado por ${clash.join(',')}`,
            action: 'BLOCK',
          });
        }
        if (!inRange(ex.sets, SETS_RANGE)) {
          out.push({
            rule: 'SETS_OUT_OF_RANGE',
            detail: `${ex.exerciseId}: ${ex.sets} séries`,
            action: 'BLOCK',
          });
        }
        if (!inRange(ex.reps.min, repsRange) || !inRange(ex.reps.max, repsRange)) {
          out.push({
            rule: 'REPS_OUT_OF_RANGE',
            detail: `${ex.exerciseId}: ${ex.reps.min}-${ex.reps.max} reps`,
            action: 'BLOCK',
          });
        }
        if (!inRange(ex.restSeconds, REST_SECONDS_RANGE)) {
          out.push({
            rule: 'REST_OUT_OF_RANGE',
            detail: `${ex.exerciseId}: ${ex.restSeconds}s`,
            action: 'BLOCK',
          });
        }
      }
    }
  }

  private checkParq(
    structure: ProtocolStructure,
    parqFlags: readonly ContraindicationTag[],
    out: ValidationViolation[],
  ): void {
    // PAR-Q sinalizado não pode receber pico de intensidade (fase FORCA).
    if (parqFlags.length > 0 && structure.phase === 'FORCA') {
      out.push({
        rule: 'PARQ_VIOLATION',
        detail: 'fase FORCA com flag de PAR-Q presente',
        action: 'BLOCK',
      });
    }
  }

  private checkLanguage(text: string, out: ValidationViolation[]): void {
    for (const rule of LANGUAGE_RULES) {
      if (rule.pattern.test(text)) {
        out.push({
          rule: rule.id,
          detail: 'termo/expressão proibida na saída',
          action: rule.action,
        });
      }
    }
    if (containsPromptLeak(text)) {
      out.push({
        rule: 'PROMPT_LEAK',
        detail: 'saída contém trecho do system prompt',
        action: 'BLOCK',
      });
    }
  }
}

/** Concatena todo o texto livre do protocolo (o que pode carregar linguagem proibida/leak). */
function collectText(structure: ProtocolStructure): string {
  const parts: string[] = [structure.generalNotes ?? ''];
  for (const session of structure.sessions) {
    parts.push(session.dayLabel, session.focus);
    for (const ex of session.exercises) parts.push(ex.name, ex.notes ?? '');
  }
  return parts.join('\n');
}

/** Deriva a ação final: qualquer BLOCK → fallback; senão qualquer FLAG → revisão; senão PASS. */
function aggregate(violations: ValidationViolation[]): ValidationVerdict {
  if (violations.some((v) => v.action === 'BLOCK')) {
    return { action: 'BLOCK_FALLBACK', code: 'BLOCK', humanReviewRequired: true, violations };
  }
  if (violations.some((v) => v.action === 'FLAG')) {
    return { action: 'FLAG_HUMAN_REVIEW', code: 'FLAG', humanReviewRequired: true, violations };
  }
  return { action: 'PASS', code: 'PASS', humanReviewRequired: false, violations };
}
