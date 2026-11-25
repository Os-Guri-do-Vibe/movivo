import type { NextRequest } from 'next/server';

import { confirmFoodLogRequestSchema } from '@movivo/shared';

import {
  assertSameOrigin,
  failure,
  forward,
  trainingBackendFetch,
  TrainingBffError,
} from '../../../_lib/bff';

/** Edita uma refeição já registrada (no site ou pelo WhatsApp): itens, porções e refeição. */
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    const parsed = confirmFoodLogRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new TrainingBffError(400, 'Refeição inválida.');
    return forward(
      await trainingBackendFetch(`/nutrition/logs/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(parsed.data),
      }),
    );
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    return forward(
      await trainingBackendFetch(`/nutrition/logs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    );
  } catch (error) {
    return failure(error);
  }
}
