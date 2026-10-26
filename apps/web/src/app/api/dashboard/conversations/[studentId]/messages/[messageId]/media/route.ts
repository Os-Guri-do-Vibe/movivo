import { NextResponse } from 'next/server';

import { authenticatedBackendFetch, BffError } from '../../../../../_lib/bff';

/**
 * Áudio ou imagem de uma mensagem do WhatsApp, servido same-origin (CSP `img-src 'self'` /
 * `default-src 'self'`).
 *
 * A API decifra o arquivo e confere a autorização (STUDENTS_READ + STUDENTS_HEALTH_READ, RLS do
 * ator) e a auditoria; aqui só se repassa os bytes, com suporte a `Range` — sem ele o `<audio>`
 * do navegador não deixa avançar/voltar o áudio. O tipo precisa ser áudio/imagem, e a resposta
 * sai com `nosniff` e sem cache: é dado de saúde.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

const status = (code: number) => new NextResponse(null, { status: code });

/** `bytes=a-b`, `bytes=a-` ou `bytes=-n` → [início, fim] inclusivos, ou `null` se inválido. */
function parseRange(header: string, size: number): [number, number] | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;
  let start: number;
  let end: number;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (suffix === 0) return null;
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  return start <= end && start < size ? [start, end] : null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ studentId: string; messageId: string }> },
) {
  const { studentId, messageId } = await params;
  if (!UUID_RE.test(studentId) || !UUID_RE.test(messageId)) return status(404);

  let upstream: Response;
  try {
    upstream = await authenticatedBackendFetch(
      `/control-center/conversations/${studentId}/messages/${messageId}/media`,
      { cache: 'no-store' },
    );
  } catch (error) {
    return status(error instanceof BffError ? error.status : 404);
  }
  if (!upstream.ok)
    return status(upstream.status === 401 || upstream.status === 403 ? upstream.status : 404);

  const contentType = (upstream.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
  if (!/^(?:image|audio)\/[a-z0-9.+-]+$/i.test(contentType)) return status(404);
  const bytes = Buffer.from(await upstream.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_MEDIA_BYTES) return status(404);

  const headers = {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
    'Accept-Ranges': 'bytes',
  };
  const rangeHeader = request.headers.get('range');
  if (rangeHeader) {
    const range = parseRange(rangeHeader, bytes.byteLength);
    if (!range) {
      return new NextResponse(null, {
        status: 416,
        headers: { ...headers, 'Content-Range': `bytes */${bytes.byteLength}` },
      });
    }
    const [start, end] = range;
    return new NextResponse(bytes.subarray(start, end + 1), {
      status: 206,
      headers: {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${bytes.byteLength}`,
        'Content-Length': String(end - start + 1),
      },
    });
  }
  return new NextResponse(bytes, {
    status: 200,
    headers: { ...headers, 'Content-Length': String(bytes.byteLength) },
  });
}

export const dynamic = 'force-dynamic';
