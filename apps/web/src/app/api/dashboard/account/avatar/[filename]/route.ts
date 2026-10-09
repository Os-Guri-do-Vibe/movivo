import { NextResponse } from 'next/server';

import { authenticatedBackendFetch, BffError } from '../../../_lib/bff';

/**
 * Proxy de leitura da foto de perfil — same-origin de propósito.
 *
 * A URL absoluta que a API devolve (`http://<api-host>/api/v1/account/avatar/<file>`)
 * nunca pode ir direto num `<img src>`: a CSP deste app restringe `img-src` a `'self'`
 * (+ `blob:`/`data:`) — ver `src/proxy.ts`. Sem este proxy, o navegador bloqueia
 * silenciosamente o carregamento da imagem (foto "some" depois do upload).
 *
 * A API exige JWT. O BFF valida a sessão antes de encaminhar a imagem.
 */
const AVATAR_FILENAME_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;
  if (!AVATAR_FILENAME_RE.test(filename)) {
    return new NextResponse(null, { status: 404 });
  }

  let upstream: Response;
  try {
    upstream = await authenticatedBackendFetch(`/account/avatar/${filename}`, {
      cache: 'no-store',
    });
  } catch (error) {
    return new NextResponse(null, { status: error instanceof BffError ? error.status : 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return new NextResponse(null, {
      status: upstream.status === 404 ? 404 : upstream.status === 401 ? 401 : 502,
    });
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}

export const dynamic = 'force-dynamic';

export function OPTIONS() {
  return new NextResponse(null, { status: 405 });
}
