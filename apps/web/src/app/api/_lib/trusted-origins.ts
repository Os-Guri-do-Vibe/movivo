import 'server-only';

import type { NextRequest } from 'next/server';

import { publicEnv } from '@/lib/env';

/**
 * Origens aceitas no `Origin` das mutações dos BFFs (defesa CSRF além do
 * `SameSite=Strict`).
 *
 * `nextUrl.origin` sozinho não basta: atrás do Nginx, o servidor standalone do Next monta
 * a URL da requisição com o host interno do processo (ex.: `https://localhost:3000`),
 * nunca com `https://movivo.com.br` — comparar só com ele recusava toda escrita em
 * produção. A origem pública vem de `NEXT_PUBLIC_SITE_URL`, fixada no build.
 *
 * A Plataforma Interna (`/entrar`, `/dashboard`) é servida em subdomínio próprio
 * (`NEXT_PUBLIC_ADMIN_URL`, ex.: `https://admin.movivo.com.br`) — o login e as
 * escritas do dashboard chegam com esse `Origin`, não com o do site público.
 */
export function trustedOrigins(request: NextRequest): Set<string> {
  const origins = new Set([request.nextUrl.origin]);
  try {
    origins.add(new URL(publicEnv.siteUrl).origin);
  } catch {
    // O build já usa fallback válido; este ramo apenas evita confiar em env malformada.
  }
  if (publicEnv.adminUrl !== undefined) {
    try {
      origins.add(new URL(publicEnv.adminUrl).origin);
    } catch {
      // Env malformada não deve derrubar a validação das demais origens confiáveis.
    }
  }
  return origins;
}
