import type { StatusTone } from './control-center-table';

/**
 * Tradução dos códigos do banco para a palavra que a equipe lê. Nunca o código cru na tela:
 * código sem rótulo próprio vira texto legível (`humanize`) e a COR só reforça o texto
 * (WCAG 1.4.1). Coral só em alerta real: PAR-Q bloqueado e cobrança em atraso.
 */

export interface Labelled {
  label: string;
  tone: StatusTone;
}

/** `GAIN_MUSCLE` → `Gain muscle`. Último recurso para código sem rótulo próprio. */
function humanize(value: string): string {
  if (!/^[A-Z0-9]+(?:_[A-Z0-9]+)*$/.test(value)) return value;
  const words = value.toLowerCase().replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function lookup(table: Readonly<Record<string, string>>, value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return table[trimmed] ?? humanize(trimmed);
}

function labelled(
  table: Readonly<Record<string, Labelled>>,
  value: string | null,
): Labelled | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return table[trimmed] ?? { label: humanize(trimmed), tone: 'neutral' };
}

/** `users.status` — ciclo de vida do cadastro. */
const REGISTRATION: Record<string, Labelled> = {
  ONBOARDING: { label: 'Em cadastro', tone: 'quiet' },
  TRIAL: { label: 'Em teste', tone: 'neutral' },
  ACTIVE: { label: 'Ativo', tone: 'positive' },
  PAUSED: { label: 'Pausado', tone: 'neutral' },
  CHURNED: { label: 'Cancelado', tone: 'quiet' },
};

/** `subscriptions.status`. Coral só para cobrança em atraso — o único alerta real. */
const SUBSCRIPTION: Record<string, Labelled> = {
  TRIALING: { label: 'Em teste', tone: 'neutral' },
  PENDING_PAYMENT: { label: 'Aguardando pagamento', tone: 'neutral' },
  ACTIVE: { label: 'Ativa', tone: 'positive' },
  PAST_DUE: { label: 'Pagamento em atraso', tone: 'attention' },
  PAUSED: { label: 'Pausada', tone: 'neutral' },
  CANCELED: { label: 'Cancelada', tone: 'quiet' },
  EXPIRED: { label: 'Expirada', tone: 'quiet' },
};

/** `training_plans.status`. */
const PLAN: Record<string, Labelled> = {
  DRAFT: { label: 'Em elaboração', tone: 'quiet' },
  ACTIVE: { label: 'Vigente', tone: 'positive' },
  SUPERSEDED: { label: 'Substituído', tone: 'quiet' },
};

const ANAMNESIS: Record<string, Labelled> = {
  IN_PROGRESS: { label: 'Em preenchimento', tone: 'neutral' },
  SUBMITTED: { label: 'Enviada', tone: 'positive' },
  PROCESSED: { label: 'Processada', tone: 'positive' },
  EXPIRED: { label: 'Expirada', tone: 'quiet' },
};

/** Gate PAR-Q: bloqueio é a trava real de segurança, então é o outro uso legítimo do coral. */
const PARQ: Record<string, Labelled> = {
  LIBERADO: { label: 'Liberado', tone: 'positive' },
  LIBERADO_COM_RESSALVA_RT: {
    label: 'Liberado com ressalva do responsável técnico',
    tone: 'neutral',
  },
  BLOQUEADO_AGUARDANDO_CLEARANCE: {
    label: 'Bloqueado: aguarda decisão do profissional',
    tone: 'attention',
  },
};

export const registrationStatus = (value: string | null) => labelled(REGISTRATION, value);
export const subscriptionStatus = (value: string | null) => labelled(SUBSCRIPTION, value);
export const planStatus = (value: string | null) => labelled(PLAN, value);
export const anamnesisStatus = (value: string | null) => labelled(ANAMNESIS, value);
export const parqStatus = (value: string | null) => labelled(PARQ, value);

const PLAN_LABEL: Record<string, string> = {
  MONTHLY: 'Mensal',
  QUARTERLY: 'Trimestral',
  SEMIANNUAL: 'Semestral',
  ANNUAL: 'Anual',
};
export const planLabel = (value: string | null) => lookup(PLAN_LABEL, value);

const MODALITY: Record<string, string> = {
  STRENGTH: 'Força',
  RUNNING: 'Corrida',
  HYROX: 'HYROX',
  HYBRID: 'Híbrido',
  CYCLING: 'Ciclismo',
  SWIMMING: 'Natação',
  OTHER: 'Outro',
};
export const modalityLabel = (value: string | null) => lookup(MODALITY, value);

const EXECUTION_STATUS: Record<string, string> = {
  IN_PROGRESS: 'Em andamento',
  COMPLETED: 'Concluído',
  PARTIAL: 'Parcial',
  ABANDONED: 'Abandonado',
};
export const executionStatusLabel = (value: string | null) => lookup(EXECUTION_STATUS, value);
