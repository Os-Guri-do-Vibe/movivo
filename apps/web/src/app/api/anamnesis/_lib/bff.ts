import 'server-only';

import { createHash } from 'node:crypto';

import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import { ANAMNESIS_REF_HEADER, SESSION_REPLACED_STATUS } from '@/lib/anamnesis-session-ref';
import { publicEnv } from '@/lib/env';

import { trustedOrigins } from '../../_lib/trusted-origins';

/**
 * BFF da anamnese. O token da sessão é credencial de acesso a dado de saúde (Sato §8.1):
 * fica num cookie httpOnly, que script nenhum da página lê, e só este servidor o coloca
 * no PATH das chamadas à API (ADR-006). O navegador fala apenas com `/api/anamnesis/*`.
 *
 * Cookie de sessão (sem `Max-Age`): some quando o navegador fecha. A sessão em si vale
 * 72h na API; um cookie que sobreviva a ela recebe 404 e é descartado aqui.
 */
const API_BASE = (process.env.MOVIVO_API_URL?.trim() || publicEnv.apiUrl).replace(/\/$/, '');
const COOKIE = 'movivo_anamnesis_session';
/** Só as rotas do BFF recebem o cookie; nenhuma página o carrega. */
const COOKIE_PATH = '/api/anamnesis';
const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  'Referrer-Policy': 'no-referrer',
} as const;

export class AnamnesisBffError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function assertSameOrigin(request: NextRequest): void {
  const origin = request.headers.get('origin');
  if (!origin || !trustedOrigins(request).has(origin)) {
    throw new AnamnesisBffError(403, 'Origem não autorizada.');
  }
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new AnamnesisBffError(403, 'Solicitação cross-site bloqueada.');
  }
}

/** Referência não secreta da sessão: identifica o cadastro sem servir como credencial. */
export function sessionRef(token: string): string {
  return createHash('sha256').update(token).digest('base64url').slice(0, 22);
}

/**
 * Cabeçalhos do visitante para a API. Sem eles, toda chamada sairia com o IP e o
 * user-agent deste servidor: o rate limit por IP de `/anamnesis/*` viraria um limite
 * global e o consentimento (LGPD) seria gravado com a origem errada. Em produção o
 * Nginx sobrescreve `X-Real-IP` com o IP do visitante e o web não tem porta pública;
 * a API confia em um salto de proxy (`trust proxy` = 1), que é este BFF.
 */
function upstreamHeaders(request: NextRequest): Headers {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const ip = request.headers.get('x-real-ip');
  if (ip) headers.set('X-Forwarded-For', ip);
  const userAgent = request.headers.get('user-agent');
  if (userAgent) headers.set('User-Agent', userAgent);
  return headers;
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function json(payload: unknown, status: number): NextResponse {
  return NextResponse.json(payload ?? {}, { status, headers: PRIVATE_HEADERS });
}

async function storeToken(token: string): Promise<void> {
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: COOKIE_PATH,
    priority: 'high',
  });
}

async function readToken(): Promise<string> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) throw new AnamnesisBffError(404, 'Nenhum cadastro em andamento.');
  return token;
}

function sessionUrl(token: string, action?: string): string {
  const base = `${API_BASE}/anamnesis/session/${encodeURIComponent(token)}`;
  return action ? `${base}/${action}` : base;
}

/** Estado da sessão + referência para a aba. O token nunca vai na resposta. */
async function sessionView(request: NextRequest, token: string): Promise<NextResponse> {
  const response = await fetch(sessionUrl(token), {
    headers: upstreamHeaders(request),
    cache: 'no-store',
  });
  const payload = await readJson(response);
  if (!response.ok) {
    if (response.status === 404) (await cookies()).delete({ name: COOKIE, path: COOKIE_PATH });
    return json(payload, response.status);
  }
  return json({ ref: sessionRef(token), session: payload }, 200);
}

export async function startSession(request: NextRequest): Promise<NextResponse> {
  assertSameOrigin(request);
  const response = await fetch(`${API_BASE}/anamnesis/start`, {
    method: 'POST',
    headers: upstreamHeaders(request),
    body: await request.text(),
    cache: 'no-store',
  });
  const payload = (await readJson(response)) as { token?: unknown } | null;
  if (!response.ok) return json(payload, response.status);
  if (typeof payload?.token !== 'string') {
    throw new AnamnesisBffError(502, 'Resposta inválida ao iniciar o cadastro.');
  }
  await storeToken(payload.token);
  return sessionView(request, payload.token);
}

export async function currentSession(request: NextRequest): Promise<NextResponse> {
  return sessionView(request, await readToken());
}

/**
 * Escrita na sessão do cookie (`action` fixo, definido por cada rota — nunca vindo do
 * cliente). Exige a referência da aba: cookie trocado por outra aba → 412.
 */
export async function forwardSessionAction(
  request: NextRequest,
  action: string,
  method: 'POST' | 'PATCH',
): Promise<NextResponse> {
  assertSameOrigin(request);
  const token = await readToken();
  if (request.headers.get(ANAMNESIS_REF_HEADER) !== sessionRef(token)) {
    throw new AnamnesisBffError(SESSION_REPLACED_STATUS, 'O cadastro desta aba foi substituído.');
  }
  const body = await request.text();
  const response = await fetch(sessionUrl(token, action), {
    method,
    headers: upstreamHeaders(request),
    body: body || undefined,
    cache: 'no-store',
  });
  if (response.status === 204) {
    return new NextResponse(null, { status: 204, headers: PRIVATE_HEADERS });
  }
  return json(await readJson(response), response.status);
}

export function failure(error: unknown): NextResponse {
  const status = error instanceof AnamnesisBffError ? error.status : 500;
  const message =
    error instanceof AnamnesisBffError ? error.message : 'Não foi possível concluir agora.';
  return json({ message }, status);
}
