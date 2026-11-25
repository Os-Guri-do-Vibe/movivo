/**
 * Conselho profissional e domínio de atuação. É o que decide quem responde a cada caso da fila:
 * o profissional de Educação Física (CREF) responde por treino, a nutricionista (CRN) por
 * alimentação e o médico (CRM) pelo que é clínico. Regra única, usada pelo painel e pela API.
 */
import { z } from 'zod';

import type { SafetyScope, SafetySignalKind } from './coaching.schema';

export const councilSchema = z.enum(['CREF', 'CRN', 'CRM']);
export type Council = z.infer<typeof councilSchema>;

export const exceptionDomainSchema = z.enum(['TRAINING', 'NUTRITION', 'MEDICAL', 'GENERAL']);
export type ExceptionDomain = z.infer<typeof exceptionDomainSchema>;

export const COUNCIL_LABELS: Readonly<Record<Council, string>> = {
  CREF: 'Educação Física (CREF)',
  CRN: 'Nutrição (CRN)',
  CRM: 'Medicina (CRM)',
};

/** Domínios em que cada conselho responde. `GENERAL` é de qualquer profissional. */
const DOMAINS_BY_COUNCIL: Readonly<Record<Council, readonly ExceptionDomain[]>> = {
  CREF: ['TRAINING', 'GENERAL'],
  CRN: ['NUTRITION', 'GENERAL'],
  CRM: ['MEDICAL', 'GENERAL'],
};

export function domainsForCouncil(council: Council): readonly ExceptionDomain[] {
  return DOMAINS_BY_COUNCIL[council];
}

/** Cada conselho age só no seu domínio (e no geral); o médico responde pelo clínico. */
export function canActOnDomain(council: Council, domain: ExceptionDomain): boolean {
  return DOMAINS_BY_COUNCIL[council].includes(domain);
}

/** Sinais que só um médico deve avaliar (cardio-respiratório, gestação, cirurgia, medicação, saúde mental). */
const MEDICAL_SIGNALS: ReadonlySet<SafetySignalKind> = new Set([
  'PARQ_POSITIVE',
  'CHEST_PAIN',
  'FAINTING_OR_DIZZINESS',
  'SHORTNESS_OF_BREATH',
  'PREGNANCY',
  'RECENT_SURGERY',
  'MEDICATION_CHANGE',
  'MENTAL_DISTRESS',
]);

/** Domínio que responde a um sinal de segurança. */
export function safetyDomainOf(kind: SafetySignalKind, scope: SafetyScope): ExceptionDomain {
  if (MEDICAL_SIGNALS.has(kind)) return 'MEDICAL';
  if (kind === 'EATING_DISORDER_SIGNS' || kind === 'RAPID_WEIGHT_CHANGE') return 'NUTRITION';
  if (scope === 'NUTRITION') return 'NUTRITION';
  if (scope === 'TRAINING') return 'TRAINING';
  return 'GENERAL';
}

/** Quem pode encerrar um sinal ativo: o profissional do domínio do sinal. */
export function canResolveSafety(
  council: Council,
  kind: SafetySignalKind,
  scope: SafetyScope,
): boolean {
  return canActOnDomain(council, safetyDomainOf(kind, scope));
}

/** Quem age na fila de exceções. O ADMIN é sócio e também profissional da MOVIVO. */
export interface QueueActor {
  role: 'PROFESSIONAL' | 'ADMIN';
  /** Conselho da conta, só para o PROFESSIONAL (o ADMIN vê todos os domínios). */
  council: Council | null;
  /** Registro no conselho ativo (só vale para o PROFESSIONAL). */
  councilActive: boolean;
}

/**
 * Pode agir num caso deste domínio? O profissional age no domínio do conselho dele, com registro
 * ativo. O ADMIN, em todos: os fundadores respondem pela operação inteira.
 */
export function canActOnCase(actor: QueueActor, domain: ExceptionDomain): boolean {
  if (actor.role === 'ADMIN') return true;
  return actor.councilActive && actor.council !== null && canActOnDomain(actor.council, domain);
}

/**
 * Pode encerrar um sinal de segurança ativo? Sinal CLÍNICO (dor no peito, PAR-Q positivo, gestação,
 * saúde mental...) exige registro de CRM ativo, na conta de profissional ou de ADMIN: é decisão
 * clínica, e o papel de administrador não a substitui. O ADMIN encerra os demais sinais.
 *
 * `registeredCouncil` é o conselho com registro ATIVO cadastrado na conta (nulo se não houver).
 */
export function canCloseSafety(
  actor: { role: 'PROFESSIONAL' | 'ADMIN'; registeredCouncil: Council | null },
  kind: SafetySignalKind,
  scope: SafetyScope,
): boolean {
  if (actor.registeredCouncil && canResolveSafety(actor.registeredCouncil, kind, scope)) {
    return true;
  }
  return actor.role === 'ADMIN' && safetyDomainOf(kind, scope) !== 'MEDICAL';
}
