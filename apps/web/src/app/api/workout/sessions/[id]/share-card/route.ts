import { NextResponse, type NextRequest } from 'next/server';

import { failure, forward, workoutBackendFetch } from '../../../_lib/bff';

// O PNG é por sessão do aluno (cookie httpOnly) e imutável após o treino concluído:
// o navegador pode reutilizá-lo, mas nenhum cache compartilhado (CDN/proxy) pode guardá-lo.
const IMAGE_HEADERS = {
  'Cache-Control': 'private, max-age=86400, stale-while-revalidate=604800',
  'Content-Type': 'image/png',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
} as const;

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const ifNoneMatch = request.headers.get('if-none-match');
    const upstream = await workoutBackendFetch(
      `/workouts/sessions/${encodeURIComponent(id)}/share-card`,
      { headers: ifNoneMatch ? { 'If-None-Match': ifNoneMatch } : undefined },
    );
    if (!upstream.ok && upstream.status !== 304) return forward(upstream);
    const headers = new Headers(IMAGE_HEADERS);
    const etag = upstream.headers.get('etag');
    if (etag) headers.set('ETag', etag);
    return new NextResponse(upstream.status === 304 ? null : upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (error) {
    return failure(error);
  }
}
