import { type NextRequest, NextResponse } from 'next/server';

import {
  assertTrustedMutation,
  DASHBOARD_PRIVATE_HEADERS,
  errorResponse,
  logoutBackend,
} from '../../_lib/bff';

export async function POST(request: NextRequest) {
  try {
    assertTrustedMutation(request);
    await logoutBackend();
    return new NextResponse(null, {
      status: 204,
      headers: { ...DASHBOARD_PRIVATE_HEADERS, 'Clear-Site-Data': '"cache"' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
