import { mfaEnableSchema } from '@movivo/shared';
import { type NextRequest, NextResponse } from 'next/server';

import {
  assertTrustedMutation,
  BffError,
  DASHBOARD_PRIVATE_HEADERS,
  errorResponse,
  mfaEnableBackend,
} from '../../../_lib/bff';

export async function POST(request: NextRequest) {
  try {
    assertTrustedMutation(request);
    const parsed = mfaEnableSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new BffError(400, 'Informe o código de 6 dígitos.');
    const { session, recoveryCodes } = await mfaEnableBackend(parsed.data);
    return NextResponse.json(
      { user: session, recoveryCodes },
      { headers: DASHBOARD_PRIVATE_HEADERS },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
