import { NextResponse } from 'next/server';

import { resolveShortLink } from '@/lib/short-link-api';

/**
 * Alias curto do cancelamento (`/cancelar/<código>` → `/conta/<userId>`, o portal onde o
 * titular confirma). Mesmo padrão de proxy de `check-in/[code]/route.ts`.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const target = await resolveShortLink(code);
  if (!target) {
    return NextResponse.json({ error: 'link_expirado' }, { status: 410 });
  }
  return NextResponse.redirect(target, 302);
}
