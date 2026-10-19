import { amendActiveProtocolSchema, uuidSchema } from '@movivo/shared';
import type { NextRequest } from 'next/server';

import {
  assertTrustedMutation,
  authenticatedBackendFetch,
  BffError,
  errorResponse,
  forwardBackendJson,
  validationErrorResponse,
} from '../../../_lib/bff';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    assertTrustedMutation(request);
    const { id } = await context.params;
    if (!uuidSchema.safeParse(id).success) throw new BffError(400, 'Protocolo inválido.');

    const body = await request.json().catch(() => null);
    const parsed = amendActiveProtocolSchema.safeParse(body);
    if (!parsed.success) {
      return validationErrorResponse(
        'Revise a atualização do protocolo.',
        parsed.error.issues,
        body,
      );
    }

    const response = await authenticatedBackendFetch(
      `/professional/dashboard/protocols/${id}/amend`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      },
    );
    return forwardBackendJson(response);
  } catch (error) {
    return errorResponse(error);
  }
}
