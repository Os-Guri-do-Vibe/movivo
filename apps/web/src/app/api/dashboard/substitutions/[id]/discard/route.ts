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
    if (!uuidSchema.safeParse(id).success) throw new BffError(400, 'Proposta inválida.');
    const response = await authenticatedBackendFetch(
      `/professional/dashboard/substitutions/${id}/discard`,
      { method: 'POST' },
    );
    return forwardBackendJson(response);
  } catch (error) {
    return errorResponse(error);
  }
}
