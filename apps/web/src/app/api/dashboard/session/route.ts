import { NextResponse, type NextRequest } from 'next/server';

import {
  DASHBOARD_PRIVATE_HEADERS,
  errorResponse,
  readBackendSession,
  safeNextPath,
} from '../_lib/bff';

export async function GET(request: NextRequest) {
  const next = request.nextUrl.searchParams.get('next');
  try {
    const session = await readBackendSession();
    if (next) return NextResponse.redirect(new URL(safeNextPath(next), request.nextUrl));
    return NextResponse.json({ user: session }, { headers: DASHBOARD_PRIVATE_HEADERS });
  } catch (error) {
    if (next)
      return NextResponse.redirect(new URL('/entrar?erro=sessao-expirada', request.nextUrl));
    return errorResponse(error);
  }
}
