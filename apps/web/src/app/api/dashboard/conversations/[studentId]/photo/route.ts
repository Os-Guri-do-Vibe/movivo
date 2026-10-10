import { NextResponse } from 'next/server';

import { authenticatedBackendFetch, BffError } from '../../../_lib/bff';

/**
 * Foto de perfil do WhatsApp do aluno, servida same-origin.
 *
 * A CSP deste app restringe `img-src` a `'self'` (ver `src/proxy.ts`), então a URL do CDN
 * do WhatsApp nunca vai direto num `<img>`. A API devolve só a URL (já validada contra o
 * host do WhatsApp); aqui o servidor a baixa e repassa os bytes. Qualquer falha vira 404 —
 * a tela cai nas iniciais, foto é enfeite.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 5_000;
const WHATSAPP_HOST_SUFFIXES = ['.whatsapp.net', '.whatsapp.com', '.fbcdn.net'];

function isWhatsappPhotoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      WHATSAPP_HOST_SUFFIXES.some((suffix) => url.hostname.endsWith(suffix))
    );
  } catch {
    return false;
  }
}

const notFound = () => new NextResponse(null, { status: 404 });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ studentId: string }> },
) {
  const { studentId } = await params;
  if (!UUID_RE.test(studentId)) return notFound();

  let photoUrl: string | null;
  try {
    const upstream = await authenticatedBackendFetch(
      `/control-center/conversations/${studentId}/photo`,
      { cache: 'no-store' },
    );
    if (!upstream.ok) {
      return new NextResponse(null, { status: upstream.status === 401 ? 401 : 404 });
    }
    const body = (await upstream.json()) as { data?: { url?: unknown } };
    photoUrl = typeof body.data?.url === 'string' ? body.data.url : null;
  } catch (error) {
    return new NextResponse(null, { status: error instanceof BffError ? error.status : 404 });
  }
  if (!photoUrl || !isWhatsappPhotoUrl(photoUrl)) return notFound();

  try {
    const image = await fetch(photoUrl, {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const contentType = image.headers.get('content-type') ?? '';
    if (!image.ok || !contentType.startsWith('image/')) return notFound();
    const bytes = await image.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_PHOTO_BYTES) return notFound();
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff',
        // A foto muda pouco e a lista pede uma por linha: cache curto no navegador.
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch {
    return notFound();
  }
}

export const dynamic = 'force-dynamic';
