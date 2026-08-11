/**
 * Cliente HTTP do onboarding v2 (Sprint 6) — consome o `AnamnesisController`.
 *
 * O token é o identificador opaco da sessão (72h), sempre no PATH (nunca query
 * string, ADR-006/Sato §8.1) — mesmo padrão de `subscription-api.ts`.
 */
import type { OnboardingOutcome } from '@movivo/shared';
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

import { publicEnv } from './env';

const BASE = publicEnv.apiUrl;

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

export interface StartResult {
  token: string;
  expiresAt: string;
  currentStep: number;
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

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function patch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
}

export { AnamnesisApiError };

export function startAnamnesis(primaryGoal?: string): Promise<StartResult> {
  return post<StartResult>('/anamnesis/start', primaryGoal ? { primaryGoal } : {});
}

export function getSession(token: string): Promise<SessionView> {
  return request<SessionView>(`/anamnesis/session/${token}`, { cache: 'no-store' });
}

export function patchStep(
  token: string,
  step: 1 | 2 | 3,
  data: unknown,
): Promise<{ currentStep: number }> {
  return patch(`/anamnesis/session/${token}/step/${step}`, data);
}

export function sendPhoneCode(token: string, phoneNumber: string): Promise<SendCodeResult> {
  return post<SendCodeResult>(`/anamnesis/session/${token}/phone/send-code`, { phoneNumber });
}

export function verifyPhoneCode(token: string, code: string): Promise<{ phoneVerified: true }> {
  return post<{ phoneVerified: true }>(`/anamnesis/session/${token}/phone/verify`, { code });
}

export function recordConsents(
  token: string,
  consents: { type: string; version: string; accepted: boolean }[],
): Promise<void> {
  return post(`/anamnesis/session/${token}/consents`, { consents });
}

export function submitAnamnesis(token: string): Promise<SubmitResult> {
  return post<SubmitResult>(`/anamnesis/session/${token}/submit`);
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

export function isPhoneComplete(iso: PhoneCountryIso, masked: string): boolean {
  const digits = masked.replace(/\D/g, '');
  return digits.length > 0 && isPossiblePhoneNumber(digits, iso) && isValidPhoneNumber(digits, iso);
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
