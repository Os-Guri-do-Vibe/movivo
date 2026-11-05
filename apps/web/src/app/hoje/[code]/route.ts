import { NextResponse } from 'next/server';

import { resolveShortLink } from '@/lib/short-link-api';

/**
 * Alias curto do link mágico do dia: `TrainingLinkService` manda `${site}/hoje/<código>` no
 * WhatsApp; aqui o código é resolvido (API interna) e redirecionado para `/hoje/acessar#token=…`.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const target = await resolveShortLink(code);
  if (!target) return NextResponse.json({ error: 'link_expirado' }, { status: 410 });
  return NextResponse.redirect(target, 302);
}
