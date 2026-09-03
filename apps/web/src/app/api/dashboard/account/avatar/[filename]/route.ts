import { NextResponse } from 'next/server';

import { API_BASE } from '../../../_lib/bff';

/**
 * Proxy de leitura da foto de perfil — same-origin de propósito.
 *
 * A URL absoluta que a API devolve (`http://<api-host>/api/v1/account/avatar/<file>`)
 * nunca pode ir direto num `<img src>`: a CSP deste app restringe `img-src` a `'self'`
 * (+ `blob:`/`data:`) — ver `src/proxy.ts`. Sem este proxy, o navegador bloqueia
 * silenciosamente o carregamento da imagem (foto "some" depois do upload).
 *
 * Sem `authenticatedBackendFetch` de propósito: a rota da API já é pública (o nome do
 * arquivo — um UUID — é o próprio token de acesso, ver `AvatarStorageService` no
 * backend), e todo `<img>` do cabeçalho dispara esta rota a cada navegação — checar a
 * sessão do dashboard aqui dobraria uma chamada a `/auth/me` por imagem à toa.
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

  const upstream = await fetch(`${API_BASE}/account/avatar/${filename}`, { cache: 'no-store' });
  if (!upstream.ok || !upstream.body) {
    return new NextResponse(null, { status: upstream.status === 404 ? 404 : 502 });
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'Cache-Control':
        upstream.headers.get('cache-control') ?? 'public, max-age=31536000, immutable',
    },
  });
}

export const dynamic = 'force-dynamic';

export function OPTIONS() {
  return new NextResponse(null, { status: 405 });
}
