import type { NextRequest } from 'next/server';

import { assertSameOrigin, failure, forward, workoutBackendFetch } from '../../../_lib/bff';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    return forward(
      await workoutBackendFetch(`/workouts/sessions/${encodeURIComponent(id)}/finish`, {
        method: 'POST',
        body: JSON.stringify(await request.json()),
      }),
    );
  } catch (error) {
    return failure(error);
  }
}
