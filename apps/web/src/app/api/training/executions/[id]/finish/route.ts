import type { NextRequest } from 'next/server';

import { assertSameOrigin, failure, forward, trainingBackendFetch } from '../../../_lib/bff';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    return forward(
      await trainingBackendFetch(`/training/executions/${encodeURIComponent(id)}/finish`, {
        method: 'POST',
        body: await request.text(),
      }),
    );
  } catch (error) {
    return failure(error);
  }
}
