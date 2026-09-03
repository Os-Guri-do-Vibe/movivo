import 'server-only';

import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import { publicEnv } from '@/lib/env';

const API_BASE = (process.env.MOVIVO_API_URL?.trim() || publicEnv.apiUrl).replace(/\/$/, '');
const COOKIE = 'movivo_workout_session';
const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  'Referrer-Policy': 'no-referrer',
} as const;

export class WorkoutBffError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function assertSameOrigin(request: NextRequest): void {
  if (request.headers.get('origin') !== request.nextUrl.origin) {
    throw new WorkoutBffError(403, 'Origem nao autorizada.');
  }
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new WorkoutBffError(403, 'Solicitacao cross-site bloqueada.');
  }
}

async function body(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

export async function exchangeMagicToken(token: string): Promise<void> {
  const response = await fetch(`${API_BASE}/workouts/access/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
    cache: 'no-store',
  });
  const payload = (await body(response)) as { sessionToken?: unknown } | null;
  if (!response.ok || typeof payload?.sessionToken !== 'string') {
    throw new WorkoutBffError(response.status, 'Este link expirou ou ja foi utilizado.');
  }
  (await cookies()).set(COOKIE, payload.sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
    priority: 'high',
  });
}

export async function workoutBackendFetch(path: string, init: RequestInit = {}) {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) throw new WorkoutBffError(401, 'Abra o link recebido pelo WhatsApp.');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json');
  return fetch(`${API_BASE}${path}`, { ...init, headers, cache: 'no-store' });
}

export async function forward(response: Response): Promise<NextResponse> {
  const payload = await body(response);
  return NextResponse.json(payload ?? {}, { status: response.status, headers: PRIVATE_HEADERS });
}

export function failure(error: unknown): NextResponse {
  const status = error instanceof WorkoutBffError ? error.status : 500;
  const message = error instanceof Error ? error.message : 'Nao foi possivel concluir.';
  return NextResponse.json({ message }, { status, headers: PRIVATE_HEADERS });
}
