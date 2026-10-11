import { NextResponse, type NextRequest } from 'next/server';

import {
  DASHBOARD_PRIVATE_HEADERS,
  errorResponse,
  readBackendSession,
  safeNextPath,
} from '../_lib/bff';

/**
 * Redirect com `Location` relativo: atrás do Nginx, `request.nextUrl` carrega o host interno
 * do processo (`https://localhost:3000`), e usá-lo como base mandava o navegador, após a
 * rotação de sessão, para um host que só existe dentro do servidor. O navegador resolve o
 * caminho relativo contra o host público que ele mesmo está usando (admin ou site).
 */
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, {
    status: 307,
    headers: { Location: path, ...DASHBOARD_PRIVATE_HEADERS },
  });
}

export async function GET(request: NextRequest) {
  const next = request.nextUrl.searchParams.get('next');
  try {
    const session = await readBackendSession();
    if (next) return redirectTo(safeNextPath(next));
    return NextResponse.json({ user: session }, { headers: DASHBOARD_PRIVATE_HEADERS });
  } catch (error) {
    if (next) return redirectTo('/entrar?erro=sessao-expirada');
    return errorResponse(error);
  }
}
