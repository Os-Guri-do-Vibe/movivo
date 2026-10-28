import type { NextRequest } from 'next/server';

import { assertSameOrigin, failure, forward, trainingBackendFetch } from '../../../../_lib/bff';

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    return forward(
      await trainingBackendFetch(`/nutrition/logs/${encodeURIComponent(id)}/confirm`, {
        method: 'PUT',
        body: await request.text(),
      }),
    );
  } catch (error) {
    return failure(error);
  }
}
