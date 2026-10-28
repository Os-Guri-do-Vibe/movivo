/** Textos do painel para a fila de exceções: nada aqui decide, só descreve em português claro. */
import {
  COUNCIL_LABELS,
  DECLARED_GOAL_LABELS,
  type Council,
  type DeclaredGoalKind,
  type ExceptionDomain,
  type ExceptionListItem,
} from '@movivo/shared';

export const KIND_LABEL: Record<ExceptionListItem['kind'], string> = {
  SAFETY: 'Sinal de segurança',
  NO_APPLICABLE_POLICY: 'Precisa de decisão humana',
  STUDENT_REVIEW_REQUEST: 'Aluno pediu revisão',
  DECISION_FAILURE: 'Falha ao executar',
  CONVERSATION_TAKEOVER: 'Conversa assumida',
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

export function councilLabel(council: Council): string {
  return COUNCIL_LABELS[council];
}

export function goalLabel(primary: unknown): string | null {
  return typeof primary === 'string' && primary in DECLARED_GOAL_LABELS
    ? DECLARED_GOAL_LABELS[primary as DeclaredGoalKind]
    : null;
}

const WEEKDAYS: Record<string, string> = {
  MON: 'segunda',
  TUE: 'terça',
  WED: 'quarta',
  THU: 'quinta',
  FRI: 'sexta',
  SAT: 'sábado',
  SUN: 'domingo',
};

/** A mudança proposta, em uma frase que o profissional entende sem abrir o JSON. */
export function describeAction(action: Record<string, unknown>): string {
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
      return `Trocar ${String(action.fromExerciseId)} por ${String(action.toExerciseId)} (${action.scope === 'PLAN' ? 'no plano todo' : 'só na próxima sessão'}).`;
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
    default:
      return String(action.type ?? 'Ação desconhecida');
  }
}

export function weekdayList(days: unknown): string {
  return Array.isArray(days) ? days.map((d) => WEEKDAYS[String(d)] ?? String(d)).join(', ') : '';
}

/** Idade do caso em linguagem curta (“há 3 h”, “há 2 dias”). */
export function ageLabel(createdAt: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(createdAt).getTime()) / 60_000));
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `há ${hours} h`;
  return `há ${Math.round(hours / 24)} dias`;
}
