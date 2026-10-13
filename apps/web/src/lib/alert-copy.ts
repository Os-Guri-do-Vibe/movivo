import type { DashboardAlert } from './dashboard-types';

const REASONS: Record<string, { title: string; detail: string }> = {
  RED_FLAG: {
    title: 'Sinal de segurança',
    detail: 'O aluno relatou um sinal que requer atenção prioritária.',
  },
  PEDIDO_HANDOFF: {
    title: 'Acompanhamento solicitado',
    detail: 'O aluno pediu contato ou acompanhamento humano.',
  },
  SUBSTITUTION_PAIN: {
    title: 'Dor ou limitação em exercício',
    detail: 'A substituição de exercício precisa de revisão profissional.',
  },
  VALIDATOR_BLOCK: {
    title: 'Resposta bloqueada por segurança',
    detail: 'O AI Coach não enviou uma resposta sem validação adequada.',
  },
  VALIDATOR_FLAG: {
    title: 'Revisão técnica solicitada',
    detail: 'O AI Coach sinalizou esta conversa para acompanhamento.',
  },
  L1_GUARDRAIL_FLAG: {
    title: 'Revisão das regras do AI Coach',
    detail: 'As regras de segurança pediram supervisão humana.',
  },
  AGENT_CONFIG_UNAVAILABLE: {
    title: 'AI Coach indisponível com segurança',
    detail: 'A configuração necessária para responder não estava disponível.',
  },
  FORA_DE_ESCOPO: {
    title: 'Assunto fora do escopo do AI Coach',
    detail: 'A conversa foi encaminhada para acompanhamento profissional.',
  },
  DOR_APOS_TREINO: {
    title: 'Dor relatada após o treino',
    detail: 'O relato precisa de avaliação profissional antes de qualquer orientação.',
  },
  FALTAS_SEGUIDAS: {
    title: 'Faltas seguidas nos treinos',
    detail:
      'O aluno faltou pela 3ª sessão de treino seguida. Entre em contato para entender o motivo.',
  },
  FALTAS_FREQUENTES: {
    title: 'Muitas faltas nos treinos',
    detail:
      'O aluno faltou a mais de 60% das sessões de treino das últimas duas semanas. Entre em contato para entender o motivo.',
  },
  AUSENCIA_DOR: {
    title: 'Dor como motivo de treino sem registro',
    detail:
      'O aluno disse que não treinou por dor ou desconforto. O relato precisa de avaliação profissional.',
  },
  AJUSTE_DURACAO_SOLICITADO: {
    title: 'Ajuste de duração solicitado',
    detail: 'O aluno precisa de uma adaptação que requer avaliação profissional.',
  },
  RENOVACAO_DOR_NOVA: {
    title: 'Nova dor na renovação',
    detail: 'A renovação do protocolo foi encaminhada para revisão profissional.',
  },
  CHECKIN_AJUSTE_VOLUME_APLICADO: {
    title: 'Ajuste de volume para acompanhar',
    detail:
      'Um ajuste previsto nas regras do protocolo foi aplicado e aguarda acompanhamento do profissional CREF.',
  },
};

const SOURCES: Record<string, string> = {
  WORKOUT: 'Treino',
  WORKOUT_INSIGHT: 'Acompanhamento de treino',
  CHECKIN: 'Check-in semanal',
  CONVERSATION: 'Conversa',
  PROTOCOL_RENEWAL: 'Renovação de protocolo',
  ATTENDANCE_STREAK: 'Frequência de treino',
  ATTENDANCE_RATE: 'Frequência de treino',
};

/**
 * Alertas de frequência falam do aluno pelo nome completo: o profissional CREF precisa saber
 * a quem ligar sem abrir o detalhe. Sem nome, cai no texto genérico de `REASONS`.
 */
const WITH_STUDENT_NAME: Record<string, (name: string) => string> = {
  FALTAS_SEGUIDAS: (name) =>
    `O aluno ${name} faltou pela 3ª sessão de treino seguida. Entre em contato para entender o motivo.`,
  FALTAS_FREQUENTES: (name) =>
    `O aluno ${name} faltou a mais de 60% das sessões de treino das últimas duas semanas. Entre em contato para entender o motivo.`,
};

export function alertCopyFor(
  alert: Pick<DashboardAlert, 'level' | 'reason'> & { studentName?: string | null },
) {
  const known = REASONS[alert.reason];
  const personalized = WITH_STUDENT_NAME[alert.reason];
  if (known && personalized && alert.studentName?.trim()) {
    return { ...known, detail: personalized(alert.studentName.trim()) };
  }
  return (
    known ?? {
      title:
        alert.level === 'SAFETY' ? 'Sinal de segurança' : 'Acompanhamento solicitado pelo AI Coach',
      detail: 'O AI Coach encaminhou este caso para supervisão profissional.',
    }
  );
}

export function alertSourceLabel(sourceType: string | null): string | null {
  return sourceType ? (SOURCES[sourceType] ?? 'Acompanhamento') : null;
}

/** Texto da seção "O que gerou este alerta" para origens que não são uma conversa. */
const ORIGIN_NOTES: Record<string, string> = {
  WORKOUT: 'Gerado a partir do registro de treino do aluno.',
  WORKOUT_INSIGHT: 'Gerado a partir do acompanhamento da duração dos treinos.',
  CHECKIN: 'Gerado a partir do check-in semanal.',
  PROTOCOL_RENEWAL: 'Gerado durante a renovação do protocolo.',
  ATTENDANCE_STREAK: 'Gerado a partir da frequência de treinos do aluno.',
  ATTENDANCE_RATE: 'Gerado a partir da frequência de treinos do aluno.',
};

export function alertOriginNote(sourceType: string | null): string | null {
  return sourceType ? (ORIGIN_NOTES[sourceType] ?? null) : null;
}

/** `sourceType` nulo ou `CONVERSATION`: o alerta nasceu de uma mensagem do aluno. */
export function isConversationSource(sourceType: string | null): boolean {
  return sourceType === null || sourceType === 'CONVERSATION';
}

export const ALERT_LEVEL_LABEL = { SAFETY: 'Segurança', ALERT: 'Atenção' } as const;

/** Motivos de resolução. Sem opção pré-marcada: registrar o caso exige uma escolha explícita. */
export const RESOLUTION_REASONS = [
  'Contato realizado e orientação registrada',
  'Protocolo ajustado pelo profissional',
  'Aluno orientado a procurar um profissional de saúde',
  'Sem necessidade de intervenção',
] as const;
