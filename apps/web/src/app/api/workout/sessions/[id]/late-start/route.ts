import type { NextRequest } from 'next/server';

import { assertSameOrigin, failure, forward, workoutBackendFetch } from '../../../_lib/bff';

/** Registro tardio: abre, sem cronômetro, o treino de um dia recente que o aluno não registrou. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    return forward(
      await workoutBackendFetch(`/workouts/sessions/${encodeURIComponent(id)}/late-start`, {
        method: 'POST',
      }),
    );
  } catch (error) {
    return failure(error);
  }
}
