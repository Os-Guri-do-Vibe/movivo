import { NextResponse } from 'next/server';

import { resolveShortLink } from '@/lib/short-link-api';

/**
 * Alias curto do link da anamnese complementar enviado por WhatsApp. O código resolve, via
 * API interna, para `/anamnese/complementar#token=…` e o 302 leva o fragmento junto — o
 * token nunca aparece na query nem nos logs.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const target = await resolveShortLink(code);
  if (!target) return NextResponse.json({ error: 'link_expirado' }, { status: 410 });
  return NextResponse.redirect(target, 302);
}
