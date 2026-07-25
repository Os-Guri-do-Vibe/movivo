/**
 * Gate PAR-Q — avaliação **determinística** (US-1.3 / TASK-1.3.3 · Alexandre §2.2).
 *
 * Regra única e verbatim do mapa do Alexandre: **"Sim" em QUALQUER uma de Q1..Q9
 * dispara o bloqueio** (comportamento clássico do PAR-Q — uma afirmativa já exige
 * avaliação profissional). São 9 gatilhos, um por pergunta; não há pergunta neutra.
 *
 * Sem IA (regra §12.4/§12.5). Sem linguagem de diagnóstico no retorno — só o estado.
 */
import { ParqState, type AnamnesisBlock2, type ParqQuestionId } from '@movivo/shared';

export interface ParqEvaluation {
  parqState: ParqState;
  requiresProfessionalReview: boolean;
  /** Quais perguntas dispararam (para o RT ver no dashboard — Sprint 5). */
  triggeredQuestions: ParqQuestionId[];
}

/**
 * Avalia o PAR-Q do bloco 2. Qualquer resposta `answer === true` ("Sim") bloqueia.
 * `BLOQUEADO_AGUARDANDO_CLEARANCE` é uma TRAVA: impede geração automática de
 * protocolo (nem na Sprint 2). O desbloqueio é ato humano do RT.
 */
export function evaluateParq(block2: AnamnesisBlock2): ParqEvaluation {
  const triggeredQuestions = block2.parq.answers
    .filter((a) => a.answer === true)
    .map((a) => a.questionId);

  const blocked = triggeredQuestions.length > 0;

  return {
    parqState: blocked ? ParqState.BLOQUEADO_AGUARDANDO_CLEARANCE : ParqState.LIBERADO,
    requiresProfessionalReview: blocked,
    triggeredQuestions,
  };
}
