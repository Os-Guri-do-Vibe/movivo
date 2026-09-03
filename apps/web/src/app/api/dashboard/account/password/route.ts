import { changePasswordSchema } from '@movivo/shared';
import { NextResponse, type NextRequest } from 'next/server';

import {
  assertTrustedMutation,
  authenticatedBackendFetch,
  BffError,
  DASHBOARD_PRIVATE_HEADERS,
  errorResponse,
  forwardBackendJson,
} from '../../_lib/bff';

export async function POST(request: NextRequest) {
  try {
    assertTrustedMutation(request);
    const parsed = changePasswordSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new BffError(400, 'Revise a senha atual e a nova senha.');
    const response = await authenticatedBackendFetch('/account/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
    });
    // 204 não carrega corpo — `forwardBackendJson` espera JSON e não serve pra ele.
    if (response.status === 204) {
      return new NextResponse(null, { status: 204, headers: DASHBOARD_PRIVATE_HEADERS });
    }
    return forwardBackendJson(response);
  } catch (error) {
    return errorResponse(error);
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 405 });
}
