import { mfaSetupSchema } from '@movivo/shared';
import { type NextRequest, NextResponse } from 'next/server';

import {
  assertTrustedMutation,
  BffError,
  DASHBOARD_PRIVATE_HEADERS,
  errorResponse,
  mfaSetupBackend,
} from '../../../_lib/bff';

export async function POST(request: NextRequest) {
  try {
    assertTrustedMutation(request);
    const parsed = mfaSetupSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new BffError(400, 'Desafio inválido. Entre novamente.');
    const setup = await mfaSetupBackend(parsed.data);
    return NextResponse.json(setup, { headers: DASHBOARD_PRIVATE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}
