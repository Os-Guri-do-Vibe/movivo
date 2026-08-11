/**
 * Unitários do gate PAR-Q determinístico (US-1.3 / Alexandre §2.2).
 *
 * A regra é: "Sim" em QUALQUER Q1..Q9 bloqueia. São 9 gatilhos. Estes testes são a
 * prova de que a trava não vira flag por regressão.
 */
import { PARQ_QUESTION_IDS, PARQ_VERSION, ParqState, type Parq } from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import { evaluateParq } from './parq';

/** Bloco de saúde com todas as respostas "Não", exceto os ids passados como "Sim". */
function block2(...yes: string[]): { parq: Parq } {
  return {
    parq: {
      version: PARQ_VERSION,
      answers: PARQ_QUESTION_IDS.map((questionId) => ({
        questionId,
        answer: yes.includes(questionId),
        ...(questionId === 'Q9' && yes.includes('Q9') ? { detail: 'motivo' } : {}),
      })),
    },
  };
}

describe('evaluateParq', () => {
  it('sem nenhuma resposta de risco → LIBERADO, sem revisão', () => {
    const r = evaluateParq(block2());
    expect(r.parqState).toBe(ParqState.LIBERADO);
    expect(r.requiresProfessionalReview).toBe(false);
    expect(r.triggeredQuestions).toHaveLength(0);
  });

  it.each(PARQ_QUESTION_IDS)('um "Sim" em %s já bloqueia', (id) => {
    const r = evaluateParq(block2(id));
    expect(r.parqState).toBe(ParqState.BLOQUEADO_AGUARDANDO_CLEARANCE);
    expect(r.requiresProfessionalReview).toBe(true);
    expect(r.triggeredQuestions).toEqual([id]);
  });

  it('múltiplos "Sim" são todos registrados como gatilho', () => {
    const r = evaluateParq(block2('Q1', 'Q6', 'Q9'));
    expect(r.requiresProfessionalReview).toBe(true);
    expect(r.triggeredQuestions).toEqual(['Q1', 'Q6', 'Q9']);
  });

  it('cobre os 9 gatilhos previstos por Alexandre', () => {
    expect(PARQ_QUESTION_IDS).toHaveLength(9);
  });
});
