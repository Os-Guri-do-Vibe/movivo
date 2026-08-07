import { loginSchema } from '@movivo/shared';
import { type NextRequest, NextResponse } from 'next/server';

import {
  assertTrustedMutation,
  BffError,
  DASHBOARD_PRIVATE_HEADERS,
  errorResponse,
  loginBackend,
} from '../../_lib/bff';

export async function POST(request: NextRequest) {
  try {
    assertTrustedMutation(request);
    const parsed = loginSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new BffError(400, 'Revise o e-mail e a senha informados.');
    const session = await loginBackend(parsed.data);
    return NextResponse.json({ user: session }, { headers: DASHBOARD_PRIVATE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}
