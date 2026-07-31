/**
 * Unit — Golden set conversacional / faithfulness do diálogo (US-3.7 / TASK-3.7.1). GATE BLOQUEANTE.
 *
 * Faithfulness DETERMINÍSTICA (sem chave de LLM): roda o guardrail clínico, a substituição fiel
 * à base e o `validateResponse` REAIS sobre o golden set conversacional e exige classificação
 * 100% correta. Prova a tese da sprint — "MOVI responde dentro dos trilhos; o inseguro é vetado":
 * roteamento de entrada correto, substituição sempre da base (nunca inventa/contraindicado) e
 * 0% de orientação médica direta na saída. LLM-as-judge com modelo real fica opcional/`skip` no CI.
 */
import { describe, expect, it } from 'vitest';

import { clinicalGuardrail } from '../ai-coach/intent/clinical-guardrail';
import { EXERCISE_BY_ID } from '../protocol/exercise-catalog';
import { findExerciseByMention, findSafeSubstitute } from '../protocol/exercise-substitution';
import { ValidationService } from '../protocol/validation/validation.service';
import {
  GUARDRAIL_CASES,
  RESPONSE_CASES,
  SUBSTITUTION_CASES,
} from './conversation-golden-set.fixture';

const validation = new ValidationService();

describe(`golden set conversacional — roteamento de entrada (${GUARDRAIL_CASES.length} casos)`, () => {
  it.each(GUARDRAIL_CASES.map((c) => [c.label, c] as const))('%s', (_label, c) => {
    expect(clinicalGuardrail(c.message)).toBe(c.expected);
  });

  it('accuracy = 100% (meta ≥0.9) no roteamento de entrada', () => {
    const correct = GUARDRAIL_CASES.filter(
      (c) => clinicalGuardrail(c.message) === c.expected,
    ).length;
    expect(correct / GUARDRAIL_CASES.length).toBe(1);
  });

  it('0% de orientação médica direta segue para o LLM (medicamento/dieta são cortados no guardrail)', () => {
    const medicalOrDiet = GUARDRAIL_CASES.filter((c) => c.expected === 'SCOPE');
    expect(medicalOrDiet.length).toBeGreaterThan(0);
    for (const c of medicalOrDiet) expect(clinicalGuardrail(c.message)).toBe('SCOPE');
  });
});

describe(`golden set conversacional — validação da saída (${RESPONSE_CASES.length} casos)`, () => {
  it.each(RESPONSE_CASES.map((c) => [c.label, c] as const))('%s', (_label, c) => {
    const verdict = validation.validateResponse(
      c.text,
      c.allowedExercises ? { allowedExercises: c.allowedExercises } : {},
    );
    expect(verdict.action).toBe(c.expected);
    if (c.expectRule) expect(verdict.violations.map((v) => v.rule)).toContain(c.expectRule);
  });

  it('nenhuma resposta com orientação médica direta passa como PASS', () => {
    const medical = RESPONSE_CASES.filter((c) => c.expectRule === 'MED_PRESCRIPTION');
    expect(medical.length).toBeGreaterThan(0);
    for (const c of medical) {
      expect(validation.validateResponse(c.text).action).toBe('BLOCK_FALLBACK');
    }
  });
});

describe('golden set conversacional — substituição fiel à base (US-3.5)', () => {
  it.each(SUBSTITUTION_CASES.map((c) => [c.label, c] as const))('%s', (_label, c) => {
    const target = findExerciseByMention(c.message);
    expect(target).not.toBeNull();
    const substitute = target ? findSafeSubstitute(target, c.constraints) : null;

    if (!c.expectSubstitute) {
      expect(substitute).toBeNull(); // não inventa: sem substituto seguro → fallback humano
      return;
    }
    expect(substitute).not.toBeNull();
    if (substitute) {
      expect(EXERCISE_BY_ID.has(substitute.id)).toBe(true); // sempre da base
      // Nunca contraindicado pela lesão do usuário.
      for (const tag of c.constraints.injuryTags) {
        expect(substitute.contraindicatedFor).not.toContain(tag);
      }
    }
  });
});
