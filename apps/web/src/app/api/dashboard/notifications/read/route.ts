import { uuidSchema } from '@movivo/shared';
import type { NextRequest } from 'next/server';

import {
  assertTrustedMutation,
  authenticatedBackendFetch,
  BffError,
  errorResponse,
  forwardBackendJson,
} from '../../_lib/bff';

const TYPES = new Set(['alert', 'protocol', 'substitution']);

export async function POST(request: NextRequest) {
  try {
    assertTrustedMutation(request);
    const body: unknown = await request.json().catch(() => null);
    const record =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    if (
      typeof record.type !== 'string' ||
      !TYPES.has(record.type) ||
      !uuidSchema.safeParse(record.id).success
    ) {
      throw new BffError(400, 'Notificação inválida.');
    }
    const response = await authenticatedBackendFetch('/professional/dashboard/notifications/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: record.type, id: record.id }),
    });
    return forwardBackendJson(response);
  } catch (error) {
    return errorResponse(error);
  }
}
