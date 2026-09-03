import { updateAccountProfileSchema } from '@movivo/shared';
import { NextResponse, type NextRequest } from 'next/server';

import {
  assertTrustedMutation,
  authenticatedBackendFetch,
  BffError,
  errorResponse,
  forwardBackendJson,
} from '../../_lib/bff';

export async function GET() {
  try {
    const response = await authenticatedBackendFetch('/account/profile');
    return forwardBackendJson(response);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    assertTrustedMutation(request);
    const parsed = updateAccountProfileSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new BffError(400, 'Revise os dados informados.');
    const response = await authenticatedBackendFetch('/account/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
    });
    return forwardBackendJson(response);
  } catch (error) {
    return errorResponse(error);
  }
}

export const dynamic = 'force-dynamic';

export function OPTIONS() {
  return new NextResponse(null, { status: 405 });
}
