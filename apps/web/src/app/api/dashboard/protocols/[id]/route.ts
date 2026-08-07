import { protocolStructureSchema, uuidSchema } from '@movivo/shared';
import type { NextRequest } from 'next/server';

import {
  assertTrustedMutation,
  authenticatedBackendFetch,
  BffError,
  errorResponse,
  forwardBackendJson,
} from '../../_lib/bff';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    assertTrustedMutation(request);
    const { id } = await context.params;
    if (!uuidSchema.safeParse(id).success) throw new BffError(400, 'Protocolo inválido.');

    const body = await request.json().catch(() => null);
    const content = isRecord(body) ? protocolStructureSchema.safeParse(body.content) : null;
    const reason = isRecord(body) && typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!content?.success || reason.length < 3 || reason.length > 500) {
      throw new BffError(400, 'Revise o protocolo e informe o motivo da edição.');
    }

    const response = await authenticatedBackendFetch(`/professional/dashboard/protocols/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content.data, reason }),
    });
    return forwardBackendJson(response);
  } catch (error) {
    return errorResponse(error);
  }
}
