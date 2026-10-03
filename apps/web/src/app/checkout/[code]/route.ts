import { NextResponse } from 'next/server';

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
    return NextResponse.json({ error: 'link_expirado' }, { status: 410 });
  }
  return NextResponse.redirect(target, 302);
}
