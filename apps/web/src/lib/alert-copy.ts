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
  AJUSTE_DURACAO_SOLICITADO: {
    title: 'Ajuste de duração solicitado',
    detail: 'O aluno precisa de uma adaptação que requer avaliação profissional.',
  },
  RENOVACAO_DOR_NOVA: {
    title: 'Nova dor na renovação',
    detail: 'A renovação do protocolo foi encaminhada para revisão profissional.',
  },
  CHECKIN_AJUSTE_VOLUME_APLICADO: {
    title: 'Ajuste de volume aplicado',
    detail: 'O AI Coach aplicou um ajuste que precisa de acompanhamento profissional.',
  },
};

const SOURCES: Record<string, string> = {
  WORKOUT: 'Treino',
  WORKOUT_INSIGHT: 'Acompanhamento de treino',
  CHECKIN: 'Check-in semanal',
  CONVERSATION: 'Conversa',
  PROTOCOL_RENEWAL: 'Renovação de protocolo',
};

export function alertCopyFor(alert: DashboardAlert) {
  return (
    REASONS[alert.reason] ?? {
      title:
        alert.level === 'SAFETY' ? 'Sinal de segurança' : 'Acompanhamento solicitado pelo AI Coach',
      detail: 'O AI Coach encaminhou este caso para supervisão profissional.',
    }
  );
}

export function alertSourceLabel(sourceType: string | null): string | null {
  return sourceType ? (SOURCES[sourceType] ?? 'Acompanhamento') : null;
}
