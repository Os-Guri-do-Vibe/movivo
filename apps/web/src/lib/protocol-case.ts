/**
 * Leitura do caso de protocolo (publicação de treino ou alimentar) na tela de revisão: a situação
 * em linguagem humana (obrigatória × opcional, prazo), as seções do texto da IA e a trilha de
 * decisões traduzida. Nada aqui decide — as regras vêm prontas do servidor.
 */
import type { ExceptionDecision, ExceptionDetail } from '@movivo/shared';

import { capitalize } from './protocol-format';
import { actionName, humanizeReason, splitRationale, timeLeft } from './professional-queue';

export type ProtocolKind = 'TRAINING' | 'NUTRITION';

/** O caso é a publicação de um protocolo inteiro? Qual? */
export function protocolKindOf(detail: Pick<ExceptionDetail, 'proposal'>): ProtocolKind | null {
  const type = detail.proposal?.action.type;
  if (type === 'PUBLISH_TRAINING_PLAN') return 'TRAINING';
  if (type === 'PUBLISH_NUTRITION_PLAN') return 'NUTRITION';
  return null;
}

export const PROTOCOL_TITLE: Record<ProtocolKind, string> = {
  TRAINING: 'Protocolo de treino',
  NUTRITION: 'Protocolo alimentar',
};

export interface ReviewStatus {
  tone: 'attention' | 'neutral' | 'quiet';
  /** "Revisão opcional · libera automaticamente em 1 h 42 min". */
  headline: string;
  /** A consequência em uma frase. */
  detail: string;
}

/** Situação do caso em linguagem humana, sem código. */
export function reviewStatus(
  item: Pick<ExceptionDetail['case'], 'status' | 'reviewUrgency' | 'autoReleaseAt' | 'resolution'>,
  now: Date = new Date(),
): ReviewStatus {
  if (item.status === 'RESOLVED') {
    return {
      tone: 'quiet',
      headline: 'Caso encerrado',
      detail: 'Nada mais a decidir aqui. O registro fica em "Detalhes e auditoria".',
    };
  }
  if (item.reviewUrgency === 'OPTIONAL' && item.autoReleaseAt) {
    const left = timeLeft(item.autoReleaseAt, now);
    return {
      tone: 'neutral',
      headline: left
        ? `Revisão opcional · libera automaticamente em ${left}`
        : 'Revisão opcional · prazo encerrado',
      detail: left
        ? 'Se ninguém agir, o aluno recebe este protocolo ao fim do prazo. Com esta tela aberta, o envio espera você.'
        : 'O envio está esperando você terminar esta revisão.',
    };
  }
  return {
    tone: 'attention',
    headline: 'Revisão obrigatória · sem envio automático',
    detail: 'O aluno só recebe este protocolo depois que você revisar e liberar.',
  };
}

export interface ProtocolCaseSections {
  rationale: string[];
  coordinator: string[];
  posture: ReturnType<typeof splitRationale>['posture'];
  assumptions: string[];
  reasons: ReturnType<typeof humanizeReason>[];
}

/** O texto longo da IA separado em seções com rótulo (nunca um parágrafo corrido). */
export function caseSections(detail: Pick<ExceptionDetail, 'proposal' | 'decision'>) {
  const split = detail.proposal ? splitRationale(detail.proposal.rationale) : null;
  return {
    rationale: split?.rationale ?? [],
    // O parecer do coordenador vem em frases corridas: um tópico por frase.
    coordinator: (split?.coordinator ?? []).flatMap(sentences),
    posture: split?.posture ?? [],
    assumptions: detail.proposal?.assumptions ?? [],
    reasons: detail.decision?.reasons.map(humanizeReason) ?? [],
  } satisfies ProtocolCaseSections;
}

/** "Confirmar a carga. A leitura da IA é limitada." → um item por frase. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

const VERDICT_LABEL: Record<string, string> = {
  EXECUTE: 'executada',
  ASK: 'enviada à Fila para revisão',
  ESCALATE: 'exigiu um profissional',
  BLOCK: 'bloqueada',
};

/** Uma linha da trilha de decisões: "Publicar o protocolo de treino · executada pelo profissional". */
export function decisionLine(row: Pick<ExceptionDecision, 'action' | 'verdict' | 'decidedBy'>): {
  action: string;
  outcome: string;
} {
  const verdict = row.verdict ? (VERDICT_LABEL[row.verdict] ?? row.verdict.toLowerCase()) : null;
  const by =
    row.decidedBy === 'STAFF' ? ' pelo profissional' : row.verdict ? ' pelas políticas' : '';
  return {
    action: capitalize(actionName(row.action)),
    outcome: verdict ? `${verdict}${by}` : 'sem decisão',
  };
}
