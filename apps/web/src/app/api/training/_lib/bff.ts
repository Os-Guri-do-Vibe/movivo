import 'server-only';

import { cookies, headers as requestHeaders } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import { publicEnv, secureCookies } from '@/lib/env';

import { trustedOrigins } from '../../_lib/trusted-origins';

const API_BASE = (process.env.MOVIVO_API_URL?.trim() || publicEnv.apiUrl).replace(/\/$/, '');
const COOKIE = 'movivo_training_session';
const COOKIE_PATH = '/api/training';
const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  'Referrer-Policy': 'no-referrer',
} as const;

export class TrainingBffError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Mutação só da própria origem (defesa CSRF além do `SameSite=Strict`). */
export function assertSameOrigin(request: NextRequest): void {
  const origin = request.headers.get('origin');
  if (!origin || !trustedOrigins(request).has(origin)) {
    throw new TrainingBffError(403, 'Origem nao autorizada.');
  }
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new TrainingBffError(403, 'Solicitacao cross-site bloqueada.');
  }
}

async function body(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

/** Troca o link de uso único por um cookie HttpOnly restrito às rotas de treino. */
export async function exchangeMagicToken(token: string): Promise<void> {
  const response = await fetch(`${API_BASE}/training/access/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
    cache: 'no-store',
  });
  const payload = (await body(response)) as { sessionToken?: unknown } | null;
  if (!response.ok || typeof payload?.sessionToken !== 'string') {
    throw new TrainingBffError(response.status, 'Este link expirou ou ja foi utilizado.');
  }
  (await cookies()).set(COOKIE, payload.sessionToken, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'strict',
    path: COOKIE_PATH,
    maxAge: 30 * 24 * 60 * 60,
    priority: 'high',
  });
}

export async function trainingBackendFetch(path: string, init: RequestInit = {}) {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) throw new TrainingBffError(401, 'Abra o link recebido pelo WhatsApp.');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  // Sem o IP do aluno o rate limit por IP da API viraria um limite global compartilhado.
  const ip = (await requestHeaders()).get('x-real-ip');
  if (ip) headers.set('X-Forwarded-For', ip);
  if (!headers.has('Content-Type') && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(`${API_BASE}${path}`, { ...init, headers, cache: 'no-store' });
}

export async function forward(response: Response): Promise<NextResponse> {
  // 204 não tem corpo: `NextResponse.json` com esse status é inválido.
  if (response.status === 204)
    return new NextResponse(null, { status: 204, headers: PRIVATE_HEADERS });
  const payload = await body(response);
  return NextResponse.json(payload ?? {}, { status: response.status, headers: PRIVATE_HEADERS });
}

export function failure(error: unknown): NextResponse {
  const status = error instanceof TrainingBffError ? error.status : 500;
  const message = error instanceof Error ? error.message : 'Nao foi possivel concluir.';
  return NextResponse.json({ message }, { status, headers: PRIVATE_HEADERS });
}
