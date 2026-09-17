import { NextResponse } from 'next/server';

import { resolveShortLink } from '@/lib/short-link-api';

/**
 * Alias curto do convite de renovação de mesociclo (achado 2026-09-12: o token cru tinha
 * 64 caracteres hex). `ProtocolRenewalScheduler` manda `${publicSiteUrl}/renovacao/<código>`
 * — resolve o código via `ShortLinkController` (API, interna) e faz o 302 pra
 * `/mesociclo/[token]`, a página real do formulário. Mesmo padrão de proxy de
 * `check-in/[code]/route.ts`.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const target = await resolveShortLink(code);
  if (!target) {
    return NextResponse.json({ error: 'link_expirado' }, { status: 410 });
  }
  return NextResponse.redirect(target, 302);
}
