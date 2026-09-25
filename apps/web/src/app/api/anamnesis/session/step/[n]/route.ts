import type { NextRequest } from 'next/server';

import { AnamnesisBffError, failure, forwardSessionAction } from '../../../_lib/bff';

const STEPS = new Set(['1', '2', '3']);

export async function PATCH(request: NextRequest, context: { params: Promise<{ n: string }> }) {
  try {
    const { n } = await context.params;
    if (!STEPS.has(n)) throw new AnamnesisBffError(404, 'Etapa inexistente.');
    return await forwardSessionAction(request, `step/${n}`, 'PATCH');
  } catch (error) {
    return failure(error);
  }
}
