import type { NextRequest } from 'next/server';

import { shareCardRequestSchema } from '@movivo/shared';

import {
  failure,
  forwardImage,
  trainingBackendFetch,
  TrainingBffError,
} from '../../../../_lib/bff';

/** O PNG do cartão no modelo escolhido, sempre com fundo transparente (desenhado pela API). */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const parsed = shareCardRequestSchema.safeParse({
      layout: request.nextUrl.searchParams.get('layout'),
    });
    if (!parsed.success) throw new TrainingBffError(400, 'Modelo de cartão inválido.');
    const query = new URLSearchParams(parsed.data);
    return forwardImage(
      await trainingBackendFetch(
        `/training/executions/${encodeURIComponent(id)}/share-card/image?${query}`,
      ),
    );
  } catch (error) {
    return failure(error);
  }
}
