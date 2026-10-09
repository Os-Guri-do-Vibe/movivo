import 'server-only';

import { mfaChallengeResponseSchema, type MfaStep } from '@movivo/shared';
import { cookies, headers } from 'next/headers';
import QRCode from 'qrcode';
import { NextResponse, type NextRequest } from 'next/server';

import {
  defaultCapabilitiesForRole,
  isDashboardCapability,
  isDashboardRole,
  type DashboardCapability,
  type DashboardRole,
} from '@/lib/control-center-access';
import { publicEnv, secureCookies } from '@/lib/env';

import { trustedOrigins } from '../../_lib/trusted-origins';

export const BFF_ACCESS_COOKIE = 'movivo_bff_access';
export const BFF_REFRESH_COOKIE = 'movivo_bff_refresh';
const BACKEND_REFRESH_COOKIE = 'movivo_refresh';
const ACCESS_MAX_AGE_SECONDS = 15 * 60;
const REFRESH_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const refreshInFlight = new Map<
  string,
  Promise<{ auth: AuthPayload; refresh: string; refreshMaxAge: number }>
>();
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

function extractRefreshMaxAge(setCookie: string | null): number | null {
  const match = /;\s*Max-Age=(\d+)/i.exec(setCookie ?? '');
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= REFRESH_MAX_AGE_SECONDS
    ? seconds
    : null;
}

function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'strict' as const,
    path: '/',
    maxAge,
    priority: 'high' as const,
  };
}

async function saveSession(
  accessToken: string,
  refreshToken: string,
  refreshMaxAge: number,
): Promise<void> {
  const store = await cookies();
  store.set(BFF_ACCESS_COOKIE, accessToken, sessionCookieOptions(ACCESS_MAX_AGE_SECONDS));
  store.set(BFF_REFRESH_COOKIE, refreshToken, sessionCookieOptions(refreshMaxAge));
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

/**
 * IP e user-agent do visitante para a API. Sem isto, o login/refresh saem com o IP deste
 * servidor: o rate limit de 10/min do `/auth/login` vira um balde GLOBAL (um atacante a
 * 10 tentativas/min trava o login de todo mundo e o limite não protege nenhuma conta
 * específica) e a trilha de acesso (`AUTH_LOGIN`) gravaria sempre o IP do container.
 * Em produção o Nginx sobrescreve `X-Real-IP` com o IP do visitante e o web não tem porta
 * pública; a API confia em um salto de proxy (`trust proxy` = 1), que é este BFF.
 */
async function visitorHeaders(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    const incoming = await headers();
    const ip = incoming.get('x-real-ip');
    if (ip) out['X-Forwarded-For'] = ip;
    const userAgent = incoming.get('user-agent');
    if (userAgent) out['User-Agent'] = userAgent;
  } catch {
    // Fora de um request scope (ex.: chamada interna) não há visitante a repassar.
  }
  return out;
}

/** Resultado do passo 1: sessão completa OU desafio de 2º fator (nenhum cookie é gravado). */
export type LoginOutcome =
  | { kind: 'session'; session: DashboardSession }
  | { kind: 'mfa'; step: MfaStep; challengeToken: string };

/** Mensagem da API quando ela é nossa (PT-BR, genérica); senão o texto de fallback. */
function backendMessage(payload: unknown, fallback: string): string {
  return isRecord(payload) && typeof payload.message === 'string' ? payload.message : fallback;
}

/** Valida a resposta de sessão da API, grava os cookies do BFF e devolve a sessão. */
async function startSession(response: Response, payload: unknown): Promise<DashboardSession> {
  const auth = parseAuthPayload(payload);
  const setCookie = response.headers.get('set-cookie');
  const refresh = extractRefreshCookie(setCookie);
  const refreshMaxAge = extractRefreshMaxAge(setCookie);
  if (!refresh || refreshMaxAge === null)
    throw new BffError(502, 'A API não devolveu uma sessão renovável.');

  let session: DashboardSession;
  try {
    session = toDashboardSession(auth);
  } catch (error) {
    await clearSession();
    throw error;
  }
  await saveSession(auth.accessToken, refresh, refreshMaxAge);
  return session;
}

async function postAuth(
  path: string,
  body: unknown,
): Promise<{ response: Response; payload: unknown }> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await visitorHeaders()) },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  return { response, payload: await parseJson(response) };
}

export async function loginBackend(body: unknown): Promise<LoginOutcome> {
  const { response, payload } = await postAuth('/auth/login', body);
  if (!response.ok) throw new BffError(response.status, 'E-mail ou senha incorretos.');

  // Senha certa com 2º fator pendente: a API não emitiu sessão, só um desafio de uso único.
  const challenge = mfaChallengeResponseSchema.safeParse(payload);
  if (challenge.success) {
    return { kind: 'mfa', ...challenge.data.mfa };
  }
  return { kind: 'session', session: await startSession(response, payload) };
}

/** Passo 2 do login: código do app autenticador (ou de recuperação) → sessão. */
export async function mfaVerifyBackend(body: unknown): Promise<DashboardSession> {
  const { response, payload } = await postAuth('/auth/mfa/verify', body);
  if (!response.ok) {
    throw new BffError(response.status, backendMessage(payload, 'Código inválido ou expirado.'));
  }
  return startSession(response, payload);
}

export interface MfaSetupView {
  secret: string;
  account: string;
  /** PNG em data URL (o CSP já libera `img-src data:`); o segredo nunca vai a serviço externo. */
  qrDataUrl: string;
}

/** Inscrição: pede o segredo à API e desenha o QR AQUI, no servidor do BFF. */
export async function mfaSetupBackend(body: unknown): Promise<MfaSetupView> {
  const { response, payload } = await postAuth('/auth/mfa/setup', body);
  if (!response.ok) {
    throw new BffError(
      response.status,
      backendMessage(payload, 'Desafio expirado. Entre novamente.'),
    );
  }
  if (
    !isRecord(payload) ||
    typeof payload.secret !== 'string' ||
    typeof payload.otpauthUri !== 'string' ||
    typeof payload.account !== 'string'
  ) {
    throw new BffError(502, 'Resposta de inscrição inválida.');
  }
  const qrDataUrl = await QRCode.toDataURL(payload.otpauthUri, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 224,
  });
  return { secret: payload.secret, account: payload.account, qrDataUrl };
}

/** Confirma a inscrição: entra e devolve os códigos de recuperação (única vez em claro). */
export async function mfaEnableBackend(
  body: unknown,
): Promise<{ session: DashboardSession; recoveryCodes: string[] }> {
  const { response, payload } = await postAuth('/auth/mfa/enable', body);
  if (!response.ok) {
    throw new BffError(response.status, backendMessage(payload, 'Código inválido ou expirado.'));
  }
  const codes =
    isRecord(payload) && Array.isArray(payload.recoveryCodes)
      ? payload.recoveryCodes.filter((entry): entry is string => typeof entry === 'string')
      : [];
  if (codes.length === 0) throw new BffError(502, 'A API não devolveu os códigos de recuperação.');
  return { session: await startSession(response, payload), recoveryCodes: codes };
}

async function rotateRefresh(
  refresh: string,
): Promise<{ auth: AuthPayload; refresh: string; refreshMaxAge: number }> {
  const response = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: `${BACKEND_REFRESH_COOKIE}=${refresh}`, ...(await visitorHeaders()) },
    cache: 'no-store',
  });
  const payload = await parseJson(response);
  if (!response.ok) {
    // 409: outra instância acabou de rotacionar este cookie. Ela enviará o novo par
    // ao navegador; apagar os cookies aqui poderia sobrescrever essa resposta.
    if (response.status === 409) {
      throw new BffError(409, 'Sessão renovada em outra solicitação. Atualize a página.');
    }
    if (response.status === 401) await clearSession();
    throw new BffError(response.status, 'Não foi possível renovar a sessão.');
  }

  const auth = parseAuthPayload(payload);
  const setCookie = response.headers.get('set-cookie');
  const rotatedRefresh = extractRefreshCookie(setCookie);
  const refreshMaxAge = extractRefreshMaxAge(setCookie);
  if (!rotatedRefresh || refreshMaxAge === null) {
    await clearSession();
    throw new BffError(502, 'A API não devolveu a rotação da sessão.');
  }
  try {
    toDashboardSession(auth);
  } catch (error) {
    await clearSession();
    throw error;
  }
  return { auth, refresh: rotatedRefresh, refreshMaxAge };
}

async function refreshBackend(): Promise<AuthPayload> {
  const refresh = (await cookies()).get(BFF_REFRESH_COOKIE)?.value;
  if (!refresh) throw new BffError(401, 'Sessão ausente.');
  let pending = refreshInFlight.get(refresh);
  if (!pending) {
    pending = rotateRefresh(refresh);
    refreshInFlight.set(refresh, pending);
    void pending.finally(() => refreshInFlight.delete(refresh)).catch(() => undefined);
  }
  const rotated = await pending;
  // Cada resposta concorrente precisa enviar Set-Cookie; o fetch à API é único.
  await saveSession(rotated.auth.accessToken, rotated.refresh, rotated.refreshMaxAge);
  return rotated.auth;
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

/** Faz chamada autenticada após validar a sessão interna e executa uma rotação do access. */
export async function authenticatedBackendFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const { accessToken } = await requireDashboardAccess();
  let response = await requestWithAccess(path, init, accessToken);
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
  const store = await cookies();
  const refresh = store.get(BFF_REFRESH_COOKIE)?.value;
  const access = store.get(BFF_ACCESS_COOKIE)?.value;
  let response: Response | undefined;
  if (refresh) {
    response = await fetch(`${API_BASE}/auth/logout/refresh`, {
      method: 'POST',
      headers: { Cookie: `${BACKEND_REFRESH_COOKIE}=${refresh}`, ...(await visitorHeaders()) },
      cache: 'no-store',
    });
  } else if (access) {
    response = await requestWithAccess('/auth/logout', { method: 'POST' }, access);
  }
  if (response && !response.ok) {
    throw new BffError(response.status, 'Não foi possível encerrar a sessão. Tente novamente.');
  }
  await clearSession();
}

/** Defesa CSRF adicional ao SameSite=Strict: mutações exigem Origin same-origin. */
export function assertTrustedMutation(request: NextRequest): void {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (!origin || !trustedOrigins(request).has(origin)) {
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
