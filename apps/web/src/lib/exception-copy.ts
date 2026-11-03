/** Textos do painel para a fila de exceções: nada aqui decide, só descreve em português claro. */
import {
  DECLARED_GOAL_LABELS,
  type DeclaredGoalKind,
  type ExceptionDomain,
  type ExceptionListItem,
} from '@movivo/shared';

export const KIND_LABEL: Record<ExceptionListItem['kind'], string> = {
  SAFETY: 'Sinal de segurança',
  NO_APPLICABLE_POLICY: 'Precisa de decisão humana',
  PROTOCOL_REVIEW: 'Protocolo para revisão',
  STUDENT_REVIEW_REQUEST: 'Aluno pediu revisão',
  DECISION_FAILURE: 'Falha ao gerar o protocolo',
  CONVERSATION_TAKEOVER: 'Conversa assumida',
  MEDICAL_EXAM: 'Exame enviado',
};

export const DOMAIN_LABEL: Record<ExceptionDomain, string> = {
  TRAINING: 'Treino',
  NUTRITION: 'Nutrição',
  MEDICAL: 'Médico',
  GENERAL: 'Geral',
};

export const PRIORITY_LABEL: Record<ExceptionListItem['priority'], string> = {
  URGENT: 'Urgente',
  HIGH: 'Alta',
  NORMAL: 'Normal',
  LOW: 'Baixa',
};

export const UNCERTAINTY_LABEL = { LOW: 'baixa', MEDIUM: 'média', HIGH: 'alta' } as const;

/** Como o caso foi encerrado. */
export const OUTCOME_LABEL: Record<string, string> = {
  APPROVED: 'Aprovado',
  AUTO_RELEASED: 'Liberado automaticamente após a janela de revisão',
  REJECTED: 'Recusado',
  RESOLVED: 'Encerrado',
  ADJUSTMENT_REQUESTED: 'Ajuste pedido aos agentes (um novo protocolo volta para a fila)',
};

/** Ações cuja proposta é um protocolo inteiro, revisado na própria tela do caso. */
export function isProtocolAction(action: Record<string, unknown>): boolean {
  return action.type === 'PUBLISH_TRAINING_PLAN' || action.type === 'PUBLISH_NUTRITION_PLAN';
}

export function goalLabel(primary: unknown): string | null {
  return typeof primary === 'string' && primary in DECLARED_GOAL_LABELS
    ? DECLARED_GOAL_LABELS[primary as DeclaredGoalKind]
    : null;
}

/** A mudança proposta, em uma frase que o profissional entende sem abrir o JSON. */
export function describeAction(
  action: Record<string, unknown>,
  names: Readonly<Record<string, string>> = {},
): string {
  const exercise = (id: unknown) => names[String(id)] ?? String(id);
  switch (action.type) {
    case 'ADJUST_ENERGY_TARGET': {
      const delta = Number(action.deltaKcal);
      return `${delta >= 0 ? 'Aumentar' : 'Reduzir'} a meta de energia em ${Math.abs(delta)} kcal por dia.`;
    }
    case 'ADJUST_WEEKLY_VOLUME':
      return `Mudar o volume semanal de ${String(action.modality)} em ${Number(action.percentChange)}% por ${Number(action.weeks)} semana(s).`;
    case 'SHORTEN_SESSION':
      return `Encurtar uma sessão para cerca de ${Number(action.targetMinutes)} minutos.`;
    case 'SUBSTITUTE_EXERCISE':
      return `Trocar ${exercise(action.fromExerciseId)} por ${exercise(action.toExerciseId)} (${action.scope === 'PLAN' ? 'no protocolo' : 'só na próxima sessão'}).`;
    case 'RESCHEDULE_WEEK': {
      const assignments = Array.isArray(action.assignments) ? action.assignments.length : 0;
      const dropped = Array.isArray(action.dropped) ? action.dropped.length : 0;
      return `Reorganizar a semana: ${assignments} sessão(ões) agendada(s)${dropped ? `, ${dropped} fora da semana` : ''}.`;
    }
    case 'ADJUST_MEAL_GUIDANCE':
      return `Atualizar a orientação da refeição ${String(action.slot)}.`;
    case 'RECORD_PREFERENCE': {
      const preference = action.preference as Record<string, unknown> | undefined;
      return `Registrar preferência "${String(preference?.key)}" (${String(preference?.strength)}).`;
    }
    case 'RECORD_CONSTRAINT': {
      const constraint = action.constraint as Record<string, unknown> | undefined;
      return `Registrar restrição do tipo ${String(constraint?.kind)}.`;
    }
    case 'SEND_MESSAGE':
      return `Enviar ao aluno: “${String(action.text)}”`;
    case 'ASK_STUDENT':
      return `Perguntar ao aluno: “${String(action.question)}”`;
    case 'PUBLISH_TRAINING_PLAN':
      return 'Publicar o protocolo de treino abaixo e enviá-lo ao aluno.';
    case 'PUBLISH_NUTRITION_PLAN':
      return 'Publicar o protocolo alimentar abaixo e enviá-lo ao aluno.';
    case 'DEFINE_STRATEGY':
      return 'Definir a estratégia do objetivo do aluno.';
    default:
      return String(action.type ?? 'Ação desconhecida');
  }
}

/** Idade do caso em linguagem curta (“há 3 h”, “há 2 dias”). */
export function ageLabel(createdAt: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(createdAt).getTime()) / 60_000));
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `há ${hours} h`;
  return `há ${Math.round(hours / 24)} dias`;
}

/** Quanto falta para a liberação automática (“em 1 h 12 min”, “em 8 min”, “agora”). */
export function releaseCountdown(autoReleaseAt: string, now: Date = new Date()): string {
  const minutes = Math.ceil((new Date(autoReleaseAt).getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) return 'agora';
  if (minutes < 60) return `em ${minutes} min`;
  const rest = minutes % 60;
  return `em ${Math.floor(minutes / 60)} h${rest > 0 ? ` ${rest} min` : ''}`;
}
