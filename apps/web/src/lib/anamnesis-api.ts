/**
 * Cliente HTTP da anamnese (US-1.6) — consome os contratos REST do backend
 * (`AnamnesisController`/`ConsentController`, US-1.2/US-1.3). O servidor é a fonte da
 * verdade das regras (PAR-Q, consentimento, cifra); aqui só se fala o contrato.
 *
 * O token da sessão é credencial de dado de saúde: vai no PATH (nunca query string,
 * Sato §8.1) e é persistido no cliente só para permitir a retomada de 72h.
 * ponytail: persistência em localStorage — legível por XSS; um cookie httpOnly seria
 * mais forte, mas depende do backend emitir o cookie (fora do escopo desta US). A CSP
 * e o output-encoding do produto são a mitigação de XSS em vigor.
 */
import {
  type PrimaryGoal,
  type RecordConsentInput,
  type AnamnesisBlock1,
  type AnamnesisBlock2,
  type AnamnesisBlock3,
  type ParqState,
} from '@movivo/shared';

import { publicEnv } from './env';

const BASE = publicEnv.apiUrl;
const TOKEN_KEY = 'movivo:anamnese-token';

/** Objetivo da landing (`perder_peso`…) → enum do contrato. Ausente/desconhecido = undefined. */
const GOAL_MAP: Record<string, PrimaryGoal> = {
  perder_peso: 'LOSE_WEIGHT',
  ganhar_massa: 'GAIN_MUSCLE',
  condicionamento: 'CONDITIONING',
};

export function mapGoal(goal: string | null | undefined): PrimaryGoal | undefined {
  return goal ? GOAL_MAP[goal] : undefined;
}

/** Erro de API com o status para a UI decidir (retry de rede vs. sessão expirada etc.). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch {
    // Falha de rede (offline/DNS/timeout): status 0 → a UI oferece "tentar de novo"
    // sem perder o dado já digitado no bloco (o progresso salvo protege o resto).
    throw new ApiError(0, 'Não conseguimos falar com o servidor. Verifique sua conexão.');
  }
  if (res.status === 204) return undefined as T;
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (body as { message?: string | string[] })?.message?.toString() ??
      'Algo não saiu como esperado. Tente novamente.';
    throw new ApiError(res.status, message);
  }
  return body as T;
}

export interface StartResult {
  token: string;
  expiresAt: string;
  lastBlock: number;
}

export interface SessionView {
  status: string;
  lastBlock: number;
  primaryGoal: string | null;
  parqState: ParqState | null;
  block1: AnamnesisBlock1 | null;
  block2Completed: boolean;
  block3: AnamnesisBlock3 | null;
  expiresAt: string;
}

export interface SubmitResult {
  status: 'SUBMITTED';
  parqState: ParqState;
  requiresProfessionalReview: boolean;
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storeToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* localStorage indisponível (modo privado antigo): a sessão vive só nesta aba. */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* nada a limpar. */
  }
}

export function startAnamnesis(goal: string | null | undefined): Promise<StartResult> {
  return request<StartResult>('/anamnesis/start', {
    method: 'POST',
    body: JSON.stringify({ primaryGoal: mapGoal(goal) }),
  });
}

export function getSession(token: string): Promise<SessionView> {
  return request<SessionView>(`/anamnesis/session/${token}`);
}

export function patchBlock(
  token: string,
  n: 1 | 2 | 3,
  data: AnamnesisBlock1 | AnamnesisBlock2 | AnamnesisBlock3,
): Promise<{ lastBlock: number }> {
  return request(`/anamnesis/session/${token}/block/${n}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function recordConsents(token: string, consents: RecordConsentInput[]): Promise<void> {
  return request<void>(`/anamnesis/session/${token}/consents`, {
    method: 'POST',
    body: JSON.stringify({ consents }),
  });
}

export function submitAnamnesis(token: string): Promise<SubmitResult> {
  return request<SubmitResult>(`/anamnesis/session/${token}/submit`, { method: 'POST' });
}
