import 'server-only';

import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import {
  defaultCapabilitiesForRole,
  isDashboardCapability,
  isDashboardRole,
  type DashboardCapability,
  type DashboardRole,
} from '@/lib/control-center-access';
import { publicEnv } from '@/lib/env';

export const BFF_ACCESS_COOKIE = 'movivo_bff_access';
export const BFF_REFRESH_COOKIE = 'movivo_bff_refresh';
const BACKEND_REFRESH_COOKIE = 'movivo_refresh';
const ACCESS_MAX_AGE_SECONDS = 15 * 60;
const REFRESH_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
/** Exportado para rotas que fazem passthrough direto (ex.: `account/avatar/[filename]`). */
export const API_BASE = (process.env.MOVIVO_API_URL?.trim() || publicEnv.apiUrl).replace(/\/$/, '');

export const DASHBOARD_PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
} as const;

export interface DashboardSession {
  id: string;
  role: DashboardRole;
  capabilities: DashboardCapability[];
}

interface AuthPayload {
  accessToken: string;
  user: { id: string; role: string; capabilities?: string[] };
}

export class BffError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseAuthPayload(value: unknown): AuthPayload {
  if (
    !isRecord(value) ||
    typeof value.accessToken !== 'string' ||
    !isRecord(value.user) ||
    typeof value.user.id !== 'string' ||
    typeof value.user.role !== 'string'
  ) {
    throw new BffError(502, 'Resposta de autenticação inválida.');
  }
  return {
    accessToken: value.accessToken,
    user: {
      id: value.user.id,
      role: value.user.role,
      capabilities: Array.isArray(value.user.capabilities)
        ? value.user.capabilities.filter((entry): entry is string => typeof entry === 'string')
        : undefined,
    },
  };
}

async function parseJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

/** Extrai somente o valor opaco do cookie de refresh devolvido pelo NestJS. */
export function extractRefreshCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const match = /(?:^|,\s*)movivo_refresh=([^;,\s]+)/.exec(setCookie);
  return match?.[1] ?? null;
}

function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    maxAge,
    priority: 'high' as const,
  };
}

async function saveSession(accessToken: string, refreshToken?: string | null): Promise<void> {
  const store = await cookies();
  store.set(BFF_ACCESS_COOKIE, accessToken, sessionCookieOptions(ACCESS_MAX_AGE_SECONDS));
  if (refreshToken) {
    store.set(BFF_REFRESH_COOKIE, refreshToken, sessionCookieOptions(REFRESH_MAX_AGE_SECONDS));
  }
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(BFF_ACCESS_COOKIE);
  store.delete(BFF_REFRESH_COOKIE);
}

function toDashboardSession(payload: AuthPayload): DashboardSession {
  if (!isDashboardRole(payload.user.role)) {
    throw new BffError(403, 'Esta conta não tem acesso ao Control Center.');
  }
  const capabilities = payload.user.capabilities?.filter(isDashboardCapability);
  return {
    id: payload.user.id,
    role: payload.user.role,
    capabilities: [
      ...(capabilities?.length ? capabilities : defaultCapabilitiesForRole(payload.user.role)),
    ],
  };
}

export async function loginBackend(body: unknown): Promise<DashboardSession> {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const payload = await parseJson(response);
  if (!response.ok) throw new BffError(response.status, 'E-mail ou senha incorretos.');

  const auth = parseAuthPayload(payload);
  const refresh = extractRefreshCookie(response.headers.get('set-cookie'));
  if (!refresh) throw new BffError(502, 'A API não devolveu uma sessão renovável.');

  let session: DashboardSession;
  try {
    session = toDashboardSession(auth);
  } catch (error) {
    await clearSession();
    throw error;
  }
  await saveSession(auth.accessToken, refresh);
  return session;
}

async function refreshBackend(): Promise<AuthPayload> {
  const store = await cookies();
  const refresh = store.get(BFF_REFRESH_COOKIE)?.value;
  if (!refresh) throw new BffError(401, 'Sessão ausente.');

  const response = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: `${BACKEND_REFRESH_COOKIE}=${refresh}` },
    cache: 'no-store',
  });
  const payload = await parseJson(response);
  if (!response.ok) {
    await clearSession();
    throw new BffError(401, 'Sua sessão expirou. Entre novamente.');
  }

  const auth = parseAuthPayload(payload);
  const rotatedRefresh = extractRefreshCookie(response.headers.get('set-cookie'));
  if (!rotatedRefresh) {
    await clearSession();
    throw new BffError(502, 'A API não devolveu a rotação da sessão.');
  }
  try {
    toDashboardSession(auth);
  } catch (error) {
    await clearSession();
    throw error;
  }
  await saveSession(auth.accessToken, rotatedRefresh);
  return auth;
}

async function requestWithAccess(
  path: string,
  init: RequestInit,
  access: string,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${access}`);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  return fetch(`${API_BASE}${path}`, { ...init, headers, cache: 'no-store' });
}

/** Faz chamada autenticada e executa uma única rotação quando o access expira. */
interface DashboardAccess {
  accessToken: string;
  session: DashboardSession;
}

function parseDashboardSession(value: unknown): DashboardSession {
  if (!isRecord(value) || typeof value.userId !== 'string' || !isDashboardRole(value.role)) {
    throw new BffError(403, 'Esta conta não tem acesso ao Control Center.');
  }
  const capabilities = Array.isArray(value.capabilities)
    ? value.capabilities.filter(isDashboardCapability)
    : [];
  return {
    id: value.userId,
    role: value.role,
    capabilities: [
      ...(capabilities.length ? capabilities : defaultCapabilitiesForRole(value.role)),
    ],
  };
}

/** Valida no servidor que o cookie opaco pertence a um papel interno do Control Center. */
async function requireDashboardAccess(): Promise<DashboardAccess> {
  const store = await cookies();
  let accessToken = store.get(BFF_ACCESS_COOKIE)?.value;

  if (!accessToken) accessToken = (await refreshBackend()).accessToken;

  let response = await requestWithAccess('/auth/me', {}, accessToken);
  if (response.status === 401) {
    accessToken = (await refreshBackend()).accessToken;
    response = await requestWithAccess('/auth/me', {}, accessToken);
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) await clearSession();
    throw new BffError(response.status, 'Sessão inválida.');
  }

  try {
    return { accessToken, session: parseDashboardSession(await parseJson(response)) };
  } catch (error) {
    await clearSession();
    throw error;
  }
}

/**
 * Um 403 isolado é esperado no Control Center multi-setor (link direto para um setor
 * sem capability) e NÃO derruba a sessão. Vários 403 em sequência curta, porém,
 * parecem sondagem/enumeração de rotas — aí a sessão é encerrada.
 *
 * Limiar: 5 negativas em 60s. Um humano clicando errado não passa disso; um script
 * varrendo os 9 setores passa na primeira volta.
 *
 * ponytail: contador em memória do processo — some em cold start e não é compartilhado
 * entre instâncias serverless. É mitigação best-effort; a autorização real é do backend.
 * Se precisar de garantia entre instâncias, mover o contador para o Redis já usado pela API.
 */
const FORBIDDEN_LIMIT = 5;
const FORBIDDEN_WINDOW_MS = 60_000;
const forbiddenHits = new Map<string, number[]>();

async function registerForbidden(sessionId: string): Promise<void> {
  const now = Date.now();
  const hits = (forbiddenHits.get(sessionId) ?? []).filter((at) => now - at < FORBIDDEN_WINDOW_MS);
  hits.push(now);
  if (hits.length >= FORBIDDEN_LIMIT) {
    forbiddenHits.delete(sessionId);
    await clearSession();
    return;
  }
  forbiddenHits.set(sessionId, hits);
  if (forbiddenHits.size > 1000) forbiddenHits.clear();
}

/** Faz chamada autenticada após validar a sessão interna e executa uma rotação do access. */
export async function authenticatedBackendFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const { accessToken, session } = await requireDashboardAccess();
  let response = await requestWithAccess(path, init, accessToken);
  if (response.status === 403) await registerForbidden(session.id);
  if (response.status !== 401) return response;

  const refreshed = await refreshBackend();
  response = await requestWithAccess(path, init, refreshed.accessToken);
  if (response.status === 401) await clearSession();
  return response;
}

export async function readBackendSession(): Promise<DashboardSession> {
  return (await requireDashboardAccess()).session;
}

export async function logoutBackend(): Promise<void> {
  try {
    const store = await cookies();
    const access = store.get(BFF_ACCESS_COOKIE)?.value;
    if (access) await requestWithAccess('/auth/logout', { method: 'POST' }, access);
  } finally {
    await clearSession();
  }
}

function allowedOrigins(request: NextRequest): Set<string> {
  const origins = new Set([request.nextUrl.origin]);
  try {
    origins.add(new URL(publicEnv.siteUrl).origin);
  } catch {
    // O build já usa fallback válido; este ramo apenas evita confiar em env malformada.
  }
  return origins;
}

/** Defesa CSRF adicional ao SameSite=Strict: mutações exigem Origin same-origin. */
export function assertTrustedMutation(request: NextRequest): void {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (!origin || !allowedOrigins(request).has(origin)) {
    throw new BffError(403, 'Origem da solicitação não autorizada.');
  }
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new BffError(403, 'Solicitação cross-site bloqueada.');
  }
}

export function safeNextPath(value: string | null): string {
  return value?.startsWith('/dashboard') && !value.startsWith('//') ? value : '/dashboard';
}

export async function forwardBackendJson(response: Response): Promise<NextResponse> {
  const value = await parseJson(response);
  if (response.ok) {
    return NextResponse.json(value ?? {}, {
      status: response.status,
      headers: DASHBOARD_PRIVATE_HEADERS,
    });
  }

  const record = isRecord(value) ? value : {};
  const message =
    typeof record.message === 'string'
      ? record.message
      : response.status === 401
        ? 'Sua sessão expirou. Entre novamente.'
        : 'Não foi possível concluir a solicitação.';
  const safeBody: Record<string, unknown> = { error: `request_failed_${response.status}`, message };
  if (Array.isArray(record.issues)) safeBody.issues = record.issues;
  if (isRecord(record.validation)) safeBody.validation = record.validation;
  return NextResponse.json(safeBody, {
    status: response.status,
    headers: DASHBOARD_PRIVATE_HEADERS,
  });
}

export function errorResponse(error: unknown): NextResponse {
  const status = error instanceof BffError ? error.status : 500;
  const message =
    error instanceof BffError ? error.message : 'Não foi possível concluir a solicitação.';
  return NextResponse.json(
    { error: `request_failed_${status}`, message },
    { status, headers: DASHBOARD_PRIVATE_HEADERS },
  );
}
