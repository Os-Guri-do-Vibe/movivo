/**
 * Duração do mesociclo/fase do protocolo, em semanas (achado 2026-09-02, correção do
 * fundador).
 *
 * Antes: `total_weeks` (e por consequência `end_date`) vinha de um padrão ESTÁTICO de 12
 * semanas para todo mundo, ou do evento-alvo declarado na anamnese (Seção 4 "Data-alvo") —
 * nos dois casos, sem NENHUMA relação com a fase (`phase`) de fato escolhida pela IA para
 * aquele bloco. Um protocolo em DELOAD (1 semana) e um em HIPERTROFIA (4-6 semanas) tinham
 * exatamente o mesmo horizonte, e a "data de término" nunca respondia à pergunta real —
 * "até quando vale este mesociclo?" — só a "quando é o evento do aluno?" (ou nada).
 *
 * Correto: `start_date` é a data de entrega do protocolo ao aluno (mesma data de
 * preenchimento do formulário — a persistência já usa `new Date()` no momento da geração,
 * ver `protocol.repository.ts`); `end_date` é a data prevista de término DAQUELE mesociclo,
 * derivada da duração que a IA decide para a fase escolhida — ela mesma dentro da faixa
 * baseada em evidência abaixo, nunca hardcoded. A IA declara essa duração no campo
 * `phaseDurationWeeks` do `ProtocolStructure` (packages/shared); o `ValidationService` veta
 * (BLOCK) qualquer valor fora da faixa da fase declarada — mesmo raciocínio de
 * defesa-em-profundidade de `REPS_OUT_OF_RANGE`/`DURATION_OUT_OF_RANGE`, nunca confiar só
 * no prompt. O evento-alvo da anamnese deixa de influenciar `total_weeks`: ele é dado de
 * contexto para a IA (objetivo/urgência), não fonte de prazo do mesociclo.
 */
import type { TrainingPhase } from '@movivo/shared';

export interface PhaseDurationRange {
  readonly minWeeks: number;
  readonly maxWeeks: number;
  /** Citação curta da base de evidência — usada no prompt de geração (grounding, não decoração). */
  readonly evidence: string;
}

/**
 * Faixas por fase (fonte: metodologia do RT, conforme repassada pelo fundador 2026-09-02):
 *
 *  - ADAPTACAO: 2-4 semanas — convenção clássica de periodização (modelo de Bompa).
 *  - HIPERTROFIA: 4-6 semanas — consenso entre entidades de certificação, dentro da faixa
 *    geral aceita de mesociclo (2-8 semanas).
 *  - FORCA: 4-6 semanas — mesma faixa do bloco de hipertrofia.
 *  - DELOAD: 1 semana (5-7 dias) — consenso Delphi estruturado entre especialistas +
 *    levantamento com atletas competitivos (Bell et al., 2023, 2024), a base mais robusta
 *    das quatro. Frequência ENTRE deloads (3-5 semanas para avançados, 6-8 semanas para
 *    iniciantes/intermediários) é contexto de PROMPT para quando escolher a fase, não afeta
 *    a duração deste campo — um bloco de deload dura 1 semana, sempre.
 */
export const PHASE_DURATION_WEEKS_RANGE: Readonly<Record<TrainingPhase, PhaseDurationRange>> = {
  ADAPTACAO: {
    minWeeks: 2,
    maxWeeks: 4,
    evidence: 'Convenção clássica de periodização (modelo de Bompa).',
  },
  HIPERTROFIA: {
    minWeeks: 4,
    maxWeeks: 6,
    evidence:
      'Consenso entre entidades de certificação, dentro da faixa geral aceita de mesociclo (2-8 semanas).',
  },
  FORCA: {
    minWeeks: 4,
    maxWeeks: 6,
    evidence: 'Mesma faixa de evidência do bloco de hipertrofia.',
  },
  DELOAD: {
    minWeeks: 1,
    maxWeeks: 1,
    evidence:
      'Consenso Delphi estruturado entre especialistas + levantamento com atletas competitivos ' +
      '(Bell et al., 2023, 2024) — a base mais robusta das quatro.',
  },
};

/** `true` quando `weeks` está dentro da faixa baseada em evidência da fase declarada. */
export function isPhaseDurationWithinRange(phase: TrainingPhase, weeks: number): boolean {
  const range = PHASE_DURATION_WEEKS_RANGE[phase];
  return weeks >= range.minWeeks && weeks <= range.maxWeeks;
}
