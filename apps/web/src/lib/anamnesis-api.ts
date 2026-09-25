/**
 * Cliente HTTP do onboarding v2 (Sprint 6) — fala só com o BFF `/api/anamnesis/*`.
 *
 * O token da sessão (72h, credencial de dado de saúde — ADR-006/Sato §8.1) nunca chega
 * a este código: fica num cookie httpOnly e o BFF o coloca no PATH das chamadas à API.
 * Aqui circula só a referência da sessão desta aba (`ref`), que não serve como
 * credencial — ver `anamnesis-session-ref.ts`.
 */
import type { OnboardingOutcome, SubscriptionPlanId } from '@movivo/shared';
import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  getExampleNumber,
  isPossiblePhoneNumber,
  isValidPhoneNumber,
  parsePhoneNumberFromString,
  validatePhoneNumberLength,
  type CountryCode,
} from 'libphonenumber-js';
import mobilePhoneExamples from 'libphonenumber-js/mobile/examples';

import { ANAMNESIS_REF_HEADER, SESSION_REPLACED_STATUS } from './anamnesis-session-ref';
import { getFirstTouch } from './first-touch';

const BASE = '/api/anamnesis';

export interface ConsentItemView {
  type: 'TERMS_OF_SERVICE' | 'HEALTH_DATA' | 'AI_DISCLOSURE' | 'MARKETING';
  version: string;
  title: string | null;
  body: readonly string[];
  label: string;
  required: boolean;
}

export interface SessionView {
  status: string;
  currentStep: number;
  phoneVerified: boolean;
  primaryGoal: string | null;
  consents: ConsentItemView[];
  step1: Record<string, unknown> | null;
  step2: Record<string, unknown> | null;
  healthCompleted: boolean;
  parqCompleted: boolean;
  outcome: OnboardingOutcome | null;
  expiresAt: string;
}

/** Sessão aberta ou retomada: estado + referência desta aba (nunca o token). */
export interface SessionEntry {
  ref: string;
  session: SessionView;
}

export interface SendCodeResult {
  sent: boolean;
  resendAvailableAt: string;
  expiresAt: string;
}

export interface SubmitResult {
  status: 'SUBMITTED';
  outcome: OnboardingOutcome;
}

class AnamnesisApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly issues: string[],
  ) {
    super(`request_failed_${status}`);
  }
}

/** O cookie passou a ser de um cadastro aberto em outra aba: esta aba precisa recarregar. */
export function isSessionReplaced(error: unknown): boolean {
  return error instanceof AnamnesisApiError && error.status === SESSION_REPLACED_STATUS;
}

export const SESSION_REPLACED_MESSAGE =
  'Um novo cadastro foi aberto em outra aba. Recarregue a página para continuar por ele.';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
    const issues = body?.message ? [body.message].flat() : [];
    throw new AnamnesisApiError(res.status, issues);
  }
  return (await res.json().catch(() => ({}))) as T;
}

/** Escrita na sessão desta aba: a referência vai junto para o BFF conferir. */
function write<T>(method: 'POST' | 'PATCH', path: string, ref: string, body?: unknown) {
  return request<T>(path, {
    method,
    headers: { [ANAMNESIS_REF_HEADER]: ref },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export { AnamnesisApiError };

export function startAnamnesis(
  planId: SubscriptionPlanId,
  primaryGoal?: string,
): Promise<SessionEntry> {
  // A atribuição de primeiro toque (US-8.2) viaja aqui: é a única chamada em que a
  // sessão nasce, e é no servidor que ela é saneada e gravada em escrita única.
  return request<SessionEntry>('/start', {
    method: 'POST',
    body: JSON.stringify({
      planId,
      ...(primaryGoal ? { primaryGoal } : {}),
      attribution: getFirstTouch() ?? {},
    }),
  });
}

/** Sessão do cookie, para retomar no F5. 404 = nenhum cadastro em andamento. */
export function getSession(): Promise<SessionEntry> {
  return request<SessionEntry>('/session', { cache: 'no-store' });
}

export function patchStep(
  ref: string,
  step: 1 | 2 | 3,
  data: unknown,
): Promise<{ currentStep: number }> {
  return write('PATCH', `/session/step/${step}`, ref, data);
}

export function sendPhoneCode(ref: string, phoneNumber: string): Promise<SendCodeResult> {
  return write<SendCodeResult>('POST', '/session/phone/send-code', ref, { phoneNumber });
}

export function verifyPhoneCode(ref: string, code: string): Promise<{ phoneVerified: true }> {
  return write<{ phoneVerified: true }>('POST', '/session/phone/verify', ref, { code });
}

export function recordConsents(
  ref: string,
  consents: { type: string; version: string; accepted: boolean }[],
): Promise<void> {
  return write('POST', '/session/consents', ref, { consents });
}

export function submitAnamnesis(ref: string): Promise<SubmitResult> {
  return write<SubmitResult>('POST', '/session/submit', ref);
}

export type PhoneCountryIso = CountryCode;

export interface SupportedPhoneCountry {
  readonly iso: PhoneCountryIso;
  readonly name: string;
  readonly callingCode: string;
  readonly placeholder: string;
}

const countryNames =
  typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(['pt-BR'], { type: 'region', fallback: 'code' })
    : null;
const countryNameCollator = new Intl.Collator('pt-BR', { sensitivity: 'base' });

function buildPhoneCountry(iso: PhoneCountryIso): SupportedPhoneCountry {
  const example = getExampleNumber(iso, mobilePhoneExamples);
  return {
    iso,
    name: countryNames?.of(iso) ?? iso,
    callingCode: `+${getCountryCallingCode(iso)}`,
    placeholder: example?.formatNational() ?? '',
  };
}

const DEFAULT_PHONE_COUNTRY = buildPhoneCountry('BR');

/** Brasil primeiro; demais países e territórios em ordem alfabética pt-BR. */
export const SUPPORTED_PHONE_COUNTRIES: readonly SupportedPhoneCountry[] = [
  DEFAULT_PHONE_COUNTRY,
  ...getCountries()
    .filter((iso) => iso !== 'BR')
    .map(buildPhoneCountry)
    .sort((left, right) => countryNameCollator.compare(left.name, right.name)),
];
const PHONE_COUNTRIES_BY_ISO = new Map(
  SUPPORTED_PHONE_COUNTRIES.map((country) => [country.iso, country]),
);

export function getPhoneCountry(iso: PhoneCountryIso): SupportedPhoneCountry {
  return PHONE_COUNTRIES_BY_ISO.get(iso) ?? DEFAULT_PHONE_COUNTRY;
}

/** Formata progressivamente os dígitos nacionais conforme os metadados do país. */
export function maskNationalPhone(iso: PhoneCountryIso, raw: string): string {
  const e164Limit = 15 - getCountryCallingCode(iso).length;
  let digits = raw.replace(/\D/g, '').slice(0, e164Limit);

  while (digits && validatePhoneNumberLength(digits, iso) === 'TOO_LONG') {
    digits = digits.slice(0, -1);
  }

  return new AsYouType(iso).input(digits);
}

/**
 * Comprimento nacional (só dígitos) de um celular de exemplo por país — cache simples,
 * a mesma tabela estática de `mobilePhoneExamples` não muda em runtime.
 */
const MOBILE_DIGIT_LENGTH = new Map<PhoneCountryIso, number>();
function mobileDigitLength(iso: PhoneCountryIso): number | undefined {
  if (!MOBILE_DIGIT_LENGTH.has(iso)) {
    const example = getExampleNumber(iso, mobilePhoneExamples);
    MOBILE_DIGIT_LENGTH.set(iso, example?.nationalNumber.length ?? -1);
  }
  const length = MOBILE_DIGIT_LENGTH.get(iso);
  return length === -1 ? undefined : length;
}

export function isPhoneComplete(iso: PhoneCountryIso, masked: string): boolean {
  const digits = masked.replace(/\D/g, '');
  if (digits.length === 0) return false;
  // `isValidPhoneNumber` sozinho aceita QUALQUER tipo de número do país (fixo ou
  // móvel) — no Brasil um fixo válido tem o mesmo comprimento de um celular faltando
  // o último dígito, então validar só isso marca "completo" um dígito cedo demais
  // (bug real: campo do código de verificação aparecia antes do usuário terminar de
  // digitar, e o SMS/WhatsApp saía pro número truncado errado). Exige bater o
  // comprimento exato de um celular de exemplo do país antes de aceitar como válido.
  const expected = mobileDigitLength(iso);
  if (expected !== undefined && digits.length < expected) return false;
  return isPossiblePhoneNumber(digits, iso) && isValidPhoneNumber(digits, iso);
}

/** DDI selecionado + dígitos nacionais → E.164. */
export function toE164(iso: PhoneCountryIso, masked: string): string {
  const digits = masked.replace(/\D/g, '');
  return (
    parsePhoneNumberFromString(digits, iso)?.number ??
    `${getPhoneCountry(iso).callingCode}${digits}`
  );
}

/** Reidrata o seletor e a máscara a partir do E.164 persistido. */
export function parsePhoneE164(
  phoneNumber: string,
): { countryIso: PhoneCountryIso; phoneMasked: string } | null {
  if (!/^\+[1-9]\d{1,14}$/.test(phoneNumber) || !isPossiblePhoneNumber(phoneNumber)) return null;

  const parsed = parsePhoneNumberFromString(phoneNumber, { extract: false });
  if (!parsed?.country) return null;
  return { countryIso: parsed.country, phoneMasked: parsed.formatNational() };
}
