/**
 * Cliente HTTP do formulário de troca de protocolo por fim de mesociclo — consome o
 * `ProtocolRenewalController` (`apps/api/src/modules/protocol-renewal`).
 *
 * Mesmo padrão de `anamnesis-api.ts`: o token é o identificador opaco da sessão,
 * sempre no PATH (nunca query string, ADR-006/Sato §8.1). Diferente da anamnese, o
 * token não é consumido (TTL de 14 dias, reaberto de qualquer dispositivo até o
 * submit ou a expiração) e não há fase anônima — o titular já existe.
 */
import { publicEnv } from './env';

const BASE = publicEnv.apiUrl;

export type RenewalStepNumber = 1 | 2 | 3 | 4 | 5;

/**
 * Espelha `RenewalSessionView` do backend (`protocol-renewal.service.ts`).
 * `block1`/`block2`/`block4`/`block5` vêm como `unknown` (o formato exato é o dos
 * schemas Zod de `@movivo/shared`); `block3` NUNCA volta com conteúdo (dado de saúde
 * cifrado) — só a flag `block3Completed`.
 */
export interface RenewalSessionView {
  status: string;
  currentStep: number;
  firstName: string | null;
  hasTargetEvent: boolean;
  block1: unknown;
  block2: unknown;
  block3Completed: boolean;
  block4: unknown;
  block5: unknown;
  expiresAt: string;
}

export interface RenewalPatchStepResult {
  currentStep: number;
}

export interface RenewalSubmitResult {
  status: 'SUBMITTED';
}

export class ProtocolRenewalApiError extends Error {
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
    throw new ProtocolRenewalApiError(res.status, issues);
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

export function getRenewalSession(token: string): Promise<RenewalSessionView> {
  return request<RenewalSessionView>(`/protocol-renewal/session/${token}`, { cache: 'no-store' });
}

export function patchRenewalStep(
  token: string,
  step: RenewalStepNumber,
  data: unknown,
): Promise<RenewalPatchStepResult> {
  return patch(`/protocol-renewal/session/${token}/step/${step}`, data);
}

export function submitRenewal(token: string): Promise<RenewalSubmitResult> {
  return post<RenewalSubmitResult>(`/protocol-renewal/session/${token}/submit`);
}
