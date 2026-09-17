/**
 * Cliente HTTP do formulário de check-in semanal — consome `CheckinController`
 * (`apps/api/src/modules/checkin`). Mesmo padrão de `protocol-renewal-api.ts`: o token é o
 * identificador opaco da sessão, sempre no PATH. Diferente da renovação, não há PATCH por
 * etapa — só `GET` (status) e `POST .../submit` (envio único).
 */
import type { CheckinWeeklySubmit } from '@movivo/shared';

import { publicEnv } from './env';

const BASE = publicEnv.apiUrl;

export interface CheckinWeeklySessionView {
  status: 'PENDING' | 'SUBMITTED' | 'EXPIRED';
  firstName: string | null;
  weekNumber: number;
}

export interface CheckinWeeklySubmitResult {
  status: 'SUBMITTED';
}

export class CheckinWeeklyApiError extends Error {
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
    throw new CheckinWeeklyApiError(res.status, issues);
  }
  return (await res.json().catch(() => ({}))) as T;
}

export function getCheckinWeeklySession(token: string): Promise<CheckinWeeklySessionView> {
  return request<CheckinWeeklySessionView>(`/checkin/session/${token}`, { cache: 'no-store' });
}

export function submitCheckinWeekly(
  token: string,
  payload: CheckinWeeklySubmit,
): Promise<CheckinWeeklySubmitResult> {
  return request<CheckinWeeklySubmitResult>(`/checkin/session/${token}/submit`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
