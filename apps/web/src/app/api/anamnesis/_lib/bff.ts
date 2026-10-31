import 'server-only';

import { createHash } from 'node:crypto';

import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import { ANAMNESIS_REF_HEADER, SESSION_REPLACED_STATUS } from '@/lib/anamnesis-session-ref';
import { publicEnv, secureCookies } from '@/lib/env';

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

/** Uma etapa da anamnese tem poucos KB; acima disto é abuso, não resposta. */
const MAX_JSON_BODY_BYTES = 64 * 1024;
const UPSTREAM_TIMEOUT_MS = 20_000;
const UPSTREAM_PHOTO_TIMEOUT_MS = 60_000;

function declaredLength(request: NextRequest): number {
  return Number(request.headers.get('content-length') ?? 0) || 0;
}

async function readLimitedText(request: NextRequest): Promise<string> {
  if (declaredLength(request) > MAX_JSON_BODY_BYTES) {
    throw new AnamnesisBffError(413, 'As respostas enviadas passam do tamanho permitido.');
  }
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_JSON_BODY_BYTES) {
    throw new AnamnesisBffError(413, 'As respostas enviadas passam do tamanho permitido.');
  }
  return text;
}

/**
 * Chamada à API com prazo. O log leva só a rota lógica (`step/3`, `photo/FRONT`…): a URL
 * real carrega o token da sessão e nunca é registrada.
 */
async function upstream(
  url: string,
  init: RequestInit,
  route: string,
  timeoutMs = UPSTREAM_TIMEOUT_MS,
): Promise<Response> {
  try {
    const response = await fetch(url, {
      ...init,
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status >= 500) {
      console.error('anamnesis_upstream_failed', { route, status: response.status });
    }
    return response;
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    console.error('anamnesis_upstream_unreachable', { route, timedOut });
    throw new AnamnesisBffError(
      timedOut ? 504 : 502,
      'Não foi possível concluir agora. Tente de novo em instantes.',
    );
  }
}

/** Repassa a resposta da API; erro interno dela vira mensagem genérica (nada de detalhe técnico). */
async function relay(response: Response): Promise<NextResponse> {
  if (response.status >= 500) {
    return json({ message: 'Não foi possível concluir agora.' }, response.status);
  }
  return json(await readJson(response), response.status);
}

function json(payload: unknown, status: number): NextResponse {
  return NextResponse.json(payload ?? {}, { status, headers: PRIVATE_HEADERS });
}

async function storeToken(token: string): Promise<void> {
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: secureCookies,
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
  const response = await upstream(
    sessionUrl(token),
    { headers: upstreamHeaders(request) },
    'session',
  );
  if (!response.ok) {
    if (response.status === 404) (await cookies()).delete({ name: COOKIE, path: COOKIE_PATH });
    return relay(response);
  }
  return json({ ref: sessionRef(token), session: await readJson(response) }, 200);
}

export async function startSession(request: NextRequest): Promise<NextResponse> {
  assertSameOrigin(request);
  const response = await upstream(
    `${API_BASE}/anamnesis/start`,
    { method: 'POST', headers: upstreamHeaders(request), body: await readLimitedText(request) },
    'start',
  );
  if (!response.ok) return relay(response);
  const payload = (await readJson(response)) as { token?: unknown } | null;
  if (typeof payload?.token !== 'string') {
    console.error('anamnesis_upstream_failed', { route: 'start', status: 'invalid_payload' });
    throw new AnamnesisBffError(502, 'Resposta inválida ao iniciar o cadastro.');
  }
  await storeToken(payload.token);
  return sessionView(request, payload.token);
}

/**
 * Retomada da anamnese complementar: o token chega do link (fragmento da URL → corpo desta
 * chamada), é conferido na API — token inválido não deixa cookie — e passa a viver só no cookie.
 */
export async function resumeSession(request: NextRequest): Promise<NextResponse> {
  assertSameOrigin(request);
  const body = (await readJson(new Response(await readLimitedText(request)))) as {
    token?: unknown;
  } | null;
  const token = body?.token;
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) {
    throw new AnamnesisBffError(400, 'Link inválido.');
  }
  const view = await sessionView(request, token);
  if (view.ok) await storeToken(token);
  return view;
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
  const body = await readLimitedText(request);
  const response = await upstream(
    sessionUrl(token, action),
    { method, headers: upstreamHeaders(request), body: body || undefined },
    action,
  );
  if (response.status === 204) {
    return new NextResponse(null, { status: 204, headers: PRIVATE_HEADERS });
  }
  return relay(response);
}

/** Teto do corpo de uma foto: um pouco acima do limite da API (5 MB), que dá a mensagem de erro. */
const MAX_PHOTO_REQUEST_BYTES = 6 * 1024 * 1024;
const PHOTO_ANGLES = new Set(['FRONT', 'RIGHT', 'BACK', 'LEFT']);
const PHOTO_CONTENT_TYPE = /^image\/(jpeg|png|webp)$/;

/**
 * Foto do corpo da posição (`PUT` envia os bytes, `DELETE` apaga). A posição e o tipo são
 * conferidos aqui antes de qualquer byte seguir para a API.
 */
export async function forwardSessionPhoto(
  request: NextRequest,
  angle: string,
  method: 'PUT' | 'DELETE',
): Promise<NextResponse> {
  assertSameOrigin(request);
  if (!PHOTO_ANGLES.has(angle)) throw new AnamnesisBffError(404, 'Posição inexistente.');
  const token = await readToken();
  if (request.headers.get(ANAMNESIS_REF_HEADER) !== sessionRef(token)) {
    throw new AnamnesisBffError(SESSION_REPLACED_STATUS, 'O cadastro desta aba foi substituído.');
  }
  const headers = upstreamHeaders(request);
  let body: ArrayBuffer | undefined;
  if (method === 'PUT') {
    const contentType = request.headers.get('content-type') ?? '';
    if (!PHOTO_CONTENT_TYPE.test(contentType)) {
      throw new AnamnesisBffError(415, 'Use uma imagem JPG, PNG ou WebP.');
    }
    // O tamanho declarado é conferido antes de ler: um corpo gigante nem entra na memória.
    if (declaredLength(request) > MAX_PHOTO_REQUEST_BYTES) {
      throw new AnamnesisBffError(413, 'A imagem passa de 5 MB.');
    }
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_PHOTO_REQUEST_BYTES) {
      throw new AnamnesisBffError(413, 'A imagem passa de 5 MB.');
    }
    headers.set('Content-Type', contentType);
  }
  const response = await upstream(
    sessionUrl(token, `photo/${angle}`),
    { method, headers, body },
    `photo/${angle}`,
    UPSTREAM_PHOTO_TIMEOUT_MS,
  );
  return relay(response);
}

export function failure(error: unknown): NextResponse {
  if (error instanceof AnamnesisBffError) return json({ message: error.message }, error.status);
  // Só o tipo do erro: mensagem e pilha podem carregar URL com token ou dado do aluno.
  console.error('anamnesis_bff_failed', {
    kind: error instanceof Error ? error.name : typeof error,
  });
  return json({ message: 'Não foi possível concluir agora.' }, 500);
}
