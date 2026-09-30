import { approveSubstitutionSchema, uuidSchema } from '@movivo/shared';
import type { NextRequest } from 'next/server';

import {
  assertTrustedMutation,
  authenticatedBackendFetch,
  BffError,
  errorResponse,
  forwardBackendJson,
} from '../../../_lib/bff';

/**
 * Achado 2026-09-30 (troca em lote): corpo opcional com a decisão do profissional por item
 * (`APPROVE`, com outro exercício opcional, ou `DISCARD`). Sem corpo, aprova todos como estão.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    assertTrustedMutation(request);
    const { id } = await context.params;
    if (!uuidSchema.safeParse(id).success) throw new BffError(400, 'Proposta inválida.');

    const rawBody: unknown = await request.json().catch(() => ({}));
    const parsed = approveSubstitutionSchema.safeParse(rawBody ?? {});
    if (!parsed.success) throw new BffError(400, 'Revise as decisões da troca.');

    const response = await authenticatedBackendFetch(
      `/professional/dashboard/substitutions/${id}/approve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      },
    );
    return forwardBackendJson(response);
  } catch (error) {
    return errorResponse(error);
  }
}
