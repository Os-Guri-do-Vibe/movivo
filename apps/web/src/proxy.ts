import { NextResponse, type NextRequest } from 'next/server';

import { publicEnv } from '@/lib/env';

function safeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * CSP estrita com nonce por request (Next.js 16).
 *
 * O dashboard processa dado de saúde derivado e, por isso, não aceita uma política
 * baseada em `unsafe-inline` em produção. O nonce também é colocado no request para
 * que o App Router o aplique aos scripts do framework durante o SSR. Autorização não
 * vive aqui: o DAL da rota e o backend repetem a checagem de sessão/RBAC próximos ao
 * dado, evitando depender exclusivamente do Proxy.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';
  const connectOrigins = [safeOrigin(publicEnv.apiUrl), safeOrigin(publicEnv.posthog.host)]
    .filter((origin): origin is string => origin !== null)
    .join(' ');
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-inline'" : ''}`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self' ${connectOrigins}`.trim(),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  // Nonces exigem renderização dinâmica. A superfície CREF é dinâmica;
  // a landing permanece estática e não recebe uma política incompatível com seu HTML.
  matcher: ['/entrar', '/dashboard/:path*', '/treino/:path*', '/api/workout/:path*'],
};
