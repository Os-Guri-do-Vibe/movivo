/**
 * Avaliação de segurança do formulário de troca de protocolo por fim de mesociclo.
 *
 * Determinística, sem IA — mesmo espírito de `apps/api/src/modules/anamnesis/parq.ts`,
 * mas para as duas perguntas de segurança do formulário de renovação (Bloco 3):
 *
 *  - **Pergunta 10** (repescagem do PAR-Q original) é quem reaciona a MESMA trava do
 *    PAR-Q inicial: uma resposta que mudou de "Não" para "Sim" bloqueia exatamente como
 *    um "Sim" bloqueava na anamnese — `requiresProfessionalReview: true`, teto de fase
 *    `ADAPTACAO` (aplicado pelo chamador via `UserConstraints.maxPhase`, mesmo mecanismo
 *    de `parqToConstraints`).
 *  - **Pergunta 9** (dor NOVA, sem o PAR-Q ter mudado) NÃO força revisão obrigatória por
 *    si só — vira tag de contraindicação (via `painToConstraints`, reaproveitado pelo
 *    chamador) e, quando a intensidade for alta ou a tendência for de piora, um alerta de
 *    handoff para a fila do profissional (mesmo padrão de `CheckinService.createAlert`).
 *    Decisão do fundador: só a pergunta 10 gate obrigatoriamente o protocolo.
 */
import type { ProtocolRenewalBlock3 } from '@movivo/shared';

export interface RenewalSafetyEvaluation {
  /** `true` só quando a pergunta 10 (repescagem do PAR-Q) veio "Sim". */
  requiresProfessionalReview: boolean;
  /** Dor nova relatada na pergunta 9 — sempre visível ao CREF, nunca trava por si só. */
  newPainReported: boolean;
  /**
   * `true` quando a dor nova relatada merece alerta de handoff (intensidade alta OU
   * tendência de piora) — mesmo limiar conservador do `SAFETY_SIGNAL` do check-in.
   */
  newPainNeedsHandoff: boolean;
}

/** Intensidade (0-10) a partir da qual a dor nova por si só já justifica um alerta. */
const HIGH_INTENSITY_THRESHOLD = 7;

export function evaluateRenewalSafety(block3: ProtocolRenewalBlock3): RenewalSafetyEvaluation {
  const { newPain, parqRecheck } = block3;
  // ADR-008 (campo órfão `soughtCare`, Victor): tendência de piora escala o alerta
  // sempre, independente de acompanhamento — uma trajetória piorando merece um novo olhar
  // mesmo para quem já é acompanhado. Intensidade alta ISOLADA (sem piora) só escala
  // quando NÃO há avaliação profissional em curso: dor já sob acompanhamento não precisa
  // do mesmo grau de conservadorismo que dor não avaliada por ninguém.
  const newPainNeedsHandoff =
    newPain.hasNewPain &&
    (newPain.trend === 'WORSENING' ||
      (!newPain.soughtCare && (newPain.intensity ?? 0) >= HIGH_INTENSITY_THRESHOLD));

  return {
    requiresProfessionalReview: parqRecheck.changedToYes,
    newPainReported: newPain.hasNewPain,
    newPainNeedsHandoff,
  };
}
