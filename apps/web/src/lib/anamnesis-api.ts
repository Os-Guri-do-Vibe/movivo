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
  type: 'TERMS_OF_SERVICE' | 'HEALTH_DATA' | 'AI_DISCLOSURE' | 'MARKETING' | 'BODY_PHOTOS';
  version: string;
  title: string | null;
  body: readonly string[];
  label: string;
  required: boolean;
}

export interface SessionView {
  status: string;
  /** `INITIAL` = cadastro novo; `COMPLEMENTARY` = aluno que já existia completa o que falta. */
  flow: 'INITIAL' | 'COMPLEMENTARY';
  currentStep: number;
  completedSteps: number[];
  phoneVerified: boolean;
  primaryGoal: string | null;
  consents: ConsentItemView[];
  /** Anamnese complementar: os textos vigentes ainda precisam ser aceitos nesta sessão. */
  consentsPending: boolean;
  /** Consentimento próprio das fotos do corpo (pedido só a quem decide enviar fotos). */
  bodyPhotosConsent: ConsentItemView;
  /** O texto vigente do consentimento das fotos já foi aceito nesta sessão. */
  bodyPhotosConsentAccepted: boolean;
  /** Posições que já têm foto enviada (FRONT, RIGHT, BACK, LEFT). */
  photos: string[];
  /** Parte COMUM de cada etapa (a sensível nunca volta). Chaves: registration, goals… */
  blocks: Record<string, unknown>;
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

/** `status` 0 = a requisição nem chegou ao servidor (sem rede ou tempo esgotado). */
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
const SESSION_EXPIRED_MESSAGE =
  'Sua sessão expirou. Recarregue a página para recomeçar o formulário.';
const NETWORK_MESSAGE =
  'Não conseguimos falar com a MOVIVO. Confira sua conexão com a internet e tente de novo.';
const RATE_LIMIT_MESSAGE =
  'Muitas tentativas em pouco tempo. Por segurança, espere alguns minutos e tente de novo.';
const SERVER_MESSAGE =
  'Estamos com uma instabilidade agora. O que você já salvou não se perde: tente de novo em instantes.';

/**
 * Mensagem em PT-BR para o aluno a partir de uma falha da API. Só os textos que a API escreve
 * à mão (conflito, idade, limites de tentativa) são repassados; erro de schema (400) usa o
 * `fallback` da tela, a não ser que `trustBadRequest` diga que o 400 daquela rota é redigido.
 */
export function describeAnamnesisError(
  error: unknown,
  fallback: string,
  { trustBadRequest = false }: { trustBadRequest?: boolean } = {},
): string {
  if (!(error instanceof AnamnesisApiError)) return fallback;
  const serverText = error.issues[0];
  switch (error.status) {
    case 0:
      return NETWORK_MESSAGE;
    case 400:
      return (trustBadRequest && serverText) || fallback;
    case 403:
    case 409:
    case 422:
      return serverText ?? fallback;
    case 404:
    case 410:
      return SESSION_EXPIRED_MESSAGE;
    case SESSION_REPLACED_STATUS:
      return SESSION_REPLACED_MESSAGE;
    case 413:
      return 'A imagem passa de 5 MB. Escolha uma foto menor.';
    case 415:
      return 'Use uma imagem JPG, PNG ou WebP.';
    case 429:
      return RATE_LIMIT_MESSAGE;
    default:
      return error.status >= 500 ? SERVER_MESSAGE : fallback;
  }
}

/** Tempo máximo de uma chamada antes de o aluno ver a mensagem de conexão. */
const REQUEST_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 90_000;
const MAX_ISSUE_LENGTH = 300;

/** Só texto, curto e em quantidade limitada: a resposta de erro nunca vira HTML nem log. */
function readIssues(body: unknown): string[] {
  const message = (body as { message?: unknown } | null)?.message;
  return [message]
    .flat()
    .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    .slice(0, 5)
    .map((item) => item.trim().slice(0, MAX_ISSUE_LENGTH));
}

async function request<T>(
  path: string,
  init?: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new AnamnesisApiError(0, []);
  }
  if (!res.ok) {
    throw new AnamnesisApiError(res.status, readIssues(await res.json().catch(() => null)));
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

/**
 * Abre a anamnese complementar a partir do token do link (vem no fragmento da URL, nunca na
 * query): o BFF o guarda em cookie httpOnly e devolve a sessão.
 */
export function resumeComplementary(token: string): Promise<SessionEntry> {
  return request<SessionEntry>('/resume', { method: 'POST', body: JSON.stringify({ token }) });
}

/** Sessão do cookie, para retomar no F5. 404 = nenhum cadastro em andamento. */
export function getSession(): Promise<SessionEntry> {
  return request<SessionEntry>('/session', { cache: 'no-store' });
}

export type OnboardingStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export function patchStep(
  ref: string,
  step: OnboardingStep,
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

export type PhotoAngleKey = 'FRONT' | 'RIGHT' | 'BACK' | 'LEFT';

/** Envia (ou substitui) a foto da posição; os bytes seguem como imagem, não como JSON. */
export function uploadBodyPhoto(ref: string, angle: PhotoAngleKey, file: File): Promise<void> {
  return request<void>(
    `/session/photo/${angle}`,
    {
      method: 'PUT',
      headers: { [ANAMNESIS_REF_HEADER]: ref, 'Content-Type': file.type },
      body: file,
    },
    UPLOAD_TIMEOUT_MS,
  );
}

export function deleteBodyPhoto(ref: string, angle: PhotoAngleKey): Promise<void> {
  return request<void>(`/session/photo/${angle}`, {
    method: 'DELETE',
    headers: { [ANAMNESIS_REF_HEADER]: ref },
  });
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

/** Já tem dígitos suficientes para um celular do país e, mesmo assim, não é um número válido. */
export function isPhoneInvalid(iso: PhoneCountryIso, masked: string): boolean {
  const digits = masked.replace(/\D/g, '');
  if (digits.length === 0 || isPhoneComplete(iso, masked)) return false;
  const expected = mobileDigitLength(iso);
  return expected !== undefined
    ? digits.length >= expected
    : validatePhoneNumberLength(digits, iso) === undefined;
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
