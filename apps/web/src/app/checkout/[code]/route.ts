import { NextResponse } from 'next/server';

import { publicEnv } from '@/lib/env';
import { resolveShortLink } from '@/lib/short-link-api';

/**
 * Alias curto do checkout individual (`/checkout/<código>` → `/assinar/<token>`).
 * `ConversionSequenceWorker` e `SubscriptionPeriodScheduler` mandam
 * `${publicSiteUrl}/checkout/<código>` no WhatsApp — resolve o código via `ShortLinkController`
 * (API, interna) e faz o 302 de verdade. Mesmo padrão de proxy de `check-in/[code]/route.ts`.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const target = await resolveShortLink(code);
  if (!target) {
    // Link vencido: página amigável com o botão de novo link (a abertura em si não envia nada,
    // porque o WhatsApp pré-carrega links e dispararia envios sozinho).
    // Origem pública do site: atrás do proxy, `request.url` carrega o host interno do Next.
    const expired = new URL('/link-expirado', publicEnv.siteUrl);
    expired.searchParams.set('c', code);
    return NextResponse.redirect(expired, 302);
  }
  return NextResponse.redirect(target, 302);
}
