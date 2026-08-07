import { uuidSchema } from '@movivo/shared';
import type { NextRequest } from 'next/server';

import {
  assertTrustedMutation,
  authenticatedBackendFetch,
  BffError,
  errorResponse,
  forwardBackendJson,
} from '../../../_lib/bff';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    assertTrustedMutation(request);
    const { id } = await context.params;
    if (!uuidSchema.safeParse(id).success) throw new BffError(400, 'Protocolo inválido.');
    const body = (await request.json().catch(() => null)) as { confirmation?: unknown } | null;
    if (body?.confirmation !== true) throw new BffError(400, 'Confirme a assinatura.');
    const response = await authenticatedBackendFetch(
      `/professional/dashboard/protocols/${id}/sign`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: true }),
      },
    );
    return forwardBackendJson(response);
  } catch (error) {
    return errorResponse(error);
  }
}
