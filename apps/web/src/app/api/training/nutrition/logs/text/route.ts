import type { NextRequest } from 'next/server';

import { assertSameOrigin, failure, forward, trainingBackendFetch } from '../../../_lib/bff';

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    return forward(
      await trainingBackendFetch('/nutrition/logs/text', {
        method: 'POST',
        body: await request.text(),
      }),
    );
  } catch (error) {
    return failure(error);
  }
}
