import { NextResponse } from 'next/server';

import { resolveShortLink } from '@/lib/short-link-api';

/**
 * Alias curto do link diário do diário de treino (achado 2026-09-12: o magic link de
 * `/treino/acessar#token=…` tem 43 caracteres de token, feio numa mensagem de WhatsApp).
 * `WorkoutScheduler` manda `${publicSiteUrl}/check-in/<código>` — resolve o código via
 * `ShortLinkController` (API, interna) e faz o 302 de verdade pro link completo, mesmo
 * padrão de proxy de `protocolo/[token]/pdf/route.ts`.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const target = await resolveShortLink(code);
  if (!target) {
    return NextResponse.json({ error: 'link_expirado' }, { status: 410 });
  }
  return NextResponse.redirect(target, 302);
}
