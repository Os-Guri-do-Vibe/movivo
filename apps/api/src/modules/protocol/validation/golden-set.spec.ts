/**
 * Unit — Golden set / faithfulness do ValidationService (US-2.7 / TASK-2.7.1). GATE BLOQUEANTE.
 *
 * Faithfulness DETERMINÍSTICA (sem chave de LLM): roda o validador REAL sobre cada saída de
 * geração do golden set e exige classificação 100% correta. Prova a tese da sprint — "a IA
 * planejou dentro dos trilhos e o validador vetou tudo que saiu deles". Se a geração inventar
 * exercício, fugir da faixa ou vazar termo proibido, o caso adversarial correspondente falha.
 *
 * O LLM-as-judge com modelo real (RAGAS-style) é OPCIONAL e fica atrás de guarda de chave,
 * `skip` no CI — este runner é o gate que morde em todo PR.
 */
import { describe, expect, it } from 'vitest';

import { EXERCISE_BY_ID } from '../exercise-catalog';
import { GOLDEN_SET } from './golden-set.fixture';
import { ValidationService } from './validation.service';

const service = new ValidationService();

describe(`golden set — faithfulness à base/metodologia (${GOLDEN_SET.length} casos)`, () => {
  it.each(GOLDEN_SET.map((c) => [c.label, c] as const))(
    'classifica corretamente: %s',
    (_label, testCase) => {
      const verdict = service.validate(testCase.input);
      expect(verdict.action).toBe(testCase.expected);
      if (testCase.expectRule) {
        expect(verdict.violations.map((v) => v.rule)).toContain(testCase.expectRule);
      }
    },
  );

  it('accuracy = 100% (meta faithfulness ≥0.9) sobre todo o golden set', () => {
    const total = GOLDEN_SET.length;
    const correct = GOLDEN_SET.filter(
      (c) => service.validate(c.input).action === c.expected,
    ).length;
    expect(correct / total).toBe(1); // 1.0 ≥ 0.9
  });

  it('todo caso LIMPO só usa exercícios existentes na base (fidelidade ao vocabulário)', () => {
    const cleanExerciseIds = GOLDEN_SET.filter((c) => c.kind === 'clean').flatMap((c) =>
      c.input.structure.sessions.flatMap((s) => s.exercises.map((e) => e.exerciseId)),
    );
    expect(cleanExerciseIds.length).toBeGreaterThan(0);
    for (const id of cleanExerciseIds) expect(EXERCISE_BY_ID.has(id)).toBe(true);
  });

  it('todo caso ADVERSARIAL é vetado ou sinalizado — nenhum passa como PASS', () => {
    for (const c of GOLDEN_SET.filter((x) => x.kind === 'adversarial')) {
      expect(service.validate(c.input).action).not.toBe('PASS');
    }
  });
});
