import { NextResponse } from 'next/server';

import { publicEnv } from '@/lib/env';

/**
 * Proxy do PDF do protocolo (US-2.6-PDF) — expõe o documento sob `publicSiteUrl`, o mesmo
 * domínio já usado pelo link `/protocolo/[token]` enviado no WhatsApp (`whatsapp-outbound.worker.ts`).
 * A API não é publicamente roteável por si só; esta rota só repassa bytes, sem lógica.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const res = await fetch(`${publicEnv.apiUrl}/protocols/by-token/${token}/pdf`, {
    cache: 'no-store',
  });
  if (!res.ok || !res.body) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return new NextResponse(res.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="protocolo-movivo.pdf"',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
