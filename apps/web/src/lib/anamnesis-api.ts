/**
 * Cliente HTTP do onboarding v2 (Sprint 6) — consome o `AnamnesisController`.
 *
 * O token é o identificador opaco da sessão (72h), sempre no PATH (nunca query
 * string, ADR-006/Sato §8.1) — mesmo padrão de `subscription-api.ts`.
 */
import type { OnboardingOutcome } from '@movivo/shared';

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
  return request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
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

/** Máscara `(xx) xxxxx-xxxx` sobre dígitos livres (celular BR, 11 dígitos). */
export function maskPhoneBR(digits: string): string {
  const d = digits.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** `(xx) xxxxx-xxxx` → E.164 (`+55xxxxxxxxxxx`). */
export function toE164BR(masked: string): string {
  const d = masked.replace(/\D/g, '');
  return `+55${d}`;
}
