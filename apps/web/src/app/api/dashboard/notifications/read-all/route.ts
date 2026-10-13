import type { NextRequest } from 'next/server';

import {
  assertTrustedMutation,
  authenticatedBackendFetch,
  BffError,
  errorResponse,
  forwardBackendJson,
} from '../../_lib/bff';

export async function POST(request: NextRequest) {
  try {
    assertTrustedMutation(request);
    const body: unknown = await request.json().catch(() => null);
    const until =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>).until : null;
    if (typeof until !== 'string' || Number.isNaN(Date.parse(until))) {
      throw new BffError(400, 'Data de corte inválida.');
    }
    const response = await authenticatedBackendFetch(
      '/professional/dashboard/notifications/read-all',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ until: new Date(until).toISOString() }),
      },
    );
    return forwardBackendJson(response);
  } catch (error) {
    return errorResponse(error);
  }
}
