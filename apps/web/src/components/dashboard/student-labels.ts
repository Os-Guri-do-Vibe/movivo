import { PRIMARY_GOAL_LABELS, TRAINING_LOCATION_LABELS } from '@movivo/shared';

import {
  DURATION_ITEMS,
  EXPERIENCE_ITEMS,
  PERIOD_ITEMS,
  STATUS_ITEMS,
  WEEKDAY_ITEMS,
} from '../onboarding/legacy-anamnesis-items';
import type { StatusTone } from './control-center-table';

/**
 * Rótulos da ficha do aluno (spec de Sofia, 2026-10-11): o painel nunca mostra o código
 * que está no banco. Cada código vira texto em PT-BR; o que não está no dicionário cai em
 * {@link humanize}, que ao menos tira o `SNAKE_CASE` em maiúsculas da frente da equipe.
 *
 * As opções de formulário (objetivo, local, período…) vêm das MESMAS tabelas do
 * onboarding — a ficha repete a palavra que o aluno viu ao responder, não inventa outra.
 */

export interface Labelled {
  label: string;
  tone: StatusTone;
}

/** `GAIN_MUSCLE` → `Gain muscle`. Último recurso para código sem rótulo próprio. */
export function humanize(value: string): string {
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

function fromItems(items: ReadonlyArray<{ value: string; label: string }>) {
  return Object.fromEntries(items.map((item) => [item.value, item.label]));
}

/* -------------------------------------------------------------------------- */
/* Situação (com tom de cor)                                                  */
/* -------------------------------------------------------------------------- */

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

const PROTOCOL: Record<string, Labelled> = {
  DRAFT: { label: 'Em elaboração', tone: 'quiet' },
  PENDING_SIGNATURE: { label: 'Aguardando assinatura CREF', tone: 'neutral' },
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
  LIBERADO_COM_RESSALVA_RT: { label: 'Liberado com ressalva do RT', tone: 'neutral' },
  BLOQUEADO_AGUARDANDO_CLEARANCE: {
    label: 'Bloqueado: aguarda CREF',
    tone: 'attention',
  },
};

export const registrationStatus = (value: string | null) => labelled(REGISTRATION, value);
export const subscriptionStatus = (value: string | null) => labelled(SUBSCRIPTION, value);
export const protocolStatus = (value: string | null) => labelled(PROTOCOL, value);
export const anamnesisStatus = (value: string | null) => labelled(ANAMNESIS, value);
export const parqStatus = (value: string | null) => labelled(PARQ, value);

/* -------------------------------------------------------------------------- */
/* Texto simples                                                              */
/* -------------------------------------------------------------------------- */

const PLAN: Record<string, string> = {
  MONTHLY: 'Mensal',
  QUARTERLY: 'Trimestral',
  SEMIANNUAL: 'Semestral',
  ANNUAL: 'Anual',
};

const GOAL = PRIMARY_GOAL_LABELS as Record<string, string>;
const LOCATION = TRAINING_LOCATION_LABELS as Record<string, string>;
const TRAINING_STATUS = fromItems(STATUS_ITEMS);
const DURATION = fromItems(DURATION_ITEMS);
const PERIOD = fromItems(PERIOD_ITEMS);
const WEEKDAY = fromItems(WEEKDAY_ITEMS);
const WEEKDAY_ORDER = WEEKDAY_ITEMS.map((item) => item.value as string);

/** "Iniciante: nunca treinei…" → "Iniciante". A frase longa é do formulário, não da ficha. */
const EXPERIENCE = Object.fromEntries(
  EXPERIENCE_ITEMS.map((item) => [item.value, item.label.split(':')[0] ?? item.label]),
);

export const planLabel = (value: string | null) => lookup(PLAN, value);
export const goalLabel = (value: string | null) => lookup(GOAL, value);
export const trainingStatusLabel = (value: string | null) => lookup(TRAINING_STATUS, value);
export const experienceLabel = (value: string | null) => lookup(EXPERIENCE, value);
export const durationLabel = (value: string | null) => lookup(DURATION, value);
export const locationLabel = (value: string | null) => lookup(LOCATION, value);
export const periodLabel = (value: string | null) => lookup(PERIOD, value);

/** Dias preferidos na ordem da semana, abreviados: `['WED','MON']` → `Seg, Qua`. */
export function weekdaysLabel(days: readonly string[]): string | null {
  if (days.length === 0) return null;
  const sorted = [...days].sort((a, b) => {
    const left = WEEKDAY_ORDER.indexOf(a);
    const right = WEEKDAY_ORDER.indexOf(b);
    return (left === -1 ? 99 : left) - (right === -1 ? 99 : right);
  });
  return sorted
    .map((day) => {
      const name = lookup(WEEKDAY, day) ?? day;
      return name.length > 3 ? name.slice(0, 3) : name;
    })
    .join(', ');
}

/* -------------------------------------------------------------------------- */
/* Check-in semanal                                                           */
/* -------------------------------------------------------------------------- */

const SLEEP: Record<string, string> = {
  OTIMA: 'Ótima',
  BOA: 'Boa',
  REGULAR: 'Regular',
  RUIM: 'Ruim',
};

const MOOD: Record<string, string> = {
  MUITO_FELIZ: 'Extremamente feliz',
  FELIZ: 'Feliz',
  NEUTRO: 'Neutro',
  TRISTE: 'Triste',
  DESMOTIVADO: 'Desmotivado',
  PREFIRO_NAO_RESPONDER: 'Prefere não responder',
};

const DURATION_FIT: Record<string, string> = {
  ADEQUADA: 'Adequada',
  MAIS_CURTOS: 'Mais curta',
  MAIS_LONGOS: 'Mais longa',
};

export const sleepLabel = (value: string | null) => lookup(SLEEP, value);
export const moodLabel = (value: string | null) => lookup(MOOD, value);
export const durationFitLabel = (value: string | null) => lookup(DURATION_FIT, value);

/* -------------------------------------------------------------------------- */
/* Atendimento humano                                                         */
/* -------------------------------------------------------------------------- */

const HANDOFF_LEVEL: Record<string, string> = { ALERT: 'alerta', SAFETY: 'segurança' };

/** Motivo é texto aberto (até 60 caracteres no banco): o que não é conhecido é só legibilizado. */
const HANDOFF_REASON: Record<string, string> = {
  VALIDATOR_FLAG: 'Sinalizado pela validação de segurança',
  SUBSTITUTION_PAIN: 'Dor relatada na troca de exercício',
  SUBSTITUTION_TOO_MANY: 'Excesso de trocas de exercício',
  SUBSTITUTION_NO_SAFE_OPTION: 'Troca pedida sem opção na base',
  SUBSTITUTION_REPORTED: 'Troca de exercício feita pelo aluno',
  RENOVACAO_DOR_NOVA: 'Dor nova relatada na renovação',
};

export const handoffLevelLabel = (value: string | null) => lookup(HANDOFF_LEVEL, value);
export const handoffReasonLabel = (value: string | null) => lookup(HANDOFF_REASON, value);
